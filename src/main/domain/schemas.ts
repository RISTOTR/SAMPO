import { z } from 'zod'

export const accountKinds = ['current', 'credit_card', 'cash', 'other'] as const
export const importSourceKinds = [
  'evo_visa_xls',
  'evo_account_pdf',
  'evo_account_excel',
  'unknown'
] as const
export const importStatuses = ['pending', 'committed', 'rolled_back', 'failed'] as const
export const transactionTypes = [
  'expense',
  'income',
  'transfer',
  'card_settlement',
  'refund',
  'fee',
  'cash_withdrawal',
  'tax',
  'unknown'
] as const
export const reviewStatuses = ['confirmed', 'needs_review'] as const
export const transactionLinkKinds = [
  'card_settlement',
  'own_account_transfer',
  'refund',
  'related'
] as const
export const aliasMatchKinds = ['exact', 'starts_with', 'contains'] as const
export const usageTypes = ['personal', 'business', 'mixed', 'unspecified'] as const
export const costBehaviours = ['fixed', 'variable', 'unspecified'] as const
export const necessities = ['essential', 'discretionary', 'unspecified'] as const
export const classificationSources = ['manual', 'rule', 'ai', 'unclassified'] as const
export const classificationStatuses = ['confirmed', 'needs_review', 'ambiguous'] as const
export const aiSuggestionStatuses = [
  'pending',
  'accepted',
  'rejected',
  'superseded',
  'failed'
] as const

export const reconciliationWarningCodes = [
  'settlement_not_found',
  'settlement_wrong_type',
  'settlement_pending',
  'settlement_non_negative',
  'settlement_already_reconciled',
  'settlement_wrong_source',
  'settlement_account_wrong_kind',
  'settlement_excluded_without_links',
  'visa_batch_not_found',
  'visa_batch_not_committed',
  'visa_batch_wrong_source',
  'visa_account_wrong_kind',
  'currency_mismatch',
  'no_completed_visa_transactions',
  'visa_transaction_already_reconciled',
  'amount_mismatch',
  'settlement_before_visa_movements',
  'ambiguous_candidate',
  'active_reconciliation',
  'invalid_reconciliation_state',
  'unusual_date_gap'
] as const

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const sha256Pattern = /^[a-f0-9]{64}$/

export const uuidSchema = z.string().uuid()
export const isoDateSchema = z
  .string()
  .regex(isoDatePattern)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: 'Invalid ISO date'
  })
export const utcTimestampSchema = z.string().regex(utcTimestampPattern)
export const currencySchema = z.string().regex(/^[A-Z]{3}$/)
export const nonBlankStringSchema = z.string().trim().min(1)
export const integerCentsSchema = z.number().int().safe()
export const nonZeroIntegerCentsSchema = integerCentsSchema.refine((value) => value !== 0, {
  message: 'Zero-value transactions are not accepted in the Phase 1 domain model'
})
export const fileSha256Schema = z.string().regex(sha256Pattern)

export const accountSchema = z.object({
  id: uuidSchema,
  name: nonBlankStringSchema,
  kind: z.enum(accountKinds),
  institution: z.string().trim().min(1).optional(),
  currency: currencySchema,
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema
})

export const newAccountSchema = z.object({
  name: nonBlankStringSchema,
  kind: z.enum(accountKinds),
  institution: z.string().trim().min(1).optional(),
  currency: currencySchema.default('EUR')
})

export const importBatchSchema = z.object({
  id: uuidSchema,
  accountId: uuidSchema,
  sourceKind: z.enum(importSourceKinds),
  sourceFileName: nonBlankStringSchema,
  fileSha256: fileSha256Schema,
  statementPeriodStart: isoDateSchema.optional(),
  statementPeriodEnd: isoDateSchema.optional(),
  status: z.enum(importStatuses),
  transactionCount: z.number().int().min(0),
  createdAt: utcTimestampSchema,
  committedAt: utcTimestampSchema.optional(),
  rolledBackAt: utcTimestampSchema.optional()
})

export const newImportBatchSchema = z.object({
  accountId: uuidSchema,
  sourceKind: z.enum(importSourceKinds),
  sourceFileName: nonBlankStringSchema,
  fileSha256: fileSha256Schema,
  statementPeriodStart: isoDateSchema.optional(),
  statementPeriodEnd: isoDateSchema.optional()
})

