import * as XLSX from '@e965/xlsx'
import { readFileSync } from 'fs'
import { basename } from 'path'
import { ImportParseError, UnsupportedImportFormatError } from '../../domain/errors'
import {
  newTransactionSchema,
  preparedImportSchema,
  type NewTransaction,
  type PreparedImport
} from '../../domain/schemas'
import { sha256File } from '../../utils/file-hash'
import {
  importInspectionSchema,
  type ImportContext,
  type ImportFileInput,
  type ImportInspection,
  type ImportWarning,
  type TransactionImporter
} from '../types'
import { validateImportFileInput } from '../shared/file-input'
import { excelSerialDateToIsoDate, parseVisaAmountCents } from './normalization'

type Section = 'none' | 'completed' | 'pending'

type ParsedMovement = {
  transaction: NewTransaction
  section: Exclude<Section, 'none'>
}

type ParseResult = {
  detectedFormat: string
  sourceFileName: string
  completedHeaderFound: boolean
  pendingSectionFound: boolean
  pendingHeaderFound: boolean
  movements: ParsedMovement[]
  warnings: ImportWarning[]
}

const detectedFormat = 'legacy_excel_biff_cfb'
const requiredHeader = ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE']

export class EvoVisaXlsImporter implements TransactionImporter {
  readonly sourceKind = 'evo_visa_xls' as const

  async canHandle(input: ImportFileInput): Promise<boolean> {
    try {
      const result = parseWorkbook(input, 'inspect')

      return (
        result.detectedFormat === detectedFormat &&
        result.completedHeaderFound &&
        result.pendingSectionFound &&
        result.pendingHeaderFound
      )
    } catch {
      return false
    }
  }

  async inspect(input: ImportFileInput): Promise<ImportInspection> {
    const fileSha256 = await sha256File(input.filePath)
    const sourceFileName = basename(input.originalFileName)

    try {
      const result = parseWorkbook(input, 'inspect')
      const blockingWarnings = result.warnings.filter((warning) => warning.blocking)
      const completedCount = result.movements.filter(
        (movement) => movement.section === 'completed'
      ).length
      const pendingCount = result.movements.filter(
        (movement) => movement.section === 'pending'
      ).length
      const warnings = [...result.warnings, ...missingStructureWarnings(result)]
      const invalidRowCount = warnings.filter((warning) => warning.blocking).length

      return importInspectionSchema.parse({
        sourceKind: this.sourceKind,
        originalFileName: sourceFileName,
        fileSha256,
        detectedFormat: result.detectedFormat,
        completedCount,
        pendingCount,
        invalidRowCount,
        warningCount: warnings.length,
        canImport: blockingWarnings.length === 0 && invalidRowCount === 0,
        warnings
      })
    } catch {
      const warning: ImportWarning = {
        code: 'unsupported_format',
        message: 'The file is not a supported EVO/Bankinter Visa XLS export.',
        blocking: true
      }

      return importInspectionSchema.parse({
        sourceKind: this.sourceKind,
        originalFileName: sourceFileName,
        fileSha256,
        detectedFormat: 'unsupported',
        completedCount: 0,
        pendingCount: 0,
        invalidRowCount: 1,
        warningCount: 1,
        canImport: false,
        warnings: [warning]
      })
    }
  }

  async prepare(input: ImportFileInput, context: ImportContext): Promise<PreparedImport> {
    const fileSha256 = await sha256File(input.filePath)
    const result = parseWorkbook(input, 'prepare')
    const warnings = [...result.warnings, ...missingStructureWarnings(result)]
    const blockingWarnings = warnings.filter((warning) => warning.blocking)

    if (blockingWarnings.length > 0) {
      throw new ImportParseError()
    }

    const transactions = result.movements.map((movement) => {
      return newTransactionSchema.parse({
        ...movement.transaction,
        accountId: context.accountId
      })
    })

    return preparedImportSchema.parse({
      accountId: context.accountId,
      sourceKind: this.sourceKind,
      sourceFileName: result.sourceFileName,
      fileSha256,
      transactions
    })
  }
}

function parseWorkbook(input: ImportFileInput, mode: 'inspect' | 'prepare'): ParseResult {
  const fileInput = validateImportFileInput(input)
  const buffer = readFileSync(fileInput.filePath, { encoding: null, flag: 'r' })
  const header = buffer.subarray(0, 8)

  if (!header.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw new UnsupportedImportFormatError()
  }

  let workbook: XLSX.WorkBook

  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      raw: true,
      cellDates: false,
      WTF: mode === 'prepare'
    })
  } catch (error) {
    throw new UnsupportedImportFormatError('Unable to parse legacy Excel workbook', error)
  }

  const firstSheetName = workbook.SheetNames[0]

  if (!firstSheetName) {
    throw new UnsupportedImportFormatError('Workbook does not contain sheets')
  }

  const worksheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: true
  })

  return parseRows(rows, fileInput.sourceFileName)
}

