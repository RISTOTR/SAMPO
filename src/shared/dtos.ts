import { z } from 'zod'

export const accountKindDtoSchema = z.enum(['current', 'credit_card', 'cash', 'other'])
export const creatableAccountKindDtoSchema = z.enum(['current', 'credit_card'])
export const importSourceKindDtoSchema = z.enum([
  'evo_visa_xls',
  'evo_account_pdf',
  'evo_account_excel',
  'unknown'
])
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
export const transactionConfirmationFilterDtoSchema = z.enum([
  'all',
  'needs_confirmation',
  'confirmed'
])
export const aliasMatchKindDtoSchema = z.enum(['exact', 'starts_with', 'contains'])
export const usageTypeDtoSchema = z.enum(['personal', 'business', 'mixed', 'unspecified'])
export const costBehaviourDtoSchema = z.enum(['fixed', 'variable', 'unspecified'])
export const necessityDtoSchema = z.enum(['essential', 'discretionary', 'unspecified'])
export const classificationSourceDtoSchema = z.enum(['manual', 'rule', 'ai', 'unclassified'])
export const classificationStatusDtoSchema = z.enum(['confirmed', 'needs_review', 'ambiguous'])
export const aiSuggestionStatusDtoSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
  'superseded',
  'failed'
])
export const aiConnectionStatusDtoSchema = z.enum([
  'connected',
  'invalid_request',
  'invalid_key',
  'permission_error',
  'model_not_found',
  'quota_or_rate_limit',
  'timeout',
  'network_error',
  'service_error'
])
export const recurringSeriesTypeDtoSchema = z.enum([
  'subscription',
  'recurring_bill',
  'recurring_payment',
  'unknown',
  'not_recurring'
])
export const recurringSeriesCadenceDtoSchema = z.enum([
  'monthly',
  'quarterly',
  'yearly',
  'irregular'
])
export const recurringSeriesStatusDtoSchema = z.enum(['candidate', 'confirmed', 'rejected'])
export const recurringSeriesConfidenceDtoSchema = z.enum(['low', 'medium', 'high'])
export const recurringSeriesMatchingBasisDtoSchema = z.enum(['merchant', 'description'])

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
  'category_not_found',
  'category_in_use',
  'category_cycle',
  'duplicate_category',
  'merchant_not_found',
  'duplicate_merchant',
  'alias_conflict',
  'rule_not_found',
  'invalid_rule',
  'ambiguous_classification',
  'manual_classification_preserved',
  'bulk_update_conflict',
  'entity_in_use',
  'ai_not_configured',
  'ai_disabled',
  'ai_invalid_request',
  'ai_unprocessable_request',
  'ai_invalid_key',
  'ai_permission_error',
  'ai_model_not_found',
  'ai_rate_limited',
  'ai_quota_exceeded',
  'ai_timeout',
  'ai_network_error',
  'ai_service_error',
  'ai_invalid_response',
  'ai_partial_response',
  'ai_suggestion_not_found',
  'ai_invalid_suggestion_acceptance',
  'ai_web_lookup_disabled',
  'ai_web_lookup_failed',
  'secret_storage_unavailable',
  'secret_corrupted',
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
  newTransactionCount: z.number().int().min(0).optional(),
  duplicateTransactionCount: z.number().int().min(0).optional(),
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
  search: z.string().trim().min(1).max(100).optional(),
  confirmationFilter: transactionConfirmationFilterDtoSchema.default('all'),
  accountId: uuidDtoSchema.optional(),
  dateFrom: isoDateDtoSchema.optional(),
  dateTo: isoDateDtoSchema.optional(),
  transactionType: transactionTypeDtoSchema.optional(),
  pending: z.boolean().optional(),
  excludedFromSpending: z.boolean().optional(),
  categoryId: uuidDtoSchema.optional(),
  merchantId: uuidDtoSchema.optional(),
  usageType: usageTypeDtoSchema.optional(),
  costBehaviour: costBehaviourDtoSchema.optional(),
  necessity: necessityDtoSchema.optional(),
  classificationStatus: classificationStatusDtoSchema.optional(),
  unclassifiedOnly: z.boolean().optional(),
  sortBy: transactionSortByDtoSchema.default('transactionDate'),
  sortDirection: sortDirectionDtoSchema.default('desc'),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0)
})

