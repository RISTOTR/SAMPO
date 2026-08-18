import { z } from 'zod'
import {
  fileSha256Schema,
  importSourceKinds,
  isoDateSchema,
  type ImportSourceKind,
  type PreparedImport
} from '../domain/schemas'

export type ImportFileInput = {
  filePath: string
  originalFileName: string
}

export type ImportContext = {
  accountId: string
}

export const importWarningCodes = [
  'unsupported_format',
  'missing_section',
  'missing_required_column',
  'invalid_date',
  'invalid_amount',
  'blank_description',
  'zero_amount',
  'unrecognised_row',
  'ambiguous_sign',
  'duplicate_source_row',
  'missing_opening_balance',
  'missing_final_balance',
  'carried_balance_mismatch',
  'transaction_balance_mismatch',
  'final_balance_mismatch',
  'ambiguous_amount_column',
  'missing_transaction_amount',
  'missing_resulting_balance',
  'unsupported_layout',
  'unknown_table_row',
  'missing_text_layer',
  'encrypted_pdf',
  'pdf_parse_failed'
] as const

export const importWarningSchema = z.object({
  sourceRowNumber: z.number().int().min(1).optional(),
  pageNumber: z.number().int().min(1).optional(),
  visualRowNumber: z.number().int().min(1).optional(),
  code: z.enum(importWarningCodes),
  message: z.string().min(1),
  field: z.string().min(1).optional(),
  blocking: z.boolean()
})

export const pdfImportInspectionDetailsSchema = z.object({
  pageCount: z.number().int().min(0),
  transactionCount: z.number().int().min(0),
  invalidRowCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
  openingBalanceFound: z.boolean(),
  finalBalanceFound: z.boolean(),
  balanceContinuityPassed: z.boolean(),
  tableHeaderDetected: z.boolean()
})

export const importInspectionSchema = z.object({
  sourceKind: z.enum(importSourceKinds),
  originalFileName: z.string().min(1),
  fileSha256: fileSha256Schema,
  detectedFormat: z.string().min(1),
  completedCount: z.number().int().min(0),
  pendingCount: z.number().int().min(0),
  newTransactionCount: z.number().int().min(0).optional(),
  duplicateTransactionCount: z.number().int().min(0).optional(),
  invalidRowCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
  statementPeriodStart: isoDateSchema.optional(),
  statementPeriodEnd: isoDateSchema.optional(),
  canImport: z.boolean(),
  warnings: z.array(importWarningSchema),
  details: pdfImportInspectionDetailsSchema.optional()
})

export type ImportWarning = z.infer<typeof importWarningSchema>
export type ImportInspection = z.infer<typeof importInspectionSchema>

export interface TransactionImporter {
  readonly sourceKind: ImportSourceKind

  canHandle(input: ImportFileInput): Promise<boolean>

  inspect(input: ImportFileInput): Promise<ImportInspection>

  prepare(input: ImportFileInput, context: ImportContext): Promise<PreparedImport>
}
