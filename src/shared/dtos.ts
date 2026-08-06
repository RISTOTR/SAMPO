import { z } from 'zod'

export const accountKindDtoSchema = z.enum(['current', 'credit_card', 'cash', 'other'])
export const creatableAccountKindDtoSchema = z.enum(['current', 'credit_card'])
export const importSourceKindDtoSchema = z.enum(['evo_visa_xls', 'evo_account_pdf', 'unknown'])
export const importStatusDtoSchema = z.enum(['pending', 'committed', 'rolled_back', 'failed'])
export const transactionTypeDtoSchema = z.enum([
  'expense',
  'income',
  'transfer',
  'card_settlement',
  'refund',
  'fee',
  'cash_withdrawal',
  'tax',
  'unknown'
])
export const reviewStatusDtoSchema = z.enum(['confirmed', 'needs_review'])
export const sortDirectionDtoSchema = z.enum(['asc', 'desc'])
export const transactionSortByDtoSchema = z.enum(['transactionDate', 'amount'])

export const uuidDtoSchema = z.string().uuid()
export const isoDateDtoSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const utcTimestampDtoSchema = z.string().min(1)
export const sourceFileNameDtoSchema = z
  .string()
  .min(1)
  .refine((value) => !/[\\/]/.test(value), {
    message: 'Source filename must not include a path'
  })

export const operationErrorCodeDtoSchema = z.enum([
  'cancelled',
  'validation_error',
  'unsupported_file',
  'unsupported_account_source',
  'duplicate_import',
  'preview_expired',
  'source_file_changed',
  'entity_not_found',
  'account_in_use',
  'active_reconciliation',
  'amount_mismatch',
  'ambiguous_candidate',
  'invalid_reconciliation_state',
  'database_error',
  'unexpected_error'
])

export const operationErrorDtoSchema = z.object({
  code: operationErrorCodeDtoSchema,
  message: z.string().min(1)
})

export const accountSummaryDtoSchema = z.object({
  id: uuidDtoSchema,
  name: z.string().min(1),
  kind: accountKindDtoSchema,
  institution: z.string().min(1).optional(),
  currency: z.string().length(3),
  createdAt: utcTimestampDtoSchema,
  updatedAt: utcTimestampDtoSchema
})

export const createAccountInputDtoSchema = z.object({
  name: z.string().trim().min(1),
  kind: creatableAccountKindDtoSchema,
  institution: z.string().trim().min(1).optional(),
  currency: z.literal('EUR').default('EUR')
})

export const updateAccountInputDtoSchema = z.object({
  id: uuidDtoSchema,
  name: z.string().trim().min(1),
  institution: z.string().trim().min(1).optional()
})

export const importWarningDtoSchema = z.object({
  sourceRowNumber: z.number().int().min(1).optional(),
  pageNumber: z.number().int().min(1).optional(),
  visualRowNumber: z.number().int().min(1).optional(),
  code: z.string().min(1),
  message: z.string().min(1),
  field: z.string().min(1).optional(),
  blocking: z.boolean()
})

export const importInspectionDetailsDtoSchema = z
  .object({
    pageCount: z.number().int().min(0),
    transactionCount: z.number().int().min(0),
    invalidRowCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    openingBalanceFound: z.boolean(),
    finalBalanceFound: z.boolean(),
    balanceContinuityPassed: z.boolean(),
    tableHeaderDetected: z.boolean()
  })
  .optional()

export const importInspectionDtoSchema = z.object({
  sourceKind: importSourceKindDtoSchema,
  originalFileName: sourceFileNameDtoSchema,
  detectedFormat: z.string().min(1),
  completedCount: z.number().int().min(0),
  pendingCount: z.number().int().min(0),
  invalidRowCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
  statementPeriodStart: isoDateDtoSchema.optional(),
  statementPeriodEnd: isoDateDtoSchema.optional(),
  canImport: z.boolean(),
  warnings: z.array(importWarningDtoSchema),
  details: importInspectionDetailsDtoSchema
})

