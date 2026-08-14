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
import { excelSerialDateToIsoDate, parseVisaAmountCents } from '../evo-visa/normalization'
import { normalizeLabel, parseEuropeanDate } from '../evo-account-pdf/normalization'
import { MAX_WORKBOOK_BYTES, validateImportFileInput } from '../shared/file-input'
import {
  importInspectionSchema,
  type ImportContext,
  type ImportFileInput,
  type ImportInspection,
  type ImportWarning,
  type TransactionImporter
} from '../types'

type HeaderIndexes = {
  transactionDate: number
  valueDate: number
  description: number
  amount: number
  balance: number
  currency: number
}

type ParseResult = {
  detectedFormat: string
  sourceFileName: string
  tableHeaderDetected: boolean
  transactions: Array<Omit<NewTransaction, 'accountId'>>
  warnings: ImportWarning[]
  statementPeriodStart?: string
  statementPeriodEnd?: string
}

const detectedFormat = 'evo_bankinter_account_excel_xlsx_v1'
const requiredHeaders = {
  transactionDate: 'FECHA CONTABLE',
  valueDate: 'FECHA VALOR',
  description: 'DESCRIPCION',
  amount: 'IMPORTE',
  balance: 'SALDO',
  currency: 'DIVISA'
} as const

export class EvoAccountExcelImporter implements TransactionImporter {
  readonly sourceKind = 'evo_account_excel' as const

  async canHandle(input: ImportFileInput): Promise<boolean> {
    try {
      const parsed = parseWorkbook(input)

      return parsed.tableHeaderDetected
    } catch {
      return false
    }
  }

  async inspect(input: ImportFileInput): Promise<ImportInspection> {
    const sourceFileName = basename(input.originalFileName)
    let fileSha256 = '0'.repeat(64)

    try {
      validateImportFileInput(input, { maxBytes: MAX_WORKBOOK_BYTES, kindLabel: 'workbook' })
      fileSha256 = await sha256File(input.filePath)
      const parsed = parseWorkbook(input)
      const invalidRowCount = parsed.warnings.filter((warning) => warning.blocking).length

      return importInspectionSchema.parse({
        sourceKind: this.sourceKind,
        originalFileName: sourceFileName,
        fileSha256,
        detectedFormat: parsed.detectedFormat,
        completedCount: parsed.transactions.length,
        pendingCount: 0,
        invalidRowCount,
        warningCount: parsed.warnings.length,
        statementPeriodStart: parsed.statementPeriodStart,
        statementPeriodEnd: parsed.statementPeriodEnd,
        canImport:
          parsed.tableHeaderDetected && parsed.transactions.length > 0 && invalidRowCount === 0,
        warnings: parsed.warnings
      })
    } catch {
      const warning: ImportWarning = {
        code: 'unsupported_format',
        message: 'The file is not a supported EVO/Bankinter account Excel workbook.',
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
    const fileInput = validateImportFileInput(input, {
      maxBytes: MAX_WORKBOOK_BYTES,
      kindLabel: 'workbook'
    })
    const fileSha256 = await sha256File(fileInput.filePath)
    const parsed = parseWorkbook(input)
    const blockingWarnings = parsed.warnings.filter((warning) => warning.blocking)

    if (
      !parsed.tableHeaderDetected ||
      parsed.transactions.length === 0 ||
      blockingWarnings.length > 0
    ) {
      throw new ImportParseError()
    }

    const transactions = parsed.transactions.map((transaction) =>
      newTransactionSchema.parse({
        ...transaction,
        accountId: context.accountId
      })
    )

    return preparedImportSchema.parse({
      accountId: context.accountId,
      sourceKind: this.sourceKind,
      sourceFileName: fileInput.sourceFileName,
      fileSha256,
      statementPeriodStart: parsed.statementPeriodStart,
      statementPeriodEnd: parsed.statementPeriodEnd,
      transactions
    })
  }
}

function parseWorkbook(input: ImportFileInput): ParseResult {
  const fileInput = validateImportFileInput(input, {
    maxBytes: MAX_WORKBOOK_BYTES,
    kindLabel: 'workbook'
  })
  const buffer = readFileSync(fileInput.filePath, { encoding: null, flag: 'r' })

  if (!hasOpenXmlWorkbookSignature(buffer)) {
    throw new UnsupportedImportFormatError('Import file is not an OOXML Excel workbook')
  }

  let workbook: XLSX.WorkBook

  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      raw: true,
      cellDates: false,
      WTF: false
    })
  } catch (error) {
    throw new UnsupportedImportFormatError('Unable to parse account Excel workbook', error)
  }

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: true
    })
    const parsed = parseRows(rows, fileInput.sourceFileName)

    if (parsed.tableHeaderDetected) {
      return parsed
    }
  }

  return {
    detectedFormat,
    sourceFileName: fileInput.sourceFileName,
    tableHeaderDetected: false,
    transactions: [],
    warnings: [
      {
        code: 'missing_required_column',
        message: 'Supported account Excel table header was not found.',
        blocking: true
      }
    ]
  }
}

