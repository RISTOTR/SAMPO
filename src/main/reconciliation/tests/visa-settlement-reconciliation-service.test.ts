import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ActiveReconciliationError,
  DuplicateImportError,
  ReconciliationError
} from '../../domain/errors'
import type { NewTransaction, PreparedImport, Transaction } from '../../domain/schemas'
import { ImportService } from '../../services/import-service'
import { AccountRepository } from '../../storage/accounts'
import { createDatabase, type SampoDatabase } from '../../storage/database'
import { ImportBatchRepository } from '../../storage/import-batches'
import { TransactionLinkRepository } from '../../storage/transaction-links'
import { TransactionRepository } from '../../storage/transactions'
import { VisaSettlementReconciliationService } from '../visa-settlement-reconciliation-service'

const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)
const hashC = 'c'.repeat(64)
const hashD = 'd'.repeat(64)

describe('VisaSettlementReconciliationService', () => {
  let directory: string
  let database: SampoDatabase
  let accounts: AccountRepository
  let imports: ImportService
  let batches: ImportBatchRepository
  let links: TransactionLinkRepository
  let transactions: TransactionRepository
  let reconciliation: VisaSettlementReconciliationService

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-reconciliation-'))
    database = createDatabase({ path: join(directory, 'reconciliation.sqlite3'), useWal: false })
    accounts = new AccountRepository(database.connection)
    imports = new ImportService(database.connection)
    batches = new ImportBatchRepository(database.connection)
    links = new TransactionLinkRepository(database.connection)
    transactions = new TransactionRepository(database.connection)
    reconciliation = new VisaSettlementReconciliationService(database.connection)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('discovers exact candidates read-only and ranks exact matches first', () => {
    const { settlement } = setupSettlementAndVisa({
      visaAmounts: [-12000, 1500],
      settlementAmount: -10500
    })
    setupVisaBatch({ amounts: [-9000], hash: hashC })
    const beforeLinkCount = links.listForTransaction(settlement.id).length

    const candidates = reconciliation.findVisaSettlementCandidates(settlement.id)

    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({
      settlementTransactionId: settlement.id,
      completedTransactionCount: 2,
      pendingTransactionCount: 0,
      settlementAmountCents: -10500,
      visaNetAmountCents: -10500,
      differenceCents: 0,
      exactAmountMatch: true,
      dateOrderValid: true
    })
    expect(candidates[1]?.exactAmountMatch).toBe(false)
    expect(links.listForTransaction(settlement.id)).toHaveLength(beforeLinkCount)
  })

  it('ranks valid date order ahead of invalid date order and reports ambiguity', () => {
    const { settlement } = setupSettlementAndVisa({
      settlementDate: '2026-02-10',
      visaAmounts: [-5000],
      visaDates: ['2026-02-09'],
      settlementAmount: -5000,
      visaHash: hashA
    })
    setupVisaBatch({ amounts: [-5000], dates: ['2026-02-12'], hash: hashB })

    const candidates = reconciliation.findVisaSettlementCandidates(settlement.id)

    expect(candidates).toHaveLength(2)
    expect(candidates[0]?.dateOrderValid).toBe(true)
    expect(candidates[1]?.dateOrderValid).toBe(false)
    expect(candidates.every((candidate) => candidate.exactAmountMatch)).toBe(true)
    expect(
      candidates.every((candidate) =>
        candidate.warnings.some((warning) => warning.code === 'ambiguous_candidate')
      )
    ).toBe(true)
  })

  it('ignores rolled-back, failed, empty, and already reconciled Visa batches in discovery', () => {
    const { settlement, visaBatch } = setupSettlementAndVisa({
      visaAmounts: [-1000],
      settlementAmount: -1000,
      visaHash: hashA
    })
    const rolledBack = setupVisaBatch({ amounts: [-1000], hash: hashB })
    imports.rollbackCommittedBatch(rolledBack.batch.id)
    const failed = batches.createPending({
      accountId: rolledBack.account.id,
      sourceKind: 'evo_visa_xls',
      sourceFileName: 'failed.xls',
      fileSha256: hashC
    })
    batches.markFailed(failed.id)
    const empty = setupVisaBatch({ amounts: [], pendingAmounts: [-1000], hash: hashD })

    reconciliation.commitVisaSettlementReconciliation(settlement.id, visaBatch.id)
    const secondSettlement = setupSettlement({ amount: -1000 }).settlement

    const candidates = reconciliation.findVisaSettlementCandidates(secondSettlement.id)

    expect(candidates.map((candidate) => candidate.visaImportBatchId)).not.toContain(
      rolledBack.batch.id
    )
    expect(candidates.map((candidate) => candidate.visaImportBatchId)).not.toContain(failed.id)
    expect(candidates.map((candidate) => candidate.visaImportBatchId)).not.toContain(empty.batch.id)
    expect(candidates.map((candidate) => candidate.visaImportBatchId)).not.toContain(visaBatch.id)
  })

  it('previews exact totals, refunds, ignored pending movements, and mismatch blockers', () => {
    const { settlement, visaBatch } = setupSettlementAndVisa({
      visaAmounts: [-12000, 1500],
      pendingAmounts: [-9999],
      settlementAmount: -10500
    })

    const preview = reconciliation.previewVisaSettlementReconciliation(settlement.id, visaBatch.id)

    expect(preview).toMatchObject({
      completedVisaTransactionCount: 2,
      ignoredPendingTransactionCount: 1,
      visaNetAmountCents: -10500,
      differenceCents: 0,
      canCommit: true
    })

    const mismatch = setupSettlement({ amount: -10000 }).settlement
    const mismatchPreview = reconciliation.previewVisaSettlementReconciliation(
      mismatch.id,
      visaBatch.id
    )

    expect(mismatchPreview.canCommit).toBe(false)
    expect(mismatchPreview.warnings.map((warning) => warning.code)).toContain('amount_mismatch')
  })

  it('blocks preview for date, currency, account-kind, source-kind, empty, and linked-state errors', () => {
    const invalidDate = setupSettlementAndVisa({
      settlementDate: '2026-02-01',
      visaDates: ['2026-02-02'],
      visaAmounts: [-1000],
      settlementAmount: -1000
    })
    expect(
      reconciliation
        .previewVisaSettlementReconciliation(invalidDate.settlement.id, invalidDate.visaBatch.id)
        .warnings.map((warning) => warning.code)
    ).toContain('settlement_before_visa_movements')

    const currency = setupSettlementAndVisa({
      settlementAmount: -1000,
      visaAmounts: [-1000],
      visaCurrency: 'USD',
      visaHash: hashB
    })
    expect(
      reconciliation.previewVisaSettlementReconciliation(
        currency.settlement.id,
        currency.visaBatch.id
      ).warnings
    ).toContainEqual(expect.objectContaining({ code: 'currency_mismatch' }))

    const wrongKind = setupVisaBatch({ amounts: [-1000], accountKind: 'current', hash: hashC })
    expect(
      reconciliation.previewVisaSettlementReconciliation(currency.settlement.id, wrongKind.batch.id)
        .warnings
    ).toContainEqual(expect.objectContaining({ code: 'visa_account_wrong_kind' }))

    const wrongSourceBatch = imports.commitPreparedImport({
      accountId: wrongKind.account.id,
      sourceKind: 'unknown',
      sourceFileName: 'unknown.txt',
      fileSha256: hashD,
      transactions: [visaTransaction(wrongKind.account.id, -1000)]
    }).batch
    expect(
      reconciliation.previewVisaSettlementReconciliation(
        currency.settlement.id,
        wrongSourceBatch.id
      ).warnings
    ).toContainEqual(expect.objectContaining({ code: 'visa_batch_wrong_source' }))

    const empty = setupVisaBatch({ amounts: [], pendingAmounts: [-1000], hash: 'e'.repeat(64) })
    expect(
      reconciliation.previewVisaSettlementReconciliation(currency.settlement.id, empty.batch.id)
        .warnings
    ).toContainEqual(expect.objectContaining({ code: 'no_completed_visa_transactions' }))

    const linked = setupSettlementAndVisa({
      settlementAmount: -1000,
      visaAmounts: [-1000],
      visaHash: 'f'.repeat(64)
    })
    reconciliation.commitVisaSettlementReconciliation(linked.settlement.id, linked.visaBatch.id)
    expect(
      reconciliation.previewVisaSettlementReconciliation(linked.settlement.id, linked.visaBatch.id)
        .warnings
    ).toContainEqual(expect.objectContaining({ code: 'settlement_already_reconciled' }))
  })

  it('commits links atomically, updates only the settlement, and rejects duplicate reconciliation', () => {
    const { settlement, visaBatch } = setupSettlementAndVisa({
      visaAmounts: [-12000, 1500],
      pendingAmounts: [-500],
      settlementAmount: -10500
    })
    const visaBefore = transactions.listForImportBatch(visaBatch.id)

    const committed = reconciliation.commitVisaSettlementReconciliation(settlement.id, visaBatch.id)

    expect(committed.linkedTransactionCount).toBe(2)
    expect(links.listCardSettlementLinksFromSettlement(settlement.id)).toHaveLength(2)
    expect(transactions.findById(settlement.id)).toMatchObject({
      excludedFromSpending: true,
      reviewStatus: 'confirmed'
    })
    expect(transactions.listForImportBatch(visaBatch.id)).toMatchObject(visaBefore)
    expect(() =>
      reconciliation.commitVisaSettlementReconciliation(settlement.id, visaBatch.id)
    ).toThrow(ReconciliationError)

    const otherSettlement = setupSettlement({ amount: -10500, hash: hashC }).settlement
    expect(() =>
      reconciliation.commitVisaSettlementReconciliation(otherSettlement.id, visaBatch.id)
    ).toThrow(ReconciliationError)
    expect(links.listCardSettlementLinksFromSettlement(otherSettlement.id)).toHaveLength(0)
    expect(transactions.findById(otherSettlement.id).excludedFromSpending).toBe(false)
  })

  it('reverses only card-settlement links and permits reconciliation again', () => {
    const { settlement, visaBatch } = setupSettlementAndVisa({
      visaAmounts: [-1000],
      settlementAmount: -1000
    })
    const other = transactions.listForImportBatch(visaBatch.id)[0] as Transaction
    links.create({
      fromTransactionId: settlement.id,
      toTransactionId: other.id,
      kind: 'related'
    })
    reconciliation.commitVisaSettlementReconciliation(settlement.id, visaBatch.id)

    const reversed = reconciliation.reverseVisaSettlementReconciliation(settlement.id)

    expect(reversed.removedLinkCount).toBe(1)
    expect(links.listForTransaction(settlement.id).map((link) => link.kind)).toEqual(['related'])
    expect(transactions.findById(settlement.id)).toMatchObject({
      excludedFromSpending: false,
      reviewStatus: 'needs_review'
    })
    expect(() => reconciliation.reverseVisaSettlementReconciliation(settlement.id)).toThrow(
      ReconciliationError
    )

    const recommitted = reconciliation.commitVisaSettlementReconciliation(
      settlement.id,
      visaBatch.id
    )
    expect(recommitted.linkedTransactionCount).toBe(1)
  })

  it('blocks rollback while reconciliation is active and allows rollback after reversal', () => {
    const { settlement, settlementBatch, visaBatch } = setupSettlementAndVisa({
      visaAmounts: [-1000],
      settlementAmount: -1000
    })
    reconciliation.commitVisaSettlementReconciliation(settlement.id, visaBatch.id)

    expect(() => imports.rollbackCommittedBatch(settlementBatch.id)).toThrow(
      ActiveReconciliationError
    )
    expect(() => imports.rollbackCommittedBatch(visaBatch.id)).toThrow(ActiveReconciliationError)
    expect(batches.findById(settlementBatch.id).status).toBe('committed')
    expect(batches.findById(visaBatch.id).status).toBe('committed')

    reconciliation.reverseVisaSettlementReconciliation(settlement.id)

    expect(imports.rollbackCommittedBatch(visaBatch.id).status).toBe('rolled_back')
    expect(imports.rollbackCommittedBatch(settlementBatch.id).status).toBe('rolled_back')
  })

  it('preserves existing duplicate-file detection for unreconciled imports', () => {
    const account = accounts.create({ name: 'Synthetic card', kind: 'credit_card' })
    const prepared = preparedVisaImport(account.id, [-1000], [], hashA)

    imports.commitPreparedImport(prepared)

    expect(() => imports.commitPreparedImport(prepared)).toThrow(DuplicateImportError)
  })

  function setupSettlementAndVisa(options: {
    settlementAmount: number
    visaAmounts: number[]
    pendingAmounts?: number[]
    settlementDate?: string
    visaDates?: string[]
    visaCurrency?: string
    visaHash?: string
  }): {
    settlement: Transaction
    settlementBatch: ReturnType<ImportBatchRepository['findById']>
    visaBatch: ReturnType<ImportBatchRepository['findById']>
  } {
    const settlementResult = setupSettlement({
      amount: options.settlementAmount,
      transactionDate: options.settlementDate,
      hash: hashA
    })
    const visaResult = setupVisaBatch({
      amounts: options.visaAmounts,
      pendingAmounts: options.pendingAmounts,
      dates: options.visaDates,
      currency: options.visaCurrency,
      hash: options.visaHash ?? hashB
    })

    return {
      settlement: settlementResult.settlement,
      settlementBatch: settlementResult.batch,
      visaBatch: visaResult.batch
    }
  }

  function setupSettlement(options: { amount: number; transactionDate?: string; hash?: string }): {
    settlement: Transaction
    batch: ReturnType<ImportBatchRepository['findById']>
  } {
    const account = accounts.create({ name: 'Synthetic current', kind: 'current' })
    const result = imports.commitPreparedImport({
      accountId: account.id,
      sourceKind: 'evo_account_pdf',
      sourceFileName: 'synthetic-account.pdf',
      fileSha256: options.hash ?? hashA,
      transactions: [
        {
          accountId: account.id,
          sourceRowIndex: 0,
          transactionDate: options.transactionDate ?? '2026-02-10',
          valueDate: options.transactionDate ?? '2026-02-10',
          originalDescription: 'TEST CARD SETTLEMENT',
          amountCents: options.amount,
          balanceCents: -50000,
          currency: 'EUR',
          transactionType: 'card_settlement',
          isPending: false,
          excludedFromSpending: false,
          reviewStatus: 'needs_review'
        }
      ]
    })

    return {
      settlement: result.transactions[0] as Transaction,
      batch: result.batch
    }
  }

  function setupVisaBatch(options: {
    amounts: number[]
    pendingAmounts?: number[]
    dates?: string[]
    currency?: string
    accountKind?: 'current' | 'credit_card'
    hash: string
  }): {
    account: ReturnType<AccountRepository['create']>
    batch: ReturnType<ImportBatchRepository['findById']>
  } {
    const account = accounts.create({
      name: 'Synthetic Visa',
      kind: options.accountKind ?? 'credit_card',
      currency: options.currency ?? 'EUR'
    })
    const result = imports.commitPreparedImport(
      preparedVisaImport(
        account.id,
        options.amounts,
        options.pendingAmounts ?? [],
        options.hash,
        options.dates,
        options.currency
      )
    )

    return {
      account,
      batch: result.batch
    }
  }
})

