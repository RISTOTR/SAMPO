import type {
  Account,
  AiClassificationSuggestion,
  CategorisationRule,
  Category,
  ImportBatch,
  ImportSourceKind,
  Merchant,
  MerchantAlias,
  NewTransaction,
  ReconciliationCandidate,
  SettlementReconciliationPreview,
  Transaction,
  TransactionClassification
} from '../domain/schemas'
import type { ClassificationProposal } from '../categorisation/classification-service'
import type { ImportInspection } from '../importers/types'
import type {
  AccountSummaryDto,
  AiSuggestionDto,
  CategorisationRuleDto,
  CategoryDto,
  ClassificationProposalDto,
  ClassificationSummaryDto,
  ImportBatchSummaryDto,
  ImportPreviewTransactionDto,
  MerchantAliasDto,
  MerchantDto,
  ReconciliationCandidateDto,
  ReconciliationPreviewDto,
  SettlementSummaryDto,
  TransactionRowDto
} from '../../shared/dtos'
import { confidenceBand } from '../ai/config'

export function accountToDto(account: Account): AccountSummaryDto {
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
    institution: account.institution,
    currency: account.currency,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  }
}

export function inspectionToDto(
  inspection: ImportInspection
): Omit<ImportInspection, 'fileSha256'> {
  return {
    sourceKind: inspection.sourceKind,
    originalFileName: inspection.originalFileName,
    detectedFormat: inspection.detectedFormat,
    completedCount: inspection.completedCount,
    pendingCount: inspection.pendingCount,
    invalidRowCount: inspection.invalidRowCount,
    warningCount: inspection.warningCount,
    statementPeriodStart: inspection.statementPeriodStart,
    statementPeriodEnd: inspection.statementPeriodEnd,
    canImport: inspection.canImport,
    warnings: inspection.warnings,
    details: inspection.details
  }
}

export function previewTransactionToDto(
  transaction: Omit<NewTransaction, 'accountId'>
): ImportPreviewTransactionDto {
  return {
    sourceRowIndex: transaction.sourceRowIndex,
    transactionDate: transaction.transactionDate,
    valueDate: transaction.valueDate,
    description: transaction.originalDescription,
    amountCents: transaction.amountCents,
    balanceCents: transaction.balanceCents,
    currency: transaction.currency ?? 'EUR',
    transactionType: transaction.transactionType,
    isPending: transaction.isPending ?? false,
    reviewStatus: transaction.reviewStatus ?? (transaction.isPending ? 'needs_review' : 'confirmed')
  }
}

export function transactionToRowDto(
  transaction: Transaction,
  account: Account,
  classification?: ClassificationSummaryDto
): TransactionRowDto {
  return {
    id: transaction.id,
    accountId: transaction.accountId,
    accountName: account.name,
    importBatchId: transaction.importBatchId,
    transactionDate: transaction.transactionDate,
    valueDate: transaction.valueDate,
    description: transaction.originalDescription,
    amountCents: transaction.amountCents,
    balanceCents: transaction.balanceCents,
    currency: transaction.currency,
    transactionType: transaction.transactionType,
    isPending: transaction.isPending,
    excludedFromSpending: transaction.excludedFromSpending,
    reviewStatus: transaction.reviewStatus,
    classification,
    createdAt: transaction.createdAt
  }
}

export function categoryToDto(category: Category): CategoryDto {
  return {
    id: category.id,
    key: category.key,
    name: category.name,
    parentId: category.parentId,
    sortOrder: category.sortOrder,
    isSystem: category.isSystem,
    isActive: category.isActive,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt
  }
}

export function merchantToDto(merchant: Merchant): MerchantDto {
  return {
    id: merchant.id,
    name: merchant.name,
    createdAt: merchant.createdAt,
    updatedAt: merchant.updatedAt
  }
}

export function merchantAliasToDto(alias: MerchantAlias): MerchantAliasDto {
  return {
    id: alias.id,
    merchantId: alias.merchantId,
    matchKind: alias.matchKind,
    pattern: alias.pattern,
    priority: alias.priority,
    isActive: alias.isActive,
    createdAt: alias.createdAt,
    updatedAt: alias.updatedAt
  }
}

export function ruleToDto(rule: CategorisationRule): CategorisationRuleDto {
  return {
    id: rule.id,
    name: rule.name,
    merchantId: rule.merchantId,
    descriptionMatchKind: rule.descriptionMatchKind,
    descriptionPattern: rule.descriptionPattern,
    categoryId: rule.categoryId,
    usageType: rule.usageType,
    costBehaviour: rule.costBehaviour,
    necessity: rule.necessity,
    priority: rule.priority,
    isActive: rule.isActive,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt
  }
}

export function proposalToDto(proposal: ClassificationProposal): ClassificationProposalDto {
  return {
    transactionId: proposal.transactionId,
    merchantId: proposal.merchantId,
    merchantName: proposal.merchantName,
    categoryId: proposal.categoryId,
    categoryPath: proposal.categoryPath,
    usageType: proposal.usageType,
    costBehaviour: proposal.costBehaviour,
    necessity: proposal.necessity,
    matchedRuleId: proposal.matchedRuleId,
    matchedRuleName: proposal.matchedRuleName,
    status: proposal.status,
    source: proposal.source,
    conflicts: proposal.conflicts
  }
}

