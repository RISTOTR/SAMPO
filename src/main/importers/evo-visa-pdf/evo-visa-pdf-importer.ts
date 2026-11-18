import { basename } from 'path'
import { ImportParseError, MissingPdfTextLayerError, EncryptedPdfError } from '../../domain/errors'
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
import { extractPositionedTextFromPdf } from '../evo-account-pdf/pdf-text-extraction'
import { parseVisaPdfText, visaPdfFormat, type VisaPdfParseResult } from './statement-parser'

export class EvoVisaPdfImporter implements TransactionImporter {
  readonly sourceKind = 'evo_visa_pdf' as const

  async canHandle(input: ImportFileInput): Promise<boolean> {
    try {
      return (await parsePdf(input)).recognized
    } catch {
      return false
    }
  }

  async inspect(input: ImportFileInput): Promise<ImportInspection> {
    let fileSha256 = '0'.repeat(64)
    let parsed: VisaPdfParseResult | undefined
    let warnings: ImportWarning[]
    try {
      validateImportFileInput(input, { maxBytes: MAX_PDF_BYTES, kindLabel: 'PDF' })
      fileSha256 = await sha256File(input.filePath)
      parsed = await parsePdf(input)
      warnings = parsed.warnings
    } catch (error) {
      warnings = [
        {
          code:
            error instanceof MissingPdfTextLayerError
              ? 'missing_text_layer'
              : error instanceof EncryptedPdfError
                ? 'encrypted_pdf'
                : 'pdf_parse_failed',
          message:
            'The Visa PDF could not be read safely. A readable, unencrypted statement is required.',
          blocking: true
        }
      ]
    }
    return importInspectionSchema.parse({
      sourceKind: this.sourceKind,
      originalFileName: basename(input.originalFileName),
      fileSha256,
      detectedFormat: parsed?.recognized ? visaPdfFormat : 'unsupported',
      completedCount: parsed?.transactions.length ?? 0,
      pendingCount: 0,
      invalidRowCount: warnings.filter((warning) => warning.blocking).length,
      warningCount: warnings.length,
      canImport: Boolean(
        parsed?.recognized && parsed.totalsVerified && !warnings.some((warning) => warning.blocking)
      ),
      warnings,
      statementPeriodStart: parsed?.statementPeriodStart,
      statementPeriodEnd: parsed?.statementPeriodEnd
    })
  }

  async prepare(input: ImportFileInput, context: ImportContext): Promise<PreparedImport> {
    const parsed = await parsePdf(input)
    if (
      !parsed.recognized ||
      !parsed.totalsVerified ||
      parsed.warnings.some((warning) => warning.blocking)
    )
      throw new ImportParseError('Visa PDF validation failed; no movements were imported')
    return preparedImportSchema.parse({
      accountId: context.accountId,
      sourceKind: this.sourceKind,
      sourceFileName: basename(input.originalFileName),
      fileSha256: await sha256File(input.filePath),
      statementTransactionCount: parsed.transactions.length,
      statementPeriodStart: parsed.statementPeriodStart,
      statementPeriodEnd: parsed.statementPeriodEnd,
      transactions: parsed.transactions.map((transaction) =>
        newTransactionSchema.parse({ ...transaction, accountId: context.accountId })
      )
    })
  }
}

async function parsePdf(input: ImportFileInput): Promise<VisaPdfParseResult> {
  const file = validateImportFileInput(input, { maxBytes: MAX_PDF_BYTES, kindLabel: 'PDF' })
  const text = await extractPositionedTextFromPdf(file.filePath)
  return parseVisaPdfText(text.pageCount, text.items)
}
