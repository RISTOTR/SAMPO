import { basename } from 'path'
import {
  BalanceValidationError,
  ImportParseError,
  MissingPdfTextLayerError,
  UnsupportedImportFormatError,
  UnsupportedPdfFormatError,
  UnsupportedStatementLayoutError
} from '../../domain/errors'
import {
  newTransactionSchema,
  preparedImportSchema,
  type PreparedImport
} from '../../domain/schemas'
import { sha256File } from '../../utils/file-hash'
import { MAX_PDF_BYTES, validateImportFileInput } from '../shared/file-input'
import {
  importInspectionSchema,
  type ImportContext,
  type ImportFileInput,
  type ImportInspection,
  type ImportWarning,
  type TransactionImporter
} from '../types'
import { extractPositionedTextFromPdf } from './pdf-text-extraction'
import { parseAccountPdfText } from './statement-parser'

const unsupportedPdfWarning: ImportWarning = {
  code: 'unsupported_format',
  message: 'The file is not a supported EVO/Bankinter account statement PDF.',
  blocking: true
}

export class EvoAccountPdfImporter implements TransactionImporter {
  readonly sourceKind = 'evo_account_pdf' as const

  async canHandle(input: ImportFileInput): Promise<boolean> {
    try {
      const parsed = await parsePdf(input)

      return (
        parsed.detectedFormat === 'evo_bankinter_account_pdf_text_v1' &&
        parsed.tableHeaderDetected &&
        parsed.transactions.length > 0 &&
        parsed.warnings.every((warning) => !warning.blocking)
      )
    } catch {
      return false
    }
  }

  async inspect(input: ImportFileInput): Promise<ImportInspection> {
    const sourceFileName = basename(input.originalFileName)
    let fileSha256 = '0'.repeat(64)

    try {
      validateImportFileInput(input, { maxBytes: MAX_PDF_BYTES, kindLabel: 'PDF' })
      fileSha256 = await sha256File(input.filePath)
      const parsed = await parsePdf(input)
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
        canImport: invalidRowCount === 0,
        warnings: parsed.warnings,
        details: {
          pageCount: parsed.pageCount,
          transactionCount: parsed.transactions.length,
          invalidRowCount,
          warningCount: parsed.warnings.length,
          openingBalanceFound: parsed.openingBalanceFound,
          finalBalanceFound: parsed.finalBalanceFound,
          balanceContinuityPassed: parsed.balanceContinuityPassed,
          tableHeaderDetected: parsed.tableHeaderDetected
        }
      })
    } catch (error) {
      const warning = warningForError(error)

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
        warnings: [warning],
        details: {
          pageCount: 0,
          transactionCount: 0,
          invalidRowCount: 1,
          warningCount: 1,
          openingBalanceFound: false,
          finalBalanceFound: false,
          balanceContinuityPassed: false,
          tableHeaderDetected: false
        }
      })
    }
  }

  async prepare(input: ImportFileInput, context: ImportContext): Promise<PreparedImport> {
    const fileInput = validateImportFileInput(input, { maxBytes: MAX_PDF_BYTES, kindLabel: 'PDF' })
    const fileSha256 = await sha256File(fileInput.filePath)
    const parsed = await parsePdf(input)
    const blockingWarnings = parsed.warnings.filter((warning) => warning.blocking)

    if (blockingWarnings.length > 0) {
      const hasBalanceFailure = blockingWarnings.some((warning) =>
        [
          'carried_balance_mismatch',
          'transaction_balance_mismatch',
          'final_balance_mismatch'
        ].includes(warning.code)
      )

      if (hasBalanceFailure) {
        throw new BalanceValidationError()
      }

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

async function parsePdf(input: ImportFileInput): Promise<ReturnType<typeof parseAccountPdfText>> {
  const fileInput = validateImportFileInput(input, { maxBytes: MAX_PDF_BYTES, kindLabel: 'PDF' })
  const extracted = await extractPositionedTextFromPdf(fileInput.filePath)
  const parsed = parseAccountPdfText(extracted.pageCount, extracted.items)

  if (!parsed.tableHeaderDetected) {
    throw new UnsupportedStatementLayoutError()
  }

  return parsed
}

function warningForError(error: unknown): ImportWarning {
  if (error instanceof MissingPdfTextLayerError) {
    return {
      code: 'missing_text_layer',
      message: 'The PDF does not contain a usable text layer.',
      blocking: true
    }
  }

  if (error instanceof UnsupportedPdfFormatError || error instanceof UnsupportedImportFormatError) {
    return unsupportedPdfWarning
  }

  if (error instanceof UnsupportedStatementLayoutError) {
    return {
      code: 'unsupported_layout',
      message: 'The PDF does not match the supported account statement layout.',
      blocking: true
    }
  }

  return {
    code: 'pdf_parse_failed',
    message: 'The PDF could not be parsed safely.',
    blocking: true
  }
}
