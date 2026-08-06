import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { AccountMismatchError, EntityNotFoundError } from '../domain/errors'
import {
  newTransactionSchema,
  transactionSchema,
  type TransactionType,
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

  listEligibleVisaMovementsForImportBatch(importBatchId: string): Transaction[] {
    return this.database
      .prepare(
        `
          SELECT * FROM transactions
          WHERE import_batch_id = ?
            AND is_pending = 0
            AND transaction_type IN ('expense', 'refund')
          ORDER BY transaction_date ASC, source_row_index ASC
        `
      )
      .all(importBatchId)
      .map((row) => transactionSchema.parse(mapTransaction(row as never)))
  }

  countPendingForImportBatch(importBatchId: string): number {
    const row = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM transactions
          WHERE import_batch_id = ? AND is_pending = 1
        `
      )
      .get(importBatchId) as { count: number }

    return row.count
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

  countAll(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM transactions').get() as {
      count: number
    }

    return row.count
  }

  countUnreconciledCardSettlements(): number {
    const row = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM transactions transactions
          JOIN import_batches batches ON batches.id = transactions.import_batch_id
          WHERE transactions.transaction_type = 'card_settlement'
            AND batches.status = 'committed'
            AND NOT EXISTS (
              SELECT 1 FROM transaction_links links
              WHERE links.from_transaction_id = transactions.id
                AND links.kind = 'card_settlement'
            )
        `
      )
      .get() as { count: number }

    return row.count
  }

  listUnreconciledCardSettlements(): Transaction[] {
    return this.database
      .prepare(
        `
          SELECT transactions.*
          FROM transactions transactions
          JOIN import_batches batches ON batches.id = transactions.import_batch_id
          WHERE transactions.transaction_type = 'card_settlement'
            AND batches.status = 'committed'
            AND NOT EXISTS (
              SELECT 1 FROM transaction_links links
              WHERE links.from_transaction_id = transactions.id
                AND links.kind = 'card_settlement'
            )
          ORDER BY transactions.transaction_date DESC, transactions.created_at DESC
        `
      )
      .all()
      .map((row) => transactionSchema.parse(mapTransaction(row as never)))
  }

  listCardSettlements(): Transaction[] {
    return this.database
      .prepare(
        `
          SELECT transactions.*
          FROM transactions transactions
          JOIN import_batches batches ON batches.id = transactions.import_batch_id
          WHERE transactions.transaction_type = 'card_settlement'
            AND batches.status = 'committed'
          ORDER BY transactions.transaction_date DESC, transactions.created_at DESC
        `
      )
      .all()
      .map((row) => transactionSchema.parse(mapTransaction(row as never)))
  }

  listPage(query: {
    accountId?: string
    dateFrom?: string
    dateTo?: string
    transactionType?: TransactionType
    pending?: boolean
    excludedFromSpending?: boolean
    sortBy: 'transactionDate' | 'amount'
    sortDirection: 'asc' | 'desc'
    limit: number
    offset: number
  }): { items: Transaction[]; total: number } {
    const where: string[] = []
    const params: Record<string, string | number> = {}

    if (query.accountId) {
      where.push('account_id = @accountId')
      params['accountId'] = query.accountId
    }

    if (query.dateFrom) {
      where.push('transaction_date >= @dateFrom')
      params['dateFrom'] = query.dateFrom
    }

    if (query.dateTo) {
      where.push('transaction_date <= @dateTo')
      params['dateTo'] = query.dateTo
    }

    if (query.transactionType) {
      where.push('transaction_type = @transactionType')
      params['transactionType'] = query.transactionType
    }

    if (query.pending !== undefined) {
      where.push('is_pending = @isPending')
      params['isPending'] = query.pending ? 1 : 0
    }

    if (query.excludedFromSpending !== undefined) {
      where.push('excluded_from_spending = @excludedFromSpending')
      params['excludedFromSpending'] = query.excludedFromSpending ? 1 : 0
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const orderColumn = query.sortBy === 'amount' ? 'amount_cents' : 'transaction_date'
    const direction = query.sortDirection === 'asc' ? 'ASC' : 'DESC'
    const total = this.database
      .prepare(`SELECT COUNT(*) AS count FROM transactions ${whereSql}`)
      .get(params) as { count: number }

    const items = this.database
      .prepare(
        `
          SELECT * FROM transactions
          ${whereSql}
          ORDER BY ${orderColumn} ${direction}, created_at DESC
          LIMIT @limit OFFSET @offset
        `
      )
      .all({ ...params, limit: query.limit, offset: query.offset })
      .map((row) => transactionSchema.parse(mapTransaction(row as never)))

    return {
      items,
      total: total.count
    }
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

  updateReconciliationFlags(
    id: string,
    input: {
      excludedFromSpending: boolean
      reviewStatus: Transaction['reviewStatus']
    }
  ): Transaction {
    this.findById(id)

    this.database
      .prepare(
        `
          UPDATE transactions
          SET excluded_from_spending = @excludedFromSpending,
              review_status = @reviewStatus,
              updated_at = @updatedAt
          WHERE id = @id
        `
      )
      .run({
        id,
        excludedFromSpending: input.excludedFromSpending ? 1 : 0,
        reviewStatus: input.reviewStatus,
        updatedAt: new Date().toISOString()
      })

    return this.findById(id)
  }
}