export const transactionSchema = z.object({
  id: uuidSchema,
  importBatchId: uuidSchema,
  accountId: uuidSchema,
  sourceRowIndex: z.number().int().min(0),
  transactionDate: isoDateSchema,
  valueDate: isoDateSchema.optional(),
  reference: z.string().trim().min(1).optional(),
  originalDescription: nonBlankStringSchema,
  normalizedMerchant: z.string().trim().min(1).optional(),
  amountCents: nonZeroIntegerCentsSchema,
  balanceCents: integerCentsSchema.optional(),
  currency: currencySchema,
  transactionType: z.enum(transactionTypes),
  isPending: z.boolean(),
  excludedFromSpending: z.boolean(),
  reviewStatus: z.enum(reviewStatuses),
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema
})

export const newTransactionSchema = z
  .object({
    accountId: uuidSchema,
    sourceRowIndex: z.number().int().min(0),
    transactionDate: isoDateSchema,
    valueDate: isoDateSchema.optional(),
    reference: z.string().trim().min(1).optional(),
    originalDescription: nonBlankStringSchema,
    normalizedMerchant: z.string().trim().min(1).optional(),
    amountCents: nonZeroIntegerCentsSchema,
    balanceCents: integerCentsSchema.optional(),
    currency: currencySchema.default('EUR'),
    transactionType: z.enum(transactionTypes),
    isPending: z.boolean().default(false),
    excludedFromSpending: z.boolean().default(false),
    reviewStatus: z.enum(reviewStatuses).optional()
  })
  .transform((transaction) => ({
    ...transaction,
    reviewStatus: transaction.reviewStatus ?? (transaction.isPending ? 'needs_review' : 'confirmed')
  }))

export const transactionLinkSchema = z.object({
  id: uuidSchema,
  fromTransactionId: uuidSchema,
  toTransactionId: uuidSchema,
  kind: z.enum(transactionLinkKinds),
  createdAt: utcTimestampSchema
})

export const newTransactionLinkSchema = z
  .object({
    fromTransactionId: uuidSchema,
    toTransactionId: uuidSchema,
    kind: z.enum(transactionLinkKinds)
  })
  .refine((link) => link.fromTransactionId !== link.toTransactionId, {
    message: 'A transaction cannot link to itself',
    path: ['toTransactionId']
  })

export const preparedImportSchema = z.object({
  accountId: uuidSchema,
  sourceKind: z.enum(importSourceKinds),
  sourceFileName: nonBlankStringSchema,
  fileSha256: fileSha256Schema,
  statementPeriodStart: isoDateSchema.optional(),
  statementPeriodEnd: isoDateSchema.optional(),
  transactions: z.array(newTransactionSchema).min(1)
})

