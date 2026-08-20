import type { Database } from 'better-sqlite3'
import {
  AccountMismatchError,
  ActiveReconciliationError,
  DuplicateImportError,
  InvalidImportStatusTransitionError
} from '../domain/errors'
import {
  preparedImportSchema,
  type ImportBatch,
  type NewTransaction,
  type PreparedImport,
  type Transaction
} from '../domain/schemas'
import { AccountRepository } from '../storage/accounts'
import { ImportBatchRepository } from '../storage/import-batches'
import { TransactionLinkRepository } from '../storage/transaction-links'
import { TransactionRepository } from '../storage/transactions'
import { ClassificationService } from '../categorisation/classification-service'
import { createTransactionFingerprint } from './transaction-fingerprint'

export type CommitPreparedImportResult = {
  batch: ImportBatch
  transactions: Transaction[]
  skippedDuplicateTransactionCount: number
}

export type PreparedImportDuplicatePreview = {
  preparedImport: PreparedImport
  originalTransactionCount: number
  newTransactionCount: number
  duplicateTransactionCount: number
}

type PendingPromotion = {
  existingTransactionId: string
  incomingTransaction: NewTransaction
}

type DeduplicatedPreparedImport = PreparedImportDuplicatePreview & {
  pendingPromotions: PendingPromotion[]
}

export class ImportService {
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

  previewPreparedImportDeduplication(input: PreparedImport): PreparedImportDuplicatePreview {
    return this.filterDuplicateTransactions(preparedImportSchema.parse(input))
  }

  commitPreparedImport(input: PreparedImport): CommitPreparedImportResult {
    const preparedImport = preparedImportSchema.parse(input)
    this.accounts.findById(preparedImport.accountId)

    if (
      this.importBatches.findCommittedDuplicate(preparedImport.accountId, preparedImport.fileSha256)
    ) {
      throw new DuplicateImportError()
    }

    const commit = this.database.transaction(() => {
      const deduplicated = this.filterDuplicateTransactions(preparedImport)
      const batch = this.importBatches.createPending({
        accountId: preparedImport.accountId,
        sourceKind: preparedImport.sourceKind,
        sourceFileName: preparedImport.sourceFileName,
        fileSha256: preparedImport.fileSha256,
        statementPeriodStart: preparedImport.statementPeriodStart,
        statementPeriodEnd: preparedImport.statementPeriodEnd
      })

      const transactions = deduplicated.preparedImport.transactions.map((transaction) => {
        if (transaction.accountId !== preparedImport.accountId) {
          throw new AccountMismatchError()
        }

        return this.transactions.insertForImportBatch({
          importBatchId: batch.id,
          batchAccountId: batch.accountId,
          transaction
        })
      })
      const promotedTransactions = deduplicated.pendingPromotions.map((promotion) =>
        this.transactions.promotePendingToCompleted(promotion.existingTransactionId, {
          transactionType: promotion.incomingTransaction.transactionType,
          reviewStatus: promotion.incomingTransaction.reviewStatus ?? 'confirmed'
        })
      )

      const committedBatch = this.importBatches.markCommitted(batch.id, transactions.length)

      return {
        batch: committedBatch,
        transactions,
        promotedTransactions,
        skippedDuplicateTransactionCount: deduplicated.duplicateTransactionCount
      }
    })

    const result = commit()

    try {
      new ClassificationService(this.database).applyToTransactions(
        [...result.transactions, ...result.promotedTransactions].map(
          (transaction) => transaction.id
        )
      )
    } catch {
      // Classification enrichment must not invalidate a committed financial import.
    }

    return result
  }

  private filterDuplicateTransactions(preparedImport: PreparedImport): DeduplicatedPreparedImport {
    const existingTransactions = this.transactions.listCommittedForAccount(preparedImport.accountId)
    const existingBuckets = new Map<string, Transaction[]>()

    for (const transaction of existingTransactions) {
      const fingerprint = createTransactionFingerprint(transaction)
      existingBuckets.set(fingerprint, [...(existingBuckets.get(fingerprint) ?? []), transaction])
    }
    for (const bucket of existingBuckets.values()) {
      bucket.sort((left, right) => Number(right.isPending) - Number(left.isPending))
    }

    const incomingCounts = new Map<string, number>()
    const pendingPromotions: PendingPromotion[] = []
    const transactions = preparedImport.transactions.filter((transaction) => {
      const fingerprint = createTransactionFingerprint(transaction)
      const seen = (incomingCounts.get(fingerprint) ?? 0) + 1
      incomingCounts.set(fingerprint, seen)
      const existingBucket = existingBuckets.get(fingerprint) ?? []
      const representedTransaction = existingBucket[seen - 1]

      if (!representedTransaction) {
        return true
      }

      if (!transaction.isPending && representedTransaction.isPending) {
        pendingPromotions.push({
          existingTransactionId: representedTransaction.id,
          incomingTransaction: transaction
        })
      }

      return false
    })

    const filteredPreparedImport = preparedImportSchema.parse({
      ...preparedImport,
      transactions
    })

    return {
      preparedImport: filteredPreparedImport,
      originalTransactionCount: preparedImport.transactions.length,
      newTransactionCount: transactions.length,
      duplicateTransactionCount: preparedImport.transactions.length - transactions.length,
      pendingPromotions
    }
  }

  markPendingBatchFailed(id: string): ImportBatch {
    return this.importBatches.markFailed(id)
  }

  rollbackCommittedBatch(id: string): ImportBatch {
    const rollback = this.database.transaction(() => {
      const batch = this.importBatches.findById(id)

      if (batch.status !== 'committed') {
        throw new InvalidImportStatusTransitionError(batch.status, 'rolled_back')
      }

      if (this.links.importBatchParticipatesInCardSettlementLinks(id)) {
        throw new ActiveReconciliationError()
      }

      this.transactions.deleteForImportBatch(id)
      return this.importBatches.markRolledBack(id)
    })

    return rollback()
  }
}
