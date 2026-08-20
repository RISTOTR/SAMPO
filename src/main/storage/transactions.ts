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
import { createTransactionFingerprint } from '../services/transaction-fingerprint'

type TransactionListQuery = {
  search?: string
  confirmationFilter?: 'all' | 'needs_confirmation' | 'confirmed'
  accountId?: string
  dateFrom?: string
  dateTo?: string
  transactionType?: TransactionType
  pending?: boolean
  excludedFromSpending?: boolean
  categoryId?: string
  merchantId?: string
  usageType?: string
  costBehaviour?: string
  necessity?: string
  classificationStatus?: string
  unclassifiedOnly?: boolean
  sortBy: 'transactionDate' | 'amount'
  sortDirection: 'asc' | 'desc'
}

export class TransactionRepository {
  constructor(private readonly database: Database) {}

  findById(id: string): Transaction {
    const row = this.database.prepare('SELECT * FROM transactions WHERE id = ?').get(id)

    if (!row) {
      throw new EntityNotFoundError('Transaction', id)
    }

    return transactionSchema.parse(mapTransaction(row as never))
  }

  listByIds(ids: string[]): Transaction[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(', ')
    return this.database
      .prepare(`SELECT * FROM transactions WHERE id IN (${placeholders})`)
      .all(...ids)
      .map((row) => transactionSchema.parse(mapTransaction(row as never)))
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

  listPage(
    query: TransactionListQuery & {
      limit: number
      offset: number
    }
  ): { items: Transaction[]; total: number } {
    const { whereSql, params, fromSql } = buildTransactionListSql(query)
    const orderColumn =
      query.sortBy === 'amount' ? 'transactions.amount_cents' : 'transactions.transaction_date'
    const direction = query.sortDirection === 'asc' ? 'ASC' : 'DESC'
    const total = this.database
      .prepare(`SELECT COUNT(*) AS count ${fromSql} ${whereSql}`)
      .get(params) as { count: number }

    const items = this.database
      .prepare(
        `
          SELECT transactions.* ${fromSql}
          ${whereSql}
          ORDER BY ${orderColumn} ${direction}, transactions.created_at DESC
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

  listFilteredIds(query: TransactionListQuery): string[] {
    const { whereSql, params, fromSql } = buildTransactionListSql(query)
    return this.database
      .prepare(`SELECT transactions.id AS id ${fromSql} ${whereSql}`)
      .all(params)
      .map((row) => (row as { id: string }).id)
  }

  listCommittedForClassification(): Transaction[] {
    return this.database
      .prepare(
        `
          SELECT transactions.*
          FROM transactions transactions
          JOIN import_batches batches ON batches.id = transactions.import_batch_id
          WHERE batches.status = 'committed'
          ORDER BY transactions.transaction_date ASC, transactions.created_at ASC
        `
      )
      .all()
      .map((row) => transactionSchema.parse(mapTransaction(row as never)))
  }

  countCommittedFingerprintsForAccount(accountId: string): Map<string, number> {
    const counts = new Map<string, number>()
    const transactions = this.listCommittedForAccount(accountId)

    for (const transaction of transactions) {
      const fingerprint = createTransactionFingerprint(transaction)
      counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1)
    }

    return counts
  }

  listCommittedForAccount(accountId: string): Transaction[] {
    return this.database
      .prepare(
        `
          SELECT transactions.*
          FROM transactions transactions
          JOIN import_batches batches ON batches.id = transactions.import_batch_id
          WHERE transactions.account_id = @accountId
            AND batches.status = 'committed'
          ORDER BY transactions.transaction_date ASC, transactions.created_at ASC
        `
      )
      .all({ accountId })
      .map((row) => transactionSchema.parse(mapTransaction(row as never)))
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

  promotePendingToCompleted(
    id: string,
    input: {
      transactionType: Transaction['transactionType']
      reviewStatus: Transaction['reviewStatus']
    }
  ): Transaction {
    const transaction = this.findById(id)

    if (!transaction.isPending) {
      return transaction
    }

    this.database
      .prepare(
        `
          UPDATE transactions
          SET transaction_type = @transactionType,
              is_pending = 0,
              review_status = @reviewStatus,
              updated_at = @updatedAt
          WHERE id = @id
        `
      )
      .run({
        id,
        transactionType: input.transactionType,
        reviewStatus: input.reviewStatus,
        updatedAt: new Date().toISOString()
      })

    return this.findById(id)
  }
}

function buildTransactionListSql(query: TransactionListQuery): {
  whereSql: string
  params: Record<string, string | number>
  fromSql: string
} {
  const where: string[] = []
  const params: Record<string, string | number> = {}

  if (query.search?.trim()) {
    where.push(
      `(lower(transactions.original_description) LIKE @search OR lower(merchant.name) LIKE @search)`
    )
    params['search'] = `%${query.search.trim().toLocaleLowerCase('es-ES')}%`
  }

  if (query.confirmationFilter === 'confirmed') {
    where.push(`
      classification.classification_status = 'confirmed'
      AND classification.merchant_id IS NOT NULL
      AND classification.category_id IS NOT NULL
    `)
  }

  if (query.confirmationFilter === 'needs_confirmation') {
    where.push(`
      (
        classification.transaction_id IS NULL
        OR classification.classification_status != 'confirmed'
        OR classification.merchant_id IS NULL
        OR classification.category_id IS NULL
      )
    `)
  }

  if (query.accountId) {
    where.push('transactions.account_id = @accountId')
    params['accountId'] = query.accountId
  }

  if (query.dateFrom) {
    where.push('transactions.transaction_date >= @dateFrom')
    params['dateFrom'] = query.dateFrom
  }

  if (query.dateTo) {
    where.push('transactions.transaction_date <= @dateTo')
    params['dateTo'] = query.dateTo
  }

  if (query.transactionType) {
    where.push('transactions.transaction_type = @transactionType')
    params['transactionType'] = query.transactionType
  }

  if (query.pending !== undefined) {
    where.push('transactions.is_pending = @isPending')
    params['isPending'] = query.pending ? 1 : 0
  }

  if (query.excludedFromSpending !== undefined) {
    where.push('transactions.excluded_from_spending = @excludedFromSpending')
    params['excludedFromSpending'] = query.excludedFromSpending ? 1 : 0
  }

  if (query.categoryId) {
    where.push('classification.category_id = @categoryId')
    params['categoryId'] = query.categoryId
  }

  if (query.merchantId) {
    where.push('classification.merchant_id = @merchantId')
    params['merchantId'] = query.merchantId
  }

  if (query.usageType) {
    where.push('classification.usage_type = @usageType')
    params['usageType'] = query.usageType
  }

  if (query.costBehaviour) {
    where.push('classification.cost_behaviour = @costBehaviour')
    params['costBehaviour'] = query.costBehaviour
  }

  if (query.necessity) {
    where.push('classification.necessity = @necessity')
    params['necessity'] = query.necessity
  }

  if (query.classificationStatus) {
    where.push('classification.classification_status = @classificationStatus')
    params['classificationStatus'] = query.classificationStatus
  }

  if (query.unclassifiedOnly) {
    where.push(
      "(classification.transaction_id IS NULL OR classification.classification_source = 'unclassified')"
    )
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
    fromSql: `
      FROM transactions transactions
      LEFT JOIN transaction_classifications classification
        ON classification.transaction_id = transactions.id
      LEFT JOIN merchants merchant
        ON merchant.id = classification.merchant_id
    `
  }
}