export const importPreviewTransactionDtoSchema = z.object({
  sourceRowIndex: z.number().int().min(0),
  transactionDate: isoDateDtoSchema,
  valueDate: isoDateDtoSchema.optional(),
  description: z.string().min(1),
  amountCents: z.number().int(),
  balanceCents: z.number().int().optional(),
  currency: z.string().length(3),
  transactionType: transactionTypeDtoSchema,
  isPending: z.boolean(),
  reviewStatus: reviewStatusDtoSchema
})

export const importPreviewSessionDtoSchema = z.object({
  id: uuidDtoSchema,
  accountId: uuidDtoSchema,
  sourceKind: importSourceKindDtoSchema,
  sourceFileName: sourceFileNameDtoSchema,
  inspection: importInspectionDtoSchema,
  transactions: z.array(importPreviewTransactionDtoSchema),
  createdAt: utcTimestampDtoSchema,
  expiresAt: utcTimestampDtoSchema
})

export const committedImportDtoSchema = z.object({
  batchId: uuidDtoSchema,
  transactionCount: z.number().int().min(0),
  sourceFileName: sourceFileNameDtoSchema,
  committedAt: utcTimestampDtoSchema.optional()
})

export const importBatchSummaryDtoSchema = z.object({
  id: uuidDtoSchema,
  accountId: uuidDtoSchema,
  accountName: z.string().min(1),
  sourceKind: importSourceKindDtoSchema,
  sourceFileName: sourceFileNameDtoSchema,
  statementPeriodStart: isoDateDtoSchema.optional(),
  statementPeriodEnd: isoDateDtoSchema.optional(),
  status: importStatusDtoSchema,
  transactionCount: z.number().int().min(0),
  createdAt: utcTimestampDtoSchema,
  committedAt: utcTimestampDtoSchema.optional(),
  rolledBackAt: utcTimestampDtoSchema.optional(),
  rollbackBlockedByReconciliation: z.boolean()
})

export const transactionListQueryDtoSchema = z.object({
  accountId: uuidDtoSchema.optional(),
  dateFrom: isoDateDtoSchema.optional(),
  dateTo: isoDateDtoSchema.optional(),
  transactionType: transactionTypeDtoSchema.optional(),
  pending: z.boolean().optional(),
  excludedFromSpending: z.boolean().optional(),
  sortBy: transactionSortByDtoSchema.default('transactionDate'),
  sortDirection: sortDirectionDtoSchema.default('desc'),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0)
})

export const transactionRowDtoSchema = z.object({
  id: uuidDtoSchema,
  accountId: uuidDtoSchema,
  accountName: z.string().min(1),
  importBatchId: uuidDtoSchema,
  transactionDate: isoDateDtoSchema,
  valueDate: isoDateDtoSchema.optional(),
  description: z.string().min(1),
  amountCents: z.number().int(),
  balanceCents: z.number().int().optional(),
  currency: z.string().length(3),
  transactionType: transactionTypeDtoSchema,
  isPending: z.boolean(),
  excludedFromSpending: z.boolean(),
  reviewStatus: reviewStatusDtoSchema,
  createdAt: utcTimestampDtoSchema
})

export const transactionPageDtoSchema = z.object({
  items: z.array(transactionRowDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0)
})

export const reconciliationWarningDtoSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  blocking: z.boolean()
})

export const settlementSummaryDtoSchema = z.object({
  id: uuidDtoSchema,
  accountId: uuidDtoSchema,
  accountName: z.string().min(1),
  transactionDate: isoDateDtoSchema,
  amountCents: z.number().int(),
  currency: z.string().length(3),
  reviewStatus: reviewStatusDtoSchema,
  reconciled: z.boolean(),
  excludedFromSpending: z.boolean()
})

