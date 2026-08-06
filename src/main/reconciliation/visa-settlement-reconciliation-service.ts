import type { Database } from 'better-sqlite3'
import { EntityNotFoundError, ReconciliationError } from '../domain/errors'
import {
  committedSettlementReconciliationSchema,
  reconciliationCandidateSchema,
  reversedSettlementReconciliationSchema,
  settlementReconciliationPreviewSchema,
  type Account,
  type CommittedSettlementReconciliation,
  type ImportBatch,
  type ReconciliationCandidate,
  type ReconciliationWarning,
  type ReversedSettlementReconciliation,
  type SettlementReconciliationPreview,
  type Transaction
} from '../domain/schemas'
import { AccountRepository } from '../storage/accounts'
import { ImportBatchRepository } from '../storage/import-batches'
import { TransactionLinkRepository } from '../storage/transaction-links'
import { TransactionRepository } from '../storage/transactions'

type SettlementContext = {
  settlement: Transaction
  settlementBatch: ImportBatch
  settlementAccount: Account
  warnings: ReconciliationWarning[]
}

type VisaBatchContext = {
  batch: ImportBatch
  account: Account
  completedMovements: Transaction[]
  pendingCount: number
  alreadyLinkedDestinationIds: Set<string>
  warnings: ReconciliationWarning[]
}

type CandidateWithSort = ReconciliationCandidate & {
  dateGapDays: number
}

const dayMs = 24 * 60 * 60 * 1000
const unusualDateGapDays = 45

export class VisaSettlementReconciliationService {
  private readonly accounts: AccountRepository
  private readonly importBatches: ImportBatchRepository
  private readonly links: TransactionLinkRepository
  private readonly transactions: TransactionRepository

  constructor(private readonly database: Database) {
    this.accounts = new AccountRepository(database)
    this.importBatches = new ImportBatchRepository(database)
    this.links = new TransactionLinkRepository(database)
    this.transactions = new TransactionRepository(database)
  }

  findVisaSettlementCandidates(settlementTransactionId: string): ReconciliationCandidate[] {
    const settlementContext = this.getSettlementContext(settlementTransactionId)

    if (settlementContext.warnings.some((warning) => warning.blocking)) {
      throw new ReconciliationError('Settlement is not eligible for candidate discovery')
    }

    const candidates = this.importBatches
      .listCommittedBySourceKind('evo_visa_xls')
      .map((batch) => this.buildCandidate(settlementContext, batch))
      .filter((candidate): candidate is CandidateWithSort => Boolean(candidate))
      .sort(compareCandidates)

    const exactCandidates = candidates.filter((candidate) => candidate.exactAmountMatch)

    if (exactCandidates.length > 1) {
      return candidates.map((candidate) =>
        reconciliationCandidateSchema.parse({
          ...candidate,
          warnings: [
            ...candidate.warnings,
            warning('ambiguous_candidate', 'Multiple exact Visa batch candidates exist.', false)
          ]
        })
      )
    }

    return candidates.map((candidate) => reconciliationCandidateSchema.parse(candidate))
  }

  previewVisaSettlementReconciliation(
    settlementTransactionId: string,
    visaImportBatchId: string
  ): SettlementReconciliationPreview {
    const settlementContext = this.getSettlementContext(settlementTransactionId)
    const visaContext = this.getVisaBatchContext(
      visaImportBatchId,
      settlementContext.settlementAccount
    )
    const warnings = this.reconciliationWarnings(settlementContext, visaContext)
    const totals = visaTotals(visaContext.completedMovements)
    const differenceCents = settlementContext.settlement.amountCents - totals.netAmountCents

    if (differenceCents !== 0) {
      warnings.push(
        warning('amount_mismatch', 'Settlement amount does not match Visa net amount.', true)
      )
    }

    return settlementReconciliationPreviewSchema.parse({
      settlementTransactionId,
      visaImportBatchId,
      settlementAmountCents: settlementContext.settlement.amountCents,
      completedVisaTransactionCount: visaContext.completedMovements.length,
      ignoredPendingTransactionCount: visaContext.pendingCount,
      visaNetAmountCents: totals.netAmountCents,
      differenceCents,
      canCommit: warnings.every((item) => !item.blocking),
      warnings
    })
  }

  commitVisaSettlementReconciliation(
    settlementTransactionId: string,
    visaImportBatchId: string
  ): CommittedSettlementReconciliation {
    const commit = this.database.transaction(() => {
      const preview = this.previewVisaSettlementReconciliation(
        settlementTransactionId,
        visaImportBatchId
      )

      if (!preview.canCommit) {
        throw new ReconciliationError('Reconciliation preview contains blocking warnings')
      }

      const visaMovements =
        this.transactions.listEligibleVisaMovementsForImportBatch(visaImportBatchId)

      this.links.createMany(
        visaMovements.map((movement) => ({
          fromTransactionId: settlementTransactionId,
          toTransactionId: movement.id,
          kind: 'card_settlement'
        }))
      )

      const updated = this.transactions.updateReconciliationFlags(settlementTransactionId, {
        excludedFromSpending: true,
        reviewStatus: 'confirmed'
      })

      return committedSettlementReconciliationSchema.parse({
        settlementTransactionId,
        visaImportBatchId,
        linkedTransactionCount: visaMovements.length,
        reconciledAt: updated.updatedAt
      })
    })

    return commit()
  }