function parseRows(rows: unknown[][], sourceFileName: string): ParseResult {
  const header = findHeaderRow(rows)

  if (!header) {
    return {
      detectedFormat,
      sourceFileName,
      tableHeaderDetected: false,
      transactions: [],
      warnings: [
        {
          code: 'missing_required_column',
          message: 'Supported account Excel table header was not found.',
          blocking: true
        }
      ]
    }
  }

  const transactions: Array<Omit<NewTransaction, 'accountId'>> = []
  const warnings: ImportWarning[] = []

  rows.slice(header.rowIndex + 1).forEach((row, offset) => {
    const sourceRowNumber = header.rowIndex + offset + 2

    if (isBlankRow(row)) {
      return
    }

    const parsed = parseMovementRow(row, transactions.length, header.indexes)

    if (parsed.transaction) {
      transactions.push(parsed.transaction)
    }

    warnings.push(...parsed.warnings.map((warning) => ({ ...warning, sourceRowNumber })))
  })

  if (transactions.length === 0) {
    warnings.push({
      code: 'unsupported_layout',
      message: 'No supported account Excel transactions were found.',
      blocking: true
    })
  }

  const transactionDates = transactions.map((transaction) => transaction.transactionDate).sort()

  return {
    detectedFormat,
    sourceFileName,
    tableHeaderDetected: true,
    transactions,
    warnings,
    statementPeriodStart: transactionDates[0],
    statementPeriodEnd: transactionDates.at(-1)
  }
}

function parseMovementRow(
  row: unknown[],
  sourceRowIndex: number,
  indexes: HeaderIndexes
): {
  transaction?: Omit<NewTransaction, 'accountId'>
  warnings: ImportWarning[]
} {
  const warnings: ImportWarning[] = []
  let transactionDate: string | undefined
  let valueDate: string | undefined
  let amountCents: number | undefined
  let balanceCents: number | undefined
  let currency: string | undefined
  const description = stringCell(row[indexes.description]).trim()

  try {
    transactionDate = parseExcelDateCell(row[indexes.transactionDate])
  } catch {
    warnings.push(
      safeRowWarning('invalid_date', 'Transaction row has an invalid date.', 'transactionDate')
    )
  }

  try {
    valueDate = parseExcelDateCell(row[indexes.valueDate])
  } catch {
    warnings.push(
      safeRowWarning('invalid_date', 'Transaction row has an invalid value date.', 'valueDate')
    )
  }

  if (!description) {
    warnings.push(
      safeRowWarning(
        'blank_description',
        'Transaction row has a blank description.',
        'originalDescription'
      )
    )
  }

  try {
    amountCents = parseVisaAmountCents(row[indexes.amount])
  } catch (error) {
    warnings.push(
      safeRowWarning(
        error instanceof ImportParseError && error.message === 'Zero amount'
          ? 'zero_amount'
          : 'invalid_amount',
        'Transaction row has an invalid amount.',
        'amountCents'
      )
    )
  }

  try {
    balanceCents = parseAccountExcelMoneyCents(row[indexes.balance], { allowZero: true })
  } catch {
    warnings.push(
      safeRowWarning(
        'missing_resulting_balance',
        'Transaction row is missing a valid resulting balance.',
        'balanceCents'
      )
    )
  }

  try {
    currency = parseCurrency(row[indexes.currency])
  } catch {
    warnings.push(
      safeRowWarning('unsupported_format', 'Transaction row has an invalid currency.', 'currency')
    )
  }

  if (
    !transactionDate ||
    !valueDate ||
    !description ||
    amountCents === undefined ||
    balanceCents === undefined ||
    !currency
  ) {
    return { warnings }
  }

  const isCardSettlement = isVisaSettlementDescription(description)

  return {
    transaction: {
      sourceRowIndex,
      transactionDate,
      valueDate,
      originalDescription: description,
      amountCents,
      balanceCents,
      currency,
      transactionType: isCardSettlement
        ? 'card_settlement'
        : amountCents > 0
          ? 'income'
          : 'expense',
      isPending: false,
      excludedFromSpending: false,
      reviewStatus: isCardSettlement ? 'needs_review' : 'confirmed'
    },
    warnings
  }
}