export const reconciliationCandidateDtoSchema = z.object({
  settlementTransactionId: uuidDtoSchema,
  visaImportBatchId: uuidDtoSchema,
  visaAccountId: uuidDtoSchema,
  visaAccountName: z.string().min(1),
  statementPeriodStart: isoDateDtoSchema.optional(),
  statementPeriodEnd: isoDateDtoSchema.optional(),
  completedTransactionCount: z.number().int().min(0),
  pendingTransactionCount: z.number().int().min(0),
  settlementAmountCents: z.number().int(),
  visaNetAmountCents: z.number().int(),
  differenceCents: z.number().int(),
  earliestVisaDate: isoDateDtoSchema.optional(),
  latestVisaDate: isoDateDtoSchema.optional(),
  settlementDate: isoDateDtoSchema,
  exactAmountMatch: z.boolean(),
  dateOrderValid: z.boolean(),
  warnings: z.array(reconciliationWarningDtoSchema)
})

export const reconciliationPreviewDtoSchema = z.object({
  settlementTransactionId: uuidDtoSchema,
  visaImportBatchId: uuidDtoSchema,
  settlementAmountCents: z.number().int(),
  completedVisaTransactionCount: z.number().int().min(0),
  ignoredPendingTransactionCount: z.number().int().min(0),
  visaNetAmountCents: z.number().int(),
  differenceCents: z.number().int(),
  canCommit: z.boolean(),
  warnings: z.array(reconciliationWarningDtoSchema)
})

export const committedReconciliationDtoSchema = z.object({
  settlementTransactionId: uuidDtoSchema,
  visaImportBatchId: uuidDtoSchema,
  linkedTransactionCount: z.number().int().min(1),
  reconciledAt: utcTimestampDtoSchema
})

export const reversedReconciliationDtoSchema = z.object({
  settlementTransactionId: uuidDtoSchema,
  removedLinkCount: z.number().int().min(1),
  reversedAt: utcTimestampDtoSchema
})

export const overviewStatsDtoSchema = z.object({
  accountCount: z.number().int().min(0),
  committedImportCount: z.number().int().min(0),
  transactionCount: z.number().int().min(0),
  unreconciledCardSettlementCount: z.number().int().min(0)
})

export type AccountSummaryDto = z.infer<typeof accountSummaryDtoSchema>
export type CreateAccountInputDto = z.input<typeof createAccountInputDtoSchema>
export type UpdateAccountInputDto = z.input<typeof updateAccountInputDtoSchema>
export type OperationErrorDto = z.infer<typeof operationErrorDtoSchema>
export type OperationErrorCodeDto = z.infer<typeof operationErrorCodeDtoSchema>
export type ImportPreviewTransactionDto = z.infer<typeof importPreviewTransactionDtoSchema>
export type ImportPreviewSessionDto = z.infer<typeof importPreviewSessionDtoSchema>
export type CommittedImportDto = z.infer<typeof committedImportDtoSchema>
export type ImportBatchSummaryDto = z.infer<typeof importBatchSummaryDtoSchema>
export type TransactionListQueryDto = z.input<typeof transactionListQueryDtoSchema>
export type TransactionPageDto = z.infer<typeof transactionPageDtoSchema>
export type TransactionRowDto = z.infer<typeof transactionRowDtoSchema>
export type SettlementSummaryDto = z.infer<typeof settlementSummaryDtoSchema>
export type ReconciliationCandidateDto = z.infer<typeof reconciliationCandidateDtoSchema>
export type ReconciliationPreviewDto = z.infer<typeof reconciliationPreviewDtoSchema>
export type CommittedReconciliationDto = z.infer<typeof committedReconciliationDtoSchema>
export type ReversedReconciliationDto = z.infer<typeof reversedReconciliationDtoSchema>
export type OverviewStatsDto = z.infer<typeof overviewStatsDtoSchema>
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: OperationErrorDto }