  reverseVisaSettlementReconciliation(
    settlementTransactionId: string
  ): ReversedSettlementReconciliation {
    const reverse = this.database.transaction(() => {
      this.transactions.findById(settlementTransactionId)
      const links = this.links.listCardSettlementLinksFromSettlement(settlementTransactionId)

      if (links.length === 0) {
        throw new ReconciliationError('Settlement does not have an active reconciliation')
      }

      const removedLinkCount =
        this.links.deleteCardSettlementLinksFromSettlement(settlementTransactionId)
      const updated = this.transactions.updateReconciliationFlags(settlementTransactionId, {
        excludedFromSpending: false,
        reviewStatus: 'needs_review'
      })

      return reversedSettlementReconciliationSchema.parse({
        settlementTransactionId,
        removedLinkCount,
        reversedAt: updated.updatedAt
      })
    })

    return reverse()
  }

  private buildCandidate(
    settlementContext: SettlementContext,
    batch: ImportBatch
  ): CandidateWithSort | undefined {
    const visaContext = this.getVisaBatchContext(batch.id, settlementContext.settlementAccount)

    if (
      visaContext.batch.status !== 'committed' ||
      visaContext.batch.sourceKind !== 'evo_visa_xls' ||
      visaContext.account.kind !== 'credit_card' ||
      visaContext.completedMovements.length === 0 ||
      visaContext.alreadyLinkedDestinationIds.size > 0
    ) {
      return undefined
    }

    const totals = visaTotals(visaContext.completedMovements)
    const differenceCents = settlementContext.settlement.amountCents - totals.netAmountCents
    const dateOrderValid =
      totals.latestDate === undefined ||
      settlementContext.settlement.transactionDate >= totals.latestDate
    const dateGapDaysValue = totals.latestDate
      ? dateGapDays(totals.latestDate, settlementContext.settlement.transactionDate)
      : Number.MAX_SAFE_INTEGER
    const warnings: ReconciliationWarning[] = []

    if (dateGapDaysValue > unusualDateGapDays && dateOrderValid) {
      warnings.push(warning('unusual_date_gap', 'Candidate date gap is unusually large.', false))
    }

    return {
      settlementTransactionId: settlementContext.settlement.id,
      visaImportBatchId: batch.id,
      visaAccountId: visaContext.account.id,
      completedTransactionCount: visaContext.completedMovements.length,
      pendingTransactionCount: visaContext.pendingCount,
      settlementAmountCents: settlementContext.settlement.amountCents,
      visaNetAmountCents: totals.netAmountCents,
      differenceCents,
      earliestVisaDate: totals.earliestDate,
      latestVisaDate: totals.latestDate,
      settlementDate: settlementContext.settlement.transactionDate,
      exactAmountMatch: differenceCents === 0,
      dateOrderValid,
      warnings,
      dateGapDays: dateGapDaysValue
    }
  }

  private getSettlementContext(settlementTransactionId: string): SettlementContext {
    const warnings: ReconciliationWarning[] = []
    const settlement = this.findTransaction(settlementTransactionId, 'settlement_not_found')
    const settlementBatch = this.importBatches.findById(settlement.importBatchId)
    const settlementAccount = this.accounts.findById(settlement.accountId)
    const settlementLinks = this.links.listCardSettlementLinksFromSettlement(settlement.id)

    if (settlementBatch.status !== 'committed') {
      warnings.push(
        warning('invalid_reconciliation_state', 'Settlement import batch is not committed.', true)
      )
    }

    if (settlementBatch.sourceKind !== 'evo_account_pdf') {
      warnings.push(
        warning('settlement_wrong_source', 'Settlement is not from an account PDF import.', true)
      )
    }

    if (settlementAccount.kind !== 'current') {
      warnings.push(
        warning(
          'settlement_account_wrong_kind',
          'Settlement account is not a current account.',
          true
        )
      )
    }

    if (settlement.transactionType !== 'card_settlement') {
      warnings.push(
        warning('settlement_wrong_type', 'Settlement transaction has the wrong type.', true)
      )
    }

    if (settlement.isPending) {
      warnings.push(warning('settlement_pending', 'Settlement transaction is pending.', true))
    }

    if (settlement.amountCents >= 0) {
      warnings.push(warning('settlement_non_negative', 'Settlement amount must be negative.', true))
    }

    if (settlementLinks.length > 0) {
      warnings.push(
        warning('settlement_already_reconciled', 'Settlement is already reconciled.', true)
      )
    }

    if (settlement.excludedFromSpending && settlementLinks.length === 0) {
      warnings.push(
        warning(
          'settlement_excluded_without_links',
          'Settlement is excluded without active reconciliation links.',
          true
        )
      )
    }

    return {
      settlement,
      settlementBatch,
      settlementAccount,
      warnings
    }
  }