function parseRows(rows: unknown[][], sourceFileName: string): ParseResult {
  const movements: ParsedMovement[] = []
  const warnings: ImportWarning[] = []
  let section: Section = 'none'
  let completedHeaderFound = false
  let pendingSectionFound = false
  let pendingHeaderFound = false

  rows.forEach((row, rowIndex) => {
    const sourceRowNumber = rowIndex + 1

    if (isBlankRow(row) || (section === 'none' && isDecorativePreambleRow(row))) {
      return
    }

    if (isPendingSectionRow(row)) {
      pendingSectionFound = true
      section = 'pending'
      return
    }

    if (isHeaderRow(row)) {
      if (section === 'pending') {
        pendingHeaderFound = true
      } else {
        section = 'completed'
        completedHeaderFound = true
      }

      return
    }

    if (isTotalRow(row)) {
      return
    }

    if (section === 'none') {
      return
    }

    if (!looksLikeMovementRow(row)) {
      warnings.push({
        sourceRowNumber,
        code: 'unrecognised_row',
        message: 'Unrecognised non-empty row inside a movement section.',
        blocking: true
      })
      return
    }

    const movement = parseMovementRow(row, rowIndex, section)

    if (movement.transaction) {
      movements.push(movement.transaction)
    }

    warnings.push(...movement.warnings.map((warning) => ({ ...warning, sourceRowNumber })))
  })

  return {
    detectedFormat,
    sourceFileName,
    completedHeaderFound,
    pendingSectionFound,
    pendingHeaderFound,
    movements,
    warnings
  }
}

function parseMovementRow(
  row: unknown[],
  sourceRowIndex: number,
  section: Exclude<Section, 'none'>
): {
  transaction?: ParsedMovement
  warnings: ImportWarning[]
} {
  const warnings: ImportWarning[] = []
  const [dateCell, descriptionCell, amountCell] = row
  let transactionDate: string | undefined
  let amountCents: number | undefined
  const description = typeof descriptionCell === 'string' ? descriptionCell.trim() : ''

  try {
    transactionDate = excelSerialDateToIsoDate(dateCell)
  } catch {
    warnings.push({
      code: 'invalid_date',
      field: 'transactionDate',
      message: 'Movement row has an invalid transaction date.',
      blocking: true
    })
  }

  if (!description) {
    warnings.push({
      code: 'blank_description',
      field: 'originalDescription',
      message: 'Movement row has a blank description.',
      blocking: true
    })
  }

  try {
    amountCents = parseVisaAmountCents(amountCell)
  } catch (error) {
    warnings.push({
      code:
        error instanceof ImportParseError && error.message === 'Zero amount'
          ? 'zero_amount'
          : 'invalid_amount',
      field: 'amountCents',
      message: 'Movement row has an invalid amount.',
      blocking: true
    })
  }

  if (!transactionDate || !description || amountCents === undefined) {
    return { warnings }
  }

  const transaction: NewTransaction = {
    accountId: '00000000-0000-4000-8000-000000000000',
    sourceRowIndex,
    transactionDate,
    originalDescription: description,
    amountCents,
    currency: 'EUR',
    transactionType: amountCents > 0 ? 'refund' : 'expense',
    isPending: section === 'pending',
    excludedFromSpending: false,
    reviewStatus: section === 'pending' ? 'needs_review' : 'confirmed'
  }

  return {
    transaction: {
      transaction,
      section
    },
    warnings
  }
}

function missingStructureWarnings(result: ParseResult): ImportWarning[] {
  const warnings: ImportWarning[] = []

  if (!result.completedHeaderFound) {
    warnings.push({
      code: 'missing_section',
      message: 'Completed movements section was not found.',
      blocking: true
    })
  }

  if (!result.pendingSectionFound || !result.pendingHeaderFound) {
    warnings.push({
      code: result.pendingSectionFound ? 'missing_required_column' : 'missing_section',
      message: 'Pending movements section was not found.',
      blocking: true
    })
  }

  return warnings
}

function isHeaderRow(row: unknown[]): boolean {
  const values = compactRow(row).map((value) => normalizeLabel(String(value)))

  return requiredHeader.every((header, index) => values[index] === normalizeLabel(header))
}

function isPendingSectionRow(row: unknown[]): boolean {
  return compactRow(row).some((value) => normalizeLabel(String(value)) === 'MOVIMIENTOS PENDIENTES')
}

function isTotalRow(row: unknown[]): boolean {
  const firstValue = compactRow(row)[0]

  return typeof firstValue === 'string' && normalizeLabel(firstValue).startsWith('TOTAL ')
}

function isDecorativePreambleRow(row: unknown[]): boolean {
  return compactRow(row).length === 1 && typeof compactRow(row)[0] === 'string'
}

function isBlankRow(row: unknown[]): boolean {
  return compactRow(row).length === 0
}

function looksLikeMovementRow(row: unknown[]): boolean {
  const [dateCell, descriptionCell, amountCell] = row

  return (
    compactRow(row).length > 1 &&
    (dateCell !== null || descriptionCell !== null || amountCell !== null)
  )
}

function compactRow(row: unknown[]): unknown[] {
  return row.filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}