export const classificationSummaryDtoSchema = z.object({
  merchantId: uuidDtoSchema.optional(),
  merchantName: z.string().min(1).optional(),
  merchantDisplay: z
    .object({
      authoritativeId: uuidDtoSchema.optional(),
      authoritativeName: z.string().min(1).optional(),
      detectedName: z.string().min(1).optional(),
      displayName: z.string().min(1).optional(),
      source: z.enum(['authoritative', 'detected', 'unknown'])
    })
    .optional(),
  categoryId: uuidDtoSchema.optional(),
  categoryPath: z.array(z.string().min(1)).optional(),
  categoryDisplay: z
    .object({
      authoritativeId: uuidDtoSchema.optional(),
      authoritativePath: z.array(z.string().min(1)).optional(),
      detectedId: uuidDtoSchema.optional(),
      detectedPath: z.array(z.string().min(1)).optional(),
      displayPath: z.array(z.string().min(1)).optional(),
      source: z.enum(['authoritative', 'detected', 'unknown'])
    })
    .optional(),
  usageType: usageTypeDtoSchema,
  costBehaviour: costBehaviourDtoSchema,
  necessity: necessityDtoSchema,
  classificationSource: classificationSourceDtoSchema,
  classificationStatus: classificationStatusDtoSchema,
  appliedRuleId: uuidDtoSchema.optional(),
  appliedRuleName: z.string().min(1).optional()
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
  classification: classificationSummaryDtoSchema.optional(),
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
  unreconciledCardSettlementCount: z.number().int().min(0),
  classifiedTransactionCount: z.number().int().min(0).optional(),
  unclassifiedTransactionCount: z.number().int().min(0).optional(),
  classificationNeedsReviewCount: z.number().int().min(0).optional(),
  activeCategorisationRuleCount: z.number().int().min(0).optional()
})