function findHeaderRow(
  rows: unknown[][]
): { rowIndex: number; indexes: HeaderIndexes } | undefined {
  for (const [rowIndex, row] of rows.entries()) {
    const normalizedCells = row.map((cell) => normalizeHeaderCell(cell))
    const indexes = {
      transactionDate: normalizedCells.indexOf(requiredHeaders.transactionDate),
      valueDate: normalizedCells.indexOf(requiredHeaders.valueDate),
      description: normalizedCells.indexOf(requiredHeaders.description),
      amount: normalizedCells.indexOf(requiredHeaders.amount),
      balance: normalizedCells.indexOf(requiredHeaders.balance),
      currency: normalizedCells.indexOf(requiredHeaders.currency)
    }

    if (Object.values(indexes).every((index) => index >= 0)) {
      return { rowIndex, indexes }
    }
  }

  return undefined
}

function parseExcelDateCell(value: unknown): string {
  if (typeof value === 'number') {
    return excelSerialDateToIsoDate(value)
  }

  if (value instanceof Date) {
    return isoDateFromDate(value)
  }

  if (typeof value === 'string') {
    return parseEuropeanDate(value)
  }

  throw new ImportParseError('Invalid account Excel date')
}

function parseAccountExcelMoneyCents(
  value: unknown,
  options: { allowZero: boolean } = { allowZero: false }
): number {
  let parsed: number

  try {
    parsed = parseVisaAmountCents(value)
  } catch (error) {
    if (options.allowZero && error instanceof ImportParseError && error.message === 'Zero amount') {
      return 0
    }

    throw error
  }

  return parsed
}

function parseCurrency(value: unknown): string {
  const currency = stringCell(value).trim().toUpperCase()

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ImportParseError('Invalid account Excel currency')
  }

  return currency
}

function isoDateFromDate(value: Date): string {
  const year = value.getUTCFullYear()
  const month = value.getUTCMonth() + 1
  const day = value.getUTCDate()

  if (year < 2000 || year > 2100) {
    throw new ImportParseError('Account Excel date is outside the supported range')
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function safeRowWarning(
  code: ImportWarning['code'],
  message: string,
  field: string
): ImportWarning {
  return {
    code,
    message,
    field,
    blocking: true
  }
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((value) => value === null || value === undefined || String(value).trim() === '')
}

function stringCell(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value)
}

function normalizeHeaderCell(value: unknown): string {
  return normalizeLabel(stringCell(value))
}

function isVisaSettlementDescription(description: string): boolean {
  return normalizeLabel(description).includes('RECIBO VISA CLASICA')
}

function hasOpenXmlWorkbookSignature(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
}
