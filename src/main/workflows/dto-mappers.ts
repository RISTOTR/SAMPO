import type {
  Account,
  ImportBatch,
  ImportSourceKind,
  NewTransaction,
  ReconciliationCandidate,
  SettlementReconciliationPreview,
  Transaction
} from '../domain/schemas'
import type { ImportInspection } from '../importers/types'
import type {
  AccountSummaryDto,
  ImportBatchSummaryDto,
  ImportPreviewTransactionDto,
  ReconciliationCandidateDto,
  ReconciliationPreviewDto,
  SettlementSummaryDto,
  TransactionRowDto
} from '../../shared/dtos'

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

export function transactionToRowDto(transaction: Transaction, account: Account): TransactionRowDto {
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
    createdAt: transaction.createdAt
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
