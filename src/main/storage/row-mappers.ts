import type { Account, ImportBatch, Transaction, TransactionLink } from '../domain/schemas'

type AccountRow = {
  id: string
  name: string
  kind: Account['kind']
  institution: string | null
  currency: string
  created_at: string
  updated_at: string
}

type ImportBatchRow = {
  id: string
  account_id: string
  source_kind: ImportBatch['sourceKind']
  source_file_name: string
  file_sha256: string
  statement_period_start: string | null
  statement_period_end: string | null
  status: ImportBatch['status']
  transaction_count: number
  created_at: string
  committed_at: string | null
  rolled_back_at: string | null
}

type TransactionRow = {
  id: string
  import_batch_id: string
  account_id: string
  source_row_index: number
  transaction_date: string
  value_date: string | null
  reference: string | null
  original_description: string
  normalized_merchant: string | null
  amount_cents: number
  balance_cents: number | null
  currency: string
  transaction_type: Transaction['transactionType']
  is_pending: number
  excluded_from_spending: number
  review_status: Transaction['reviewStatus']
  created_at: string
  updated_at: string
}

type TransactionLinkRow = {
  id: string
  from_transaction_id: string
  to_transaction_id: string
  kind: TransactionLink['kind']
  created_at: string
}

export function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    institution: row.institution ?? undefined,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function mapImportBatch(row: ImportBatchRow): ImportBatch {
  return {
    id: row.id,
    accountId: row.account_id,
    sourceKind: row.source_kind,
    sourceFileName: row.source_file_name,
    fileSha256: row.file_sha256,
    statementPeriodStart: row.statement_period_start ?? undefined,
    statementPeriodEnd: row.statement_period_end ?? undefined,
    status: row.status,
    transactionCount: row.transaction_count,
    createdAt: row.created_at,
    committedAt: row.committed_at ?? undefined,
    rolledBackAt: row.rolled_back_at ?? undefined
  }
}

export function mapTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    importBatchId: row.import_batch_id,
    accountId: row.account_id,
    sourceRowIndex: row.source_row_index,
    transactionDate: row.transaction_date,
    valueDate: row.value_date ?? undefined,
    reference: row.reference ?? undefined,
    originalDescription: row.original_description,
    normalizedMerchant: row.normalized_merchant ?? undefined,
    amountCents: row.amount_cents,
    balanceCents: row.balance_cents ?? undefined,
    currency: row.currency,
    transactionType: row.transaction_type,
    isPending: row.is_pending === 1,
    excludedFromSpending: row.excluded_from_spending === 1,
    reviewStatus: row.review_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function mapTransactionLink(row: TransactionLinkRow): TransactionLink {
  return {
    id: row.id,
    fromTransactionId: row.from_transaction_id,
    toTransactionId: row.to_transaction_id,
    kind: row.kind,
    createdAt: row.created_at
  }
}