export function classificationToSummaryDto(input: {
  classification: TransactionClassification
  merchantName?: string
  categoryPath?: string[]
  appliedRuleName?: string
}): ClassificationSummaryDto {
  return {
    merchantId: input.classification.merchantId,
    merchantName: input.merchantName,
    categoryId: input.classification.categoryId,
    categoryPath: input.categoryPath,
    usageType: input.classification.usageType,
    costBehaviour: input.classification.costBehaviour,
    necessity: input.classification.necessity,
    classificationSource: input.classification.classificationSource,
    classificationStatus: input.classification.classificationStatus,
    appliedRuleId: input.classification.appliedRuleId,
    appliedRuleName: input.appliedRuleName
  }
}

export function aiSuggestionToDto(input: {
  suggestion: AiClassificationSuggestion
  categoryPath?: string[]
  canAcceptCategory?: boolean
  canAcceptMerchant?: boolean
}): AiSuggestionDto {
  return {
    id: input.suggestion.id,
    transactionId: input.suggestion.transactionId,
    suggestedMerchantName: input.suggestion.suggestedMerchantName,
    suggestedCategoryId: input.suggestion.suggestedCategoryId,
    suggestedCategoryPath: input.categoryPath,
    merchantConfidence: input.suggestion.merchantConfidence,
    categoryConfidence: input.suggestion.categoryConfidence,
    merchantConfidenceBand: confidenceBand(input.suggestion.merchantConfidence),
    categoryConfidenceBand: confidenceBand(input.suggestion.categoryConfidence),
    needsWebLookup: input.suggestion.needsWebLookup,
    status: input.suggestion.status,
    usedWebSearch: input.suggestion.usedWebSearch,
    reasonCode: input.suggestion.reasonCode,
    canAcceptCategory: input.canAcceptCategory,
    canAcceptMerchant: input.canAcceptMerchant,
    createdAt: input.suggestion.createdAt,
    reviewedAt: input.suggestion.reviewedAt
  }
}

export function importBatchToDto(
  batch: ImportBatch,
  account: Account,
  rollbackBlockedByReconciliation: boolean
): ImportBatchSummaryDto {
  return {
    id: batch.id,
    accountId: batch.accountId,
    accountName: account.name,
    sourceKind: batch.sourceKind as ImportSourceKind,
    sourceFileName: batch.sourceFileName,
    statementPeriodStart: batch.statementPeriodStart,
    statementPeriodEnd: batch.statementPeriodEnd,
    status: batch.status,
    transactionCount: batch.transactionCount,
    createdAt: batch.createdAt,
    committedAt: batch.committedAt,
    rolledBackAt: batch.rolledBackAt,
    rollbackBlockedByReconciliation
  }
}

export function settlementToDto(
  settlement: Transaction,
  account: Account,
  reconciled: boolean
): SettlementSummaryDto {
  return {
    id: settlement.id,
    accountId: settlement.accountId,
    accountName: account.name,
    transactionDate: settlement.transactionDate,
    amountCents: settlement.amountCents,
    currency: settlement.currency,
    reviewStatus: settlement.reviewStatus,
    reconciled,
    excludedFromSpending: settlement.excludedFromSpending
  }
}

export function candidateToDto(
  candidate: ReconciliationCandidate,
  visaAccount: Account,
  visaBatch: ImportBatch
): ReconciliationCandidateDto {
  return {
    settlementTransactionId: candidate.settlementTransactionId,
    visaImportBatchId: candidate.visaImportBatchId,
    visaAccountId: candidate.visaAccountId,
    visaAccountName: visaAccount.name,
    statementPeriodStart: visaBatch.statementPeriodStart,
    statementPeriodEnd: visaBatch.statementPeriodEnd,
    completedTransactionCount: candidate.completedTransactionCount,
    pendingTransactionCount: candidate.pendingTransactionCount,
    settlementAmountCents: candidate.settlementAmountCents,
    visaNetAmountCents: candidate.visaNetAmountCents,
    differenceCents: candidate.differenceCents,
    earliestVisaDate: candidate.earliestVisaDate,
    latestVisaDate: candidate.latestVisaDate,
    settlementDate: candidate.settlementDate,
    exactAmountMatch: candidate.exactAmountMatch,
    dateOrderValid: candidate.dateOrderValid,
    warnings: candidate.warnings
  }
}

export function reconciliationPreviewToDto(
  preview: SettlementReconciliationPreview
): ReconciliationPreviewDto {
  return {
    settlementTransactionId: preview.settlementTransactionId,
    visaImportBatchId: preview.visaImportBatchId,
    settlementAmountCents: preview.settlementAmountCents,
    completedVisaTransactionCount: preview.completedVisaTransactionCount,
    ignoredPendingTransactionCount: preview.ignoredPendingTransactionCount,
    visaNetAmountCents: preview.visaNetAmountCents,
    differenceCents: preview.differenceCents,
    canCommit: preview.canCommit,
    warnings: preview.warnings
  }
}