export const categoryDtoSchema = z.object({
  id: uuidDtoSchema,
  key: z.string().min(1).optional(),
  name: z.string().min(1),
  parentId: uuidDtoSchema.optional(),
  sortOrder: z.number().int(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  createdAt: utcTimestampDtoSchema,
  updatedAt: utcTimestampDtoSchema
})

export const createCategoryInputDtoSchema = z.object({
  name: z.string().trim().min(1),
  parentId: uuidDtoSchema.optional(),
  sortOrder: z.number().int().default(0)
})

export const updateCategoryInputDtoSchema = createCategoryInputDtoSchema.extend({
  id: uuidDtoSchema
})

export const merchantDtoSchema = z.object({
  id: uuidDtoSchema,
  name: z.string().min(1),
  createdAt: utcTimestampDtoSchema,
  updatedAt: utcTimestampDtoSchema
})

export const merchantListQueryDtoSchema = z.object({
  search: z.string().trim().min(1).optional()
})

export const createMerchantInputDtoSchema = z.object({
  name: z.string().trim().min(1)
})

export const updateMerchantInputDtoSchema = createMerchantInputDtoSchema.extend({
  id: uuidDtoSchema
})

export const merchantAliasDtoSchema = z.object({
  id: uuidDtoSchema,
  merchantId: uuidDtoSchema,
  matchKind: aliasMatchKindDtoSchema,
  pattern: z.string().min(1),
  priority: z.number().int(),
  isActive: z.boolean(),
  createdAt: utcTimestampDtoSchema,
  updatedAt: utcTimestampDtoSchema
})

export const createMerchantAliasInputDtoSchema = z.object({
  merchantId: uuidDtoSchema,
  matchKind: aliasMatchKindDtoSchema,
  pattern: z.string().trim().min(1),
  priority: z.number().int().default(0)
})

export const updateMerchantAliasInputDtoSchema = createMerchantAliasInputDtoSchema.extend({
  id: uuidDtoSchema
})

export const classificationConflictDtoSchema = z.object({
  field: z.enum(['merchant', 'category', 'usageType', 'costBehaviour', 'necessity']),
  reason: z.string().min(1)
})

export const classificationProposalDtoSchema = z.object({
  transactionId: uuidDtoSchema,
  merchantId: uuidDtoSchema.optional(),
  merchantName: z.string().min(1).optional(),
  merchantDisplay: z
    .object({
      authoritativeId: uuidDtoSchema.optional(),
      authoritativeName: z.string().min(1).optional(),
      detectedName: z.string().min(1).optional(),
      displayName: z.string().min(1).optional(),
      source: z.enum(['authoritative', 'detected', 'unknown'])
    })
    .optional(),
  categoryId: uuidDtoSchema.optional(),
  categoryPath: z.array(z.string().min(1)).optional(),
  categoryDisplay: z
    .object({
      authoritativeId: uuidDtoSchema.optional(),
      authoritativePath: z.array(z.string().min(1)).optional(),
      detectedId: uuidDtoSchema.optional(),
      detectedPath: z.array(z.string().min(1)).optional(),
      displayPath: z.array(z.string().min(1)).optional(),
      source: z.enum(['authoritative', 'detected', 'unknown'])
    })
    .optional(),
  usageType: usageTypeDtoSchema,
  costBehaviour: costBehaviourDtoSchema,
  necessity: necessityDtoSchema,
  matchedRuleId: uuidDtoSchema.optional(),
  matchedRuleName: z.string().min(1).optional(),
  status: classificationStatusDtoSchema,
  source: classificationSourceDtoSchema,
  conflicts: z.array(classificationConflictDtoSchema)
})

export const saveManualClassificationInputDtoSchema = z.object({
  transactionId: uuidDtoSchema,
  merchantId: uuidDtoSchema.optional(),
  merchantName: z.string().trim().min(1).optional(),
  categoryId: uuidDtoSchema.optional(),
  usageType: usageTypeDtoSchema.default('unspecified'),
  costBehaviour: costBehaviourDtoSchema.default('unspecified'),
  necessity: necessityDtoSchema.default('unspecified')
})

export const matchingClassificationSummaryInputDtoSchema = saveManualClassificationInputDtoSchema

export const matchingClassificationSummaryDtoSchema = z.object({
  transactionId: uuidDtoSchema,
  totalMatchingTransactionCount: z.number().int().min(1),
  otherMatchingTransactionCount: z.number().int().min(0),
  eligibleCount: z.number().int().min(0),
  manualMerchantPreservedCount: z.number().int().min(0),
  manualCategoryPreservedCount: z.number().int().min(0)
})

export const saveManualAndConfirmMatchesResultDtoSchema = z.object({
  classification: classificationProposalDtoSchema,
  confirmedMatchingTransactionCount: z.number().int().min(0),
  matchingSummary: matchingClassificationSummaryDtoSchema
})

export const ruleInputDtoSchema = z.object({
  name: z.string().trim().min(1),
  merchantId: uuidDtoSchema.optional(),
  descriptionMatchKind: aliasMatchKindDtoSchema.optional(),
  descriptionPattern: z.string().trim().min(1).optional(),
  categoryId: uuidDtoSchema.optional(),
  usageType: usageTypeDtoSchema.default('unspecified'),
  costBehaviour: costBehaviourDtoSchema.default('unspecified'),
  necessity: necessityDtoSchema.default('unspecified'),
  priority: z.number().int().default(0)
})

export const categorisationRuleDtoSchema = ruleInputDtoSchema.extend({
  id: uuidDtoSchema,
  isActive: z.boolean(),
  createdAt: utcTimestampDtoSchema,
  updatedAt: utcTimestampDtoSchema
})

export const ruleApplicationPreviewDtoSchema = z.object({
  matchCount: z.number().int().min(0),
  manualPreservedCount: z.number().int().min(0),
  ruleChangeCount: z.number().int().min(0),
  ambiguousCount: z.number().int().min(0),
  unchangedCount: z.number().int().min(0),
  proposals: z.array(classificationProposalDtoSchema)
})

export const applyRuleInputDtoSchema = z.object({
  ruleId: uuidDtoSchema,
  overwriteRuleClassifications: z.boolean().default(false)
})

export const bulkClassificationInputDtoSchema = z.object({
  transactionIds: z.array(uuidDtoSchema).min(1).max(100),
  merchantId: uuidDtoSchema.optional(),
  categoryId: uuidDtoSchema.optional(),
  usageType: usageTypeDtoSchema.optional(),
  costBehaviour: costBehaviourDtoSchema.optional(),
  necessity: necessityDtoSchema.optional(),
  markConfirmed: z.boolean().default(true),
  overwriteManual: z.boolean().default(false)
})

export const bulkClassificationResultDtoSchema = z.object({
  updatedCount: z.number().int().min(0)
})

export const aiModelInfoDtoSchema = z.object({
  bulkClassificationModel: z.string().min(1),
  webLookupModel: z.string().min(1),
  reasoningEffort: z.string().min(1),
  webReasoningEffort: z.string().min(1)
})

export const aiSettingsDtoSchema = z.object({
  keyConfigured: z.boolean(),
  aiEnabled: z.boolean(),
  classifyNewImports: z.boolean(),
  allowWebLookup: z.boolean(),
  autoAcceptHighConfidence: z.boolean(),
  country: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  models: aiModelInfoDtoSchema
})

export const updateAiSettingsInputDtoSchema = z.object({
  aiEnabled: z.boolean().optional(),
  classifyNewImports: z.boolean().optional(),
  allowWebLookup: z.boolean().optional(),
  autoAcceptHighConfidence: z.boolean().optional(),
  country: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional()
})

export const saveOpenAiApiKeyInputDtoSchema = z.object({
  apiKey: z.string().trim().min(1)
})

export const aiConnectionTestDtoSchema = z.object({
  status: aiConnectionStatusDtoSchema
})

export const aiSuggestionDtoSchema = z.object({
  id: uuidDtoSchema,
  transactionId: uuidDtoSchema,
  currentMerchantName: z.string().min(1).optional(),
  suggestedMerchantName: z.string().min(1).optional(),
  currentCategoryPath: z.array(z.string().min(1)).optional(),
  suggestedCategoryId: uuidDtoSchema.optional(),
  suggestedCategoryPath: z.array(z.string().min(1)).optional(),
  merchantConfidence: z.number().int().min(0).max(1000),
  categoryConfidence: z.number().int().min(0).max(1000),
  merchantConfidenceBand: z.enum(['high', 'medium', 'low']),
  categoryConfidenceBand: z.enum(['high', 'medium', 'low']),
  needsWebLookup: z.boolean(),
  status: aiSuggestionStatusDtoSchema,
  usedWebSearch: z.boolean(),
  reasonCode: z.enum([
    'known_brand',
    'merchant_name_signal',
    'local_business_signal',
    'category_signal_only',
    'ambiguous',
    'unknown'
  ]),
  canAcceptCategory: z.boolean().optional(),
  canAcceptMerchant: z.boolean().optional(),
  createdAt: utcTimestampDtoSchema,
  reviewedAt: utcTimestampDtoSchema.optional()
})

export const aiSuggestionReviewComponentStatusDtoSchema = z.enum([
  'accepted',
  'preserved_manual',
  'preserved_confirmed',
  'not_suggested'
])

export const aiSuggestionReviewDtoSchema = z.object({
  suggestion: aiSuggestionDtoSchema,
  category: aiSuggestionReviewComponentStatusDtoSchema,
  merchant: aiSuggestionReviewComponentStatusDtoSchema,
  suggestionStatus: aiSuggestionStatusDtoSchema
})

export const smartClassifyInputDtoSchema = z.object({
  transactionIds: z.array(uuidDtoSchema).min(1).max(200),
  allowWebLookup: z.boolean().optional()
})

export const smartClassifyBatchInputDtoSchema = z.object({
  importBatchId: uuidDtoSchema
})

export const smartClassifySummaryDtoSchema = z.object({
  eligibleTransactionCount: z.number().int().min(0),
  uniqueDescriptionCount: z.number().int().min(0),
  suggestionsCreated: z.number().int().min(0),
  highConfidenceCategories: z.number().int().min(0),
  mediumConfidenceCategories: z.number().int().min(0),
  lowConfidenceCategories: z.number().int().min(0),
  unknownCategories: z.number().int().min(0),
  canonicalMerchantsSuggested: z.number().int().min(0),
  webLookupsPerformed: z.number().int().min(0),
  skippedDeterministicOrManual: z.number().int().min(0)
})

export const acceptAiSuggestionInputDtoSchema = z.object({
  suggestionId: uuidDtoSchema,
  acceptCategory: z.boolean().default(true),
  acceptMerchant: z.boolean().default(true)
})

export const rejectAiSuggestionInputDtoSchema = z.object({
  suggestionId: uuidDtoSchema
})

export const listAiSuggestionsInputDtoSchema = z
  .object({
    transactionQuery: transactionListQueryDtoSchema.omit({ limit: true, offset: true }).partial()
  })
  .partial()

export const recurringSeriesOccurrenceDtoSchema = z.object({
  transactionId: uuidDtoSchema,
  transactionDate: isoDateDtoSchema,
  description: z.string().min(1),
  amountCents: z.number().int(),
  currency: z.string().length(3),
  merchantName: z.string().min(1).optional(),
  categoryPath: z.array(z.string().min(1)).optional()
})

export const recurringSeriesDtoSchema = z.object({
  id: uuidDtoSchema,
  seriesKey: z.string().min(1),
  matchingBasis: recurringSeriesMatchingBasisDtoSchema,
  merchantId: uuidDtoSchema.optional(),
  merchantName: z.string().min(1).optional(),
  canonicalDescription: z.string().min(1),
  recurrenceType: recurringSeriesTypeDtoSchema,
  cadence: recurringSeriesCadenceDtoSchema,
  status: recurringSeriesStatusDtoSchema,
  typicalAmountCents: z.number().int(),
  minAmountCents: z.number().int(),
  maxAmountCents: z.number().int(),
  amountVariabilityBasisPoints: z.number().int().min(0),
  firstSeen: isoDateDtoSchema,
  lastSeen: isoDateDtoSchema,
  occurrenceCount: z.number().int().min(2),
  confidence: recurringSeriesConfidenceDtoSchema,
  confidenceScore: z.number().int().min(0).max(100),
  createdAt: utcTimestampDtoSchema,
  updatedAt: utcTimestampDtoSchema
})

export const recurringSeriesDetailDtoSchema = recurringSeriesDtoSchema.extend({
  occurrences: z.array(recurringSeriesOccurrenceDtoSchema)
})

export const recurringScanSummaryDtoSchema = z.object({
  candidateCount: z.number().int().min(0),
  confirmedCount: z.number().int().min(0),
  rejectedCount: z.number().int().min(0),
  scannedGroupCount: z.number().int().min(0),
  linkedTransactionCount: z.number().int().min(0)
})

export const recurringConfirmInputDtoSchema = z.object({
  seriesId: uuidDtoSchema,
  recurrenceType: recurringSeriesTypeDtoSchema.exclude(['unknown', 'not_recurring'])
})

export const recurringRejectInputDtoSchema = z.object({
  seriesId: uuidDtoSchema
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
export type ClassificationSummaryDto = z.infer<typeof classificationSummaryDtoSchema>
export type SettlementSummaryDto = z.infer<typeof settlementSummaryDtoSchema>
export type ReconciliationCandidateDto = z.infer<typeof reconciliationCandidateDtoSchema>
export type ReconciliationPreviewDto = z.infer<typeof reconciliationPreviewDtoSchema>
export type CommittedReconciliationDto = z.infer<typeof committedReconciliationDtoSchema>
export type ReversedReconciliationDto = z.infer<typeof reversedReconciliationDtoSchema>
export type OverviewStatsDto = z.infer<typeof overviewStatsDtoSchema>
export type CategoryDto = z.infer<typeof categoryDtoSchema>
export type CreateCategoryInputDto = z.input<typeof createCategoryInputDtoSchema>
export type UpdateCategoryInputDto = z.input<typeof updateCategoryInputDtoSchema>
export type MerchantDto = z.infer<typeof merchantDtoSchema>
export type MerchantListQueryDto = z.input<typeof merchantListQueryDtoSchema>
export type CreateMerchantInputDto = z.input<typeof createMerchantInputDtoSchema>
export type UpdateMerchantInputDto = z.input<typeof updateMerchantInputDtoSchema>
export type MerchantAliasDto = z.infer<typeof merchantAliasDtoSchema>
export type CreateMerchantAliasInputDto = z.input<typeof createMerchantAliasInputDtoSchema>
export type UpdateMerchantAliasInputDto = z.input<typeof updateMerchantAliasInputDtoSchema>
export type ClassificationProposalDto = z.infer<typeof classificationProposalDtoSchema>
export type SaveManualClassificationInputDto = z.input<
  typeof saveManualClassificationInputDtoSchema
>
export type MatchingClassificationSummaryInputDto = z.input<
  typeof matchingClassificationSummaryInputDtoSchema
>
export type MatchingClassificationSummaryDto = z.infer<
  typeof matchingClassificationSummaryDtoSchema
>
export type SaveManualAndConfirmMatchesResultDto = z.infer<
  typeof saveManualAndConfirmMatchesResultDtoSchema
>
export type RuleInputDto = z.input<typeof ruleInputDtoSchema>
export type CategorisationRuleDto = z.infer<typeof categorisationRuleDtoSchema>
export type RuleApplicationPreviewDto = z.infer<typeof ruleApplicationPreviewDtoSchema>
export type ApplyRuleInputDto = z.input<typeof applyRuleInputDtoSchema>
export type BulkClassificationInputDto = z.input<typeof bulkClassificationInputDtoSchema>
export type BulkClassificationResultDto = z.infer<typeof bulkClassificationResultDtoSchema>
export type AiSettingsDto = z.infer<typeof aiSettingsDtoSchema>
export type UpdateAiSettingsInputDto = z.input<typeof updateAiSettingsInputDtoSchema>
export type SaveOpenAiApiKeyInputDto = z.input<typeof saveOpenAiApiKeyInputDtoSchema>
export type AiConnectionTestDto = z.infer<typeof aiConnectionTestDtoSchema>
export type AiSuggestionDto = z.infer<typeof aiSuggestionDtoSchema>
export type AiSuggestionReviewDto = z.infer<typeof aiSuggestionReviewDtoSchema>
export type SmartClassifyInputDto = z.input<typeof smartClassifyInputDtoSchema>
export type SmartClassifyBatchInputDto = z.input<typeof smartClassifyBatchInputDtoSchema>
export type SmartClassifySummaryDto = z.infer<typeof smartClassifySummaryDtoSchema>
export type AcceptAiSuggestionInputDto = z.input<typeof acceptAiSuggestionInputDtoSchema>
export type RejectAiSuggestionInputDto = z.input<typeof rejectAiSuggestionInputDtoSchema>
export type ListAiSuggestionsInputDto = z.input<typeof listAiSuggestionsInputDtoSchema>
export type RecurringSeriesTypeDto = z.infer<typeof recurringSeriesTypeDtoSchema>
export type RecurringSeriesDto = z.infer<typeof recurringSeriesDtoSchema>
export type RecurringSeriesDetailDto = z.infer<typeof recurringSeriesDetailDtoSchema>
export type RecurringSeriesOccurrenceDto = z.infer<typeof recurringSeriesOccurrenceDtoSchema>
export type RecurringScanSummaryDto = z.infer<typeof recurringScanSummaryDtoSchema>
export type RecurringConfirmInputDto = z.input<typeof recurringConfirmInputDtoSchema>
export type RecurringRejectInputDto = z.input<typeof recurringRejectInputDtoSchema>
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: OperationErrorDto }
