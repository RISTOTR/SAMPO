import type { Database } from 'better-sqlite3'
import {
  AccountMismatchError,
  DuplicateImportError,
  InvalidImportStatusTransitionError
} from '../domain/errors'
import {
  preparedImportSchema,
  type ImportBatch,
  type PreparedImport,
  type Transaction
} from '../domain/schemas'
import { AccountRepository } from '../storage/accounts'
import { ImportBatchRepository } from '../storage/import-batches'
import { TransactionRepository } from '../storage/transactions'

export type CommitPreparedImportResult = {
  batch: ImportBatch
  transactions: Transaction[]
}

export class ImportService {
  private readonly accounts: AccountRepository
  private readonly importBatches: ImportBatchRepository
  private readonly transactions: TransactionRepository

  constructor(private readonly database: Database) {
    this.accounts = new AccountRepository(database)
    this.importBatches = new ImportBatchRepository(database)
    this.transactions = new TransactionRepository(database)
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
      const batch = this.importBatches.createPending({
        accountId: preparedImport.accountId,
        sourceKind: preparedImport.sourceKind,
        sourceFileName: preparedImport.sourceFileName,
        fileSha256: preparedImport.fileSha256,
        statementPeriodStart: preparedImport.statementPeriodStart,
        statementPeriodEnd: preparedImport.statementPeriodEnd
      })

      const transactions = preparedImport.transactions.map((transaction) => {
        if (transaction.accountId !== preparedImport.accountId) {
          throw new AccountMismatchError()
        }

        return this.transactions.insertForImportBatch({
          importBatchId: batch.id,
          batchAccountId: batch.accountId,
          transaction
        })
      })

      const committedBatch = this.importBatches.markCommitted(batch.id, transactions.length)

      return {
        batch: committedBatch,
        transactions
      }
    })

    return commit()
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

      this.transactions.deleteForImportBatch(id)
      return this.importBatches.markRolledBack(id)
    })

    return rollback()
  }
}