  private getVisaBatchContext(
    visaImportBatchId: string,
    settlementAccount: Account
  ): VisaBatchContext {
    const warnings: ReconciliationWarning[] = []
    const batch = this.findImportBatch(visaImportBatchId, 'visa_batch_not_found')
    const account = this.accounts.findById(batch.accountId)
    const completedMovements = this.transactions.listEligibleVisaMovementsForImportBatch(batch.id)
    const pendingCount = this.transactions.countPendingForImportBatch(batch.id)
    const alreadyLinkedDestinationIds = this.links.listCardSettlementLinkedDestinationIds(
      completedMovements.map((movement) => movement.id)
    )

    if (batch.status !== 'committed') {
      warnings.push(
        warning('visa_batch_not_committed', 'Visa import batch is not committed.', true)
      )
    }

    if (batch.sourceKind !== 'evo_visa_xls') {
      warnings.push(
        warning('visa_batch_wrong_source', 'Visa import batch has the wrong source.', true)
      )
    }

    if (account.kind !== 'credit_card') {
      warnings.push(
        warning('visa_account_wrong_kind', 'Visa account is not a credit-card account.', true)
      )
    }

    if (account.currency !== settlementAccount.currency) {
      warnings.push(
        warning('currency_mismatch', 'Settlement and Visa account currencies differ.', true)
      )
    }

    if (completedMovements.length === 0) {
      warnings.push(
        warning('no_completed_visa_transactions', 'Visa batch has no completed movements.', true)
      )
    }

    if (alreadyLinkedDestinationIds.size > 0) {
      warnings.push(
        warning('visa_transaction_already_reconciled', 'Visa movement is already reconciled.', true)
      )
    }

    return {
      batch,
      account,
      completedMovements,
      pendingCount,
      alreadyLinkedDestinationIds,
      warnings
    }
  }

  private reconciliationWarnings(
    settlementContext: SettlementContext,
    visaContext: VisaBatchContext
  ): ReconciliationWarning[] {
    const warnings = [...settlementContext.warnings, ...visaContext.warnings]
    const totals = visaTotals(visaContext.completedMovements)

    if (totals.latestDate && settlementContext.settlement.transactionDate < totals.latestDate) {
      warnings.push(
        warning(
          'settlement_before_visa_movements',
          'Settlement date is before the latest included Visa movement.',
          true
        )
      )
    }

    return warnings
  }

  private findTransaction(id: string, code: ReconciliationWarning['code']): Transaction {
    try {
      return this.transactions.findById(id)
    } catch (error) {
      if (isEntityNotFound(error)) {
        throw new ReconciliationError(code, error)
      }

      throw error
    }
  }

  private findImportBatch(id: string, code: ReconciliationWarning['code']): ImportBatch {
    try {
      return this.importBatches.findById(id)
    } catch (error) {
      if (isEntityNotFound(error)) {
        throw new ReconciliationError(code, error)
      }

      throw error
    }
  }
}

function visaTotals(transactions: Transaction[]): {
  netAmountCents: number
  earliestDate?: string
  latestDate?: string
} {
  const dates = transactions.map((transaction) => transaction.transactionDate).sort()

  return {
    netAmountCents: transactions.reduce((sum, transaction) => sum + transaction.amountCents, 0),
    earliestDate: dates[0],
    latestDate: dates.at(-1)
  }
}

function warning(
  code: ReconciliationWarning['code'],
  message: string,
  blocking: boolean
): ReconciliationWarning {
  return {
    code,
    message,
    blocking
  }
}

function compareCandidates(left: CandidateWithSort, right: CandidateWithSort): number {
  return (
    Number(right.exactAmountMatch) - Number(left.exactAmountMatch) ||
    Number(right.dateOrderValid) - Number(left.dateOrderValid) ||
    left.dateGapDays - right.dateGapDays ||
    left.visaImportBatchId.localeCompare(right.visaImportBatchId)
  )
}

function dateGapDays(leftIsoDate: string, rightIsoDate: string): number {
  return (
    Math.abs(
      Date.parse(`${rightIsoDate}T00:00:00.000Z`) - Date.parse(`${leftIsoDate}T00:00:00.000Z`)
    ) / dayMs
  )
}

function isEntityNotFound(error: unknown): error is EntityNotFoundError {
  return error instanceof EntityNotFoundError
}
