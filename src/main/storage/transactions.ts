import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { AccountMismatchError, EntityNotFoundError } from '../domain/errors'
import {
  newTransactionSchema,
  transactionSchema,
  type NormalizedNewTransaction,
  type Transaction
} from '../domain/schemas'
import { mapTransaction } from './row-mappers'

export class TransactionRepository {
  constructor(private readonly database: Database) {}

  findById(id: string): Transaction {
    const row = this.database.prepare('SELECT * FROM transactions WHERE id = ?').get(id)

    if (!row) {
      throw new EntityNotFoundError('Transaction', id)
    }

    return transactionSchema.parse(mapTransaction(row as never))
  }

  listForImportBatch(importBatchId: string): Transaction[] {
    return this.database
      .prepare('SELECT * FROM transactions WHERE import_batch_id = ? ORDER BY source_row_index ASC')
      .all(importBatchId)
      .map((row) => transactionSchema.parse(mapTransaction(row as never)))
  }

  listForAccount(accountId: string): Transaction[] {
    return this.database
      .prepare('SELECT * FROM transactions WHERE account_id = ? ORDER BY transaction_date ASC')
      .all(accountId)
      .map((row) => transactionSchema.parse(mapTransaction(row as never)))
  }

  countForImportBatch(importBatchId: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM transactions WHERE import_batch_id = ?')
      .get(importBatchId) as { count: number }

    return row.count
  }

  insertForImportBatch(input: {
    importBatchId: string
    batchAccountId: string
    transaction: unknown
  }): Transaction {
    const transaction = newTransactionSchema.parse(input.transaction) as NormalizedNewTransaction

    if (transaction.accountId !== input.batchAccountId) {
      throw new AccountMismatchError()
    }

    const id = randomUUID()
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
          INSERT INTO transactions (
            id,
            import_batch_id,
            account_id,
            source_row_index,
            transaction_date,
            value_date,
            reference,
            original_description,
            normalized_merchant,
            amount_cents,
            balance_cents,
            currency,
            transaction_type,
            is_pending,
            excluded_from_spending,
            review_status,
            created_at,
            updated_at
          )
          VALUES (
            @id,
            @importBatchId,
            @accountId,
            @sourceRowIndex,
            @transactionDate,
            @valueDate,
            @reference,
            @originalDescription,
            @normalizedMerchant,
            @amountCents,
            @balanceCents,
            @currency,
            @transactionType,
            @isPending,
            @excludedFromSpending,
            @reviewStatus,
            @createdAt,
            @updatedAt
          )
        `
      )
      .run({
        id,
        importBatchId: input.importBatchId,
        accountId: transaction.accountId,
        sourceRowIndex: transaction.sourceRowIndex,
        transactionDate: transaction.transactionDate,
        valueDate: transaction.valueDate ?? null,
        reference: transaction.reference ?? null,
        originalDescription: transaction.originalDescription,
        normalizedMerchant: transaction.normalizedMerchant ?? null,
        amountCents: transaction.amountCents,
        balanceCents: transaction.balanceCents ?? null,
        currency: transaction.currency,
        transactionType: transaction.transactionType,
        isPending: transaction.isPending ? 1 : 0,
        excludedFromSpending: transaction.excludedFromSpending ? 1 : 0,
        reviewStatus: transaction.reviewStatus,
        createdAt: now,
        updatedAt: now
      })

    return this.findById(id)
  }

  deleteForImportBatch(importBatchId: string): void {
    this.database.prepare('DELETE FROM transactions WHERE import_batch_id = ?').run(importBatchId)
  }
}