function preparedVisaImport(
  accountId: string,
  amounts: number[],
  pendingAmounts: number[],
  fileSha256: string,
  dates: string[] = [],
  currency = 'EUR'
): PreparedImport {
  return {
    accountId,
    sourceKind: 'evo_visa_xls',
    sourceFileName: 'synthetic-visa.xls',
    fileSha256,
    transactions: [
      ...amounts.map((amount, index) =>
        visaTransaction(accountId, amount, {
          sourceRowIndex: index,
          transactionDate: dates[index] ?? `2026-02-${String(index + 1).padStart(2, '0')}`,
          currency
        })
      ),
      ...pendingAmounts.map((amount, index) =>
        visaTransaction(accountId, amount, {
          sourceRowIndex: amounts.length + index,
          transactionDate: `2026-02-${String(index + 10).padStart(2, '0')}`,
          isPending: true,
          currency
        })
      )
    ]
  }
}

function visaTransaction(
  accountId: string,
  amountCents: number,
  overrides: Partial<NewTransaction> = {}
): NewTransaction {
  return {
    accountId,
    sourceRowIndex: 0,
    transactionDate: '2026-02-01',
    originalDescription: amountCents > 0 ? 'TEST REFUND' : 'NORTH MARKET',
    amountCents,
    currency: 'EUR',
    transactionType: amountCents > 0 ? 'refund' : 'expense',
    isPending: false,
    excludedFromSpending: false,
    reviewStatus: 'confirmed',
    ...overrides
  }
}