export const categorySchema = z.object({
  id: uuidSchema,
  key: z.string().trim().min(1).optional(),
  name: nonBlankStringSchema,
  parentId: uuidSchema.optional(),
  sortOrder: z.number().int(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema
})

export const merchantSchema = z.object({
  id: uuidSchema,
  name: nonBlankStringSchema,
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema
})

export const merchantAliasSchema = z.object({
  id: uuidSchema,
  merchantId: uuidSchema,
  matchKind: z.enum(aliasMatchKinds),
  pattern: nonBlankStringSchema,
  normalisedPattern: nonBlankStringSchema,
  priority: z.number().int(),
  isActive: z.boolean(),
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema
})

export const categorisationRuleSchema = z.object({
  id: uuidSchema,
  name: nonBlankStringSchema,
  merchantId: uuidSchema.optional(),
  descriptionMatchKind: z.enum(aliasMatchKinds).optional(),
  descriptionPattern: z.string().trim().min(1).optional(),
  normalisedDescriptionPattern: z.string().trim().min(1).optional(),
  categoryId: uuidSchema.optional(),
  usageType: z.enum(usageTypes),
  costBehaviour: z.enum(costBehaviours),
  necessity: z.enum(necessities),
  priority: z.number().int(),
  isActive: z.boolean(),
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema
})

export const transactionClassificationSchema = z.object({
  transactionId: uuidSchema,
  merchantId: uuidSchema.optional(),
  merchantSource: z.enum(['manual', 'rule', 'ai']).optional(),
  categoryId: uuidSchema.optional(),
  categorySource: z.enum(['manual', 'rule', 'ai']).optional(),
  usageType: z.enum(usageTypes),
  costBehaviour: z.enum(costBehaviours),
  necessity: z.enum(necessities),
  classificationSource: z.enum(classificationSources),
  classificationStatus: z.enum(classificationStatuses),
  appliedRuleId: uuidSchema.optional(),
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema
})

export const aiClassificationSuggestionSchema = z.object({
  id: uuidSchema,
  transactionId: uuidSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  suggestedMerchantName: z.string().trim().min(1).optional(),
  suggestedCategoryId: uuidSchema.optional(),
  merchantConfidence: z.number().int().min(0).max(1000),
  categoryConfidence: z.number().int().min(0).max(1000),
  needsWebLookup: z.boolean(),
  status: z.enum(aiSuggestionStatuses),
  usedWebSearch: z.boolean(),
  reasonCode: z.enum([
    'known_brand',
    'merchant_name_signal',
    'local_business_signal',
    'category_signal_only',
    'ambiguous',
    'unknown'
  ]),
  createdAt: utcTimestampSchema,
  reviewedAt: utcTimestampSchema.optional()
})

export const reconciliationWarningSchema = z.object({
  code: z.enum(reconciliationWarningCodes),
  message: z.string().min(1),
  blocking: z.boolean()
})

export const reconciliationCandidateSchema = z.object({
  settlementTransactionId: uuidSchema,
  visaImportBatchId: uuidSchema,
  visaAccountId: uuidSchema,
  completedTransactionCount: z.number().int().min(0),
  pendingTransactionCount: z.number().int().min(0),
  settlementAmountCents: integerCentsSchema,
  visaNetAmountCents: integerCentsSchema,
  differenceCents: integerCentsSchema,
  earliestVisaDate: isoDateSchema.optional(),
  latestVisaDate: isoDateSchema.optional(),
  settlementDate: isoDateSchema,
  exactAmountMatch: z.boolean(),
  dateOrderValid: z.boolean(),
  warnings: z.array(reconciliationWarningSchema).default([])
})

export const settlementReconciliationPreviewSchema = z.object({
  settlementTransactionId: uuidSchema,
  visaImportBatchId: uuidSchema,
  settlementAmountCents: integerCentsSchema,
  completedVisaTransactionCount: z.number().int().min(0),
  ignoredPendingTransactionCount: z.number().int().min(0),
  visaNetAmountCents: integerCentsSchema,
  differenceCents: integerCentsSchema,
  canCommit: z.boolean(),
  warnings: z.array(reconciliationWarningSchema)
})

export const committedSettlementReconciliationSchema = z.object({
  settlementTransactionId: uuidSchema,
  visaImportBatchId: uuidSchema,
  linkedTransactionCount: z.number().int().min(1),
  reconciledAt: utcTimestampSchema
})

export const reversedSettlementReconciliationSchema = z.object({
  settlementTransactionId: uuidSchema,
  removedLinkCount: z.number().int().min(1),
  reversedAt: utcTimestampSchema
})

export type Account = z.infer<typeof accountSchema>
export type NewAccount = z.input<typeof newAccountSchema>
export type ImportBatch = z.infer<typeof importBatchSchema>
export type NewImportBatch = z.input<typeof newImportBatchSchema>
export type Transaction = z.infer<typeof transactionSchema>
export type NewTransaction = z.input<typeof newTransactionSchema>
export type NormalizedNewTransaction = z.output<typeof newTransactionSchema>
export type TransactionLink = z.infer<typeof transactionLinkSchema>
export type NewTransactionLink = z.input<typeof newTransactionLinkSchema>
export type PreparedImport = z.input<typeof preparedImportSchema>
export type NormalizedPreparedImport = z.output<typeof preparedImportSchema>
export type ReconciliationWarning = z.infer<typeof reconciliationWarningSchema>
export type ReconciliationCandidate = z.infer<typeof reconciliationCandidateSchema>
export type SettlementReconciliationPreview = z.infer<typeof settlementReconciliationPreviewSchema>
export type CommittedSettlementReconciliation = z.infer<
  typeof committedSettlementReconciliationSchema
>
export type ReversedSettlementReconciliation = z.infer<
  typeof reversedSettlementReconciliationSchema
>
export type AccountKind = (typeof accountKinds)[number]
export type ImportStatus = (typeof importStatuses)[number]
export type ImportSourceKind = (typeof importSourceKinds)[number]
export type TransactionType = (typeof transactionTypes)[number]
export type AliasMatchKind = (typeof aliasMatchKinds)[number]
export type UsageType = (typeof usageTypes)[number]
export type CostBehaviour = (typeof costBehaviours)[number]
export type Necessity = (typeof necessities)[number]
export type ClassificationSource = (typeof classificationSources)[number]
export type ClassificationStatus = (typeof classificationStatuses)[number]
export type Category = z.infer<typeof categorySchema>
export type Merchant = z.infer<typeof merchantSchema>
export type MerchantAlias = z.infer<typeof merchantAliasSchema>
export type CategorisationRule = z.infer<typeof categorisationRuleSchema>
export type TransactionClassification = z.infer<typeof transactionClassificationSchema>
export type AiClassificationSuggestion = z.infer<typeof aiClassificationSuggestionSchema>
export type AiSuggestionStatus = (typeof aiSuggestionStatuses)[number]
