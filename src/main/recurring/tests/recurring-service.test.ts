import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createDatabase, type SampoDatabase } from '../../storage/database'
import { AccountRepository } from '../../storage/accounts'
import { ImportService } from '../../services/import-service'
import {
  MerchantRepository,
  TransactionClassificationRepository
} from '../../storage/categorisation'
import { RecurringDetectionService } from '../recurring-service'
import type { NewTransaction, PreparedImport } from '../../domain/schemas'

describe('recurring detection service', () => {
  let directory: string
  let database: SampoDatabase
  let connection: Database
  let accountId: string
  let imports: ImportService
  let merchants: MerchantRepository
  let classifications: TransactionClassificationRepository
  let recurring: RecurringDetectionService

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-recurring-'))
    database = createDatabase({ path: join(directory, 'recurring.sqlite3'), useWal: false })
    connection = database.connection
    accountId = new AccountRepository(connection).create({
      name: 'Synthetic recurring account',
      kind: 'current'
    }).id
    imports = new ImportService(connection)
    merchants = new MerchantRepository(connection)
    classifications = new TransactionClassificationRepository(connection)
    recurring = new RecurringDetectionService(connection)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('detects fixed monthly subscriptions and links their occurrences', () => {
    const merchantId = seedMerchantSeries('Synthetic Streamer', [
      ['2026-01-10', -2299],
      ['2026-02-09', -2299],
      ['2026-03-11', -2299]
    ])

    const summary = recurring.scan()
    const series = recurring.list().find((item) => item.merchantId === merchantId)

    expect(summary.candidateCount).toBe(1)
    expect(series).toMatchObject({
      cadence: 'monthly',
      confidence: 'high',
      occurrenceCount: 3,
      typicalAmountCents: 2299,
      minAmountCents: 2299,
      maxAmountCents: 2299
    })
    expect(recurring.get(series!.id).occurrences).toHaveLength(3)
  })

  it('detects variable monthly utility bills without requiring identical amounts', () => {
    const merchantId = seedMerchantSeries('Synthetic Utility', [
      ['2026-01-05', -6420],
      ['2026-02-04', -7385],
      ['2026-03-06', -5891],
      ['2026-04-05', -8140]
    ])

    recurring.scan()
    const series = recurring.list().find((item) => item.merchantId === merchantId)

    expect(series).toMatchObject({
      cadence: 'monthly',
      occurrenceCount: 4,
      typicalAmountCents: 6903,
      minAmountCents: 5891,
      maxAmountCents: 8140
    })
    expect(series!.amountVariabilityBasisPoints).toBeGreaterThan(3000)
  })

  it('detects quarterly and yearly recurring payments when history supports them', () => {
    const quarterly = seedMerchantSeries('Synthetic Quarterly', [
      ['2026-01-15', -12000],
      ['2026-04-15', -12000],
      ['2026-07-14', -12000]
    ])
    const yearly = seedMerchantSeries('Synthetic Yearly', [
      ['2024-06-01', -9900],
      ['2025-06-01', -9900],
      ['2026-06-02', -9900]
    ])

    recurring.scan()

    expect(recurring.list().find((item) => item.merchantId === quarterly)).toMatchObject({
      cadence: 'quarterly'
    })
    expect(recurring.list().find((item) => item.merchantId === yearly)).toMatchObject({
      cadence: 'yearly'
    })
  })

  it('does not detect single occurrences and keeps two occurrences weak', () => {
    seedMerchantSeries('Synthetic Single', [['2026-01-01', -1000]])
    const weak = seedMerchantSeries('Synthetic Weak', [
      ['2026-01-01', -1000],
      ['2026-01-31', -1000]
    ])

    recurring.scan()

    expect(recurring.list().some((item) => item.canonicalDescription === 'Synthetic Single')).toBe(
      false
    )
    expect(recurring.list().find((item) => item.merchantId === weak)).toMatchObject({
      confidence: 'low',
      occurrenceCount: 2
    })
  })

  it('does not treat irregular supermarket purchases as high-confidence recurring', () => {
    const merchantId = seedMerchantSeries('Synthetic Supermarket', [
      ['2026-01-02', -2400],
      ['2026-01-09', -4200],
      ['2026-01-28', -1700],
      ['2026-03-13', -6300]
    ])

    recurring.scan()
    const series = recurring.list().find((item) => item.merchantId === merchantId)

    expect(series).toBeUndefined()
  })

  it('ignores duplicate imported occurrences, refunds, and incoming transactions', () => {
    const merchantId = seedMerchantSeries('Synthetic Protected', [
      ['2026-01-10', -1000],
      ['2026-01-10', -1000],
      ['2026-02-09', -1000],
      ['2026-03-11', -1000]
    ])
    commit('protected-non-expenses', [
      makeTransaction('2026-04-10', 'Synthetic Protected', 1000, 'refund'),
      makeTransaction('2026-05-10', 'Synthetic Protected', 1000, 'income')
    ])

    recurring.scan()
    const series = recurring.list().find((item) => item.merchantId === merchantId)

    expect(series).toMatchObject({ occurrenceCount: 3 })
    expect(recurring.get(series!.id).occurrences).toHaveLength(3)
  })

  it('persists confirmation and rejection, remains idempotent, and extends later evidence', () => {
    const merchantId = seedMerchantSeries('Synthetic Extendable', [
      ['2026-01-10', -1500],
      ['2026-02-09', -1500],
      ['2026-03-11', -1500]
    ])

    recurring.scan()
    const initial = recurring.list().find((item) => item.merchantId === merchantId)!
    recurring.confirm(initial.id, 'subscription')
    recurring.scan()

    expect(recurring.list().filter((item) => item.merchantId === merchantId)).toHaveLength(1)
    expect(recurring.list().find((item) => item.merchantId === merchantId)).toMatchObject({
      status: 'confirmed',
      recurrenceType: 'subscription',
      occurrenceCount: 3
    })

    seedMerchantSeries('Synthetic Extendable', [['2026-04-10', -1500]], merchantId, 'extend')
    recurring.scan()

    expect(recurring.list().filter((item) => item.merchantId === merchantId)).toHaveLength(1)
    expect(recurring.list().find((item) => item.merchantId === merchantId)).toMatchObject({
      status: 'confirmed',
      occurrenceCount: 4
    })
  })

  it('manually creates a confirmed recurring series from a merchant transaction', () => {
    const seeded = seedMerchantTransactions('Synthetic Manual Rent', [
      ['2026-01-01', -90000],
      ['2026-02-01', -90000],
      ['2026-03-01', -90000]
    ])
    seedMerchantTransactions('Synthetic Different Payee', [['2026-01-01', -90000]])

    const preview = recurring.previewManual(seeded.transactionIds[0]!)
    const created = recurring.createManual({
      transactionId: seeded.transactionIds[0]!,
      displayName: 'Synthetic Rent - Payee',
      recurrenceType: 'recurring_payment',
      cadence: 'monthly'
    })

    expect(preview).toMatchObject({
      matchingBasis: 'merchant',
      merchantId: seeded.merchantId,
      matchingTransactionCount: 3
    })
    expect(created).toMatchObject({
      status: 'confirmed',
      source: 'manual',
      recurrenceType: 'recurring_payment',
      cadence: 'monthly',
      canonicalDescription: 'Synthetic Rent - Payee',
      occurrenceCount: 3
    })
    expect(created.occurrences.map((occurrence) => occurrence.transactionId)).toEqual(
      seeded.transactionIds
    )
    expect(
      recurring
        .findConfirmedSummariesForTransactions(seeded.transactionIds)
        .get(seeded.transactionIds[0]!)
    ).toMatchObject({
      seriesId: created.id,
      displayName: 'Synthetic Rent - Payee',
      recurrenceType: 'recurring_payment',
      cadence: 'monthly',
      source: 'manual'
    })
  })

  it('manually falls back to exact description and excludes unrelated transactions', () => {
    const matching = commit('manual-description-matches', [
      makeTransaction('2026-01-05', 'Synthetic Exact Descriptor', -2500, 'expense', 0),
      makeTransaction('2026-02-05', 'Synthetic Exact Descriptor', -2500, 'expense', 1),
      makeTransaction('2026-02-05', 'Synthetic Other Descriptor', -2500, 'expense', 2)
    ])

    const created = recurring.createManual({
      transactionId: matching.transactions[0]!.id,
      displayName: 'Synthetic exact recurring',
      recurrenceType: 'subscription',
      cadence: 'monthly'
    })

    expect(created).toMatchObject({
      matchingBasis: 'description',
      merchantId: undefined,
      status: 'confirmed',
      source: 'manual',
      occurrenceCount: 2
    })
    expect(created.occurrences.map((occurrence) => occurrence.description)).toEqual([
      'Synthetic Exact Descriptor',
      'Synthetic Exact Descriptor'
    ])
  })

  it('does not duplicate an existing manual series when created repeatedly', () => {
    const seeded = seedMerchantTransactions('Synthetic Manual Repeat', [
      ['2026-01-08', -1200],
      ['2026-02-07', -1200]
    ])

    const first = recurring.createManual({
      transactionId: seeded.transactionIds[0]!,
      displayName: 'Synthetic first name',
      recurrenceType: 'subscription',
      cadence: 'monthly'
    })
    const second = recurring.createManual({
      transactionId: seeded.transactionIds[1]!,
      displayName: 'Synthetic second name',
      recurrenceType: 'recurring_bill',
      cadence: 'quarterly'
    })

    expect(second.id).toBe(first.id)
    expect(
      recurring.list().filter((series) => series.merchantId === seeded.merchantId)
    ).toHaveLength(1)
    expect(second).toMatchObject({
      source: 'manual',
      status: 'confirmed',
      recurrenceType: 'recurring_bill',
      cadence: 'quarterly',
      canonicalDescription: 'Synthetic second name'
    })
  })

  it('updates and deletes user-managed recurring series fields', () => {
    const seeded = seedMerchantTransactions('Synthetic Editable Recurring', [
      ['2026-01-08', -1200],
      ['2026-02-07', -1200]
    ])
    const created = recurring.createManual({
      transactionId: seeded.transactionIds[0]!,
      displayName: 'Synthetic editable',
      recurrenceType: 'subscription',
      cadence: 'monthly'
    })

    const updated = recurring.update({
      seriesId: created.id,
      displayName: 'Synthetic edited',
      recurrenceType: 'recurring_bill',
      cadence: 'quarterly'
    })

    expect(updated).toMatchObject({
      id: created.id,
      canonicalDescription: 'Synthetic edited',
      recurrenceType: 'recurring_bill',
      cadence: 'quarterly',
      status: 'confirmed',
      source: 'manual',
      occurrenceCount: 2
    })

    recurring.delete(created.id)

    expect(recurring.list().some((series) => series.id === created.id)).toBe(false)
    expect(recurring.findConfirmedSummariesForTransactions(seeded.transactionIds).size).toBe(0)
  })

  it('rescans preserve and extend manual recurring series without downgrading them', () => {
    const seeded = seedMerchantTransactions('Synthetic Manual Extend', [
      ['2026-01-10', -3300],
      ['2026-02-09', -3300]
    ])
    const manual = recurring.createManual({
      transactionId: seeded.transactionIds[0]!,
      displayName: 'Synthetic manual preserved',
      recurrenceType: 'recurring_payment',
      cadence: 'irregular'
    })

    recurring.scan()

    expect(
      recurring.list().filter((series) => series.merchantId === seeded.merchantId)
    ).toHaveLength(1)
    expect(recurring.list().find((series) => series.id === manual.id)).toMatchObject({
      source: 'manual',
      status: 'confirmed',
      recurrenceType: 'recurring_payment',
      cadence: 'irregular',
      canonicalDescription: 'Synthetic manual preserved',
      occurrenceCount: 2
    })

    seedMerchantTransactions(
      'Synthetic Manual Extend',
      [['2026-03-11', -3300]],
      seeded.merchantId,
      'manual-extend-new'
    )
    recurring.scan()

    expect(
      recurring.list().filter((series) => series.merchantId === seeded.merchantId)
    ).toHaveLength(1)
    expect(recurring.get(manual.id)).toMatchObject({
      source: 'manual',
      status: 'confirmed',
      recurrenceType: 'recurring_payment',
      cadence: 'irregular',
      canonicalDescription: 'Synthetic manual preserved',
      occurrenceCount: 3
    })
  })

  it('does not recreate rejected exact-description candidates on repeated scans', () => {
    commit('descriptor', [
      makeTransaction('2026-01-10', 'Synthetic Descriptor', -1000),
      makeTransaction('2026-02-09', 'Synthetic Descriptor', -1000),
      makeTransaction('2026-03-11', 'Synthetic Descriptor', -1000)
    ])

    recurring.scan()
    const candidate = recurring.list()[0]!
    recurring.reject(candidate.id)
    recurring.scan()

    expect(recurring.list()).toHaveLength(1)
    expect(recurring.list()[0]).toMatchObject({
      id: candidate.id,
      status: 'rejected',
      recurrenceType: 'not_recurring'
    })
  })

  function seedMerchantSeries(
    merchantName: string,
    rows: Array<[string, number]>,
    existingMerchantId?: string,
    hashSuffix = merchantName
  ): string {
    return seedMerchantTransactions(merchantName, rows, existingMerchantId, hashSuffix).merchantId
  }

  function seedMerchantTransactions(
    merchantName: string,
    rows: Array<[string, number]>,
    existingMerchantId?: string,
    hashSuffix = merchantName
  ): { merchantId: string; transactionIds: string[] } {
    const merchantId = existingMerchantId ?? merchants.create({ name: merchantName }).id
    const result = commit(
      hashSuffix,
      rows.map(([date, amount], index) =>
        makeTransaction(date, merchantName, amount, amount > 0 ? 'income' : 'expense', index)
      )
    )
    for (const transaction of result.transactions) {
      if (transaction.amountCents < 0) {
        classifications.save({
          transactionId: transaction.id,
          merchantId,
          merchantSource: 'manual',
          classificationSource: 'manual',
          classificationStatus: 'confirmed'
        })
      }
    }
    return { merchantId, transactionIds: result.transactions.map((transaction) => transaction.id) }
  }

  function commit(
    hashLabel: string,
    rows: NewTransaction[]
  ): ReturnType<ImportService['commitPreparedImport']> {
    return imports.commitPreparedImport(prepared(hashLabel, rows))
  }

  function prepared(hashLabel: string, rows: NewTransaction[]): PreparedImport {
    return {
      accountId,
      sourceKind: 'unknown',
      sourceFileName: `${hashLabel}.txt`,
      fileSha256: hashFor(hashLabel),
      transactions: rows
    }
  }

  function makeTransaction(
    transactionDate: string,
    originalDescription: string,
    amountCents: number,
    transactionType: NewTransaction['transactionType'] = 'expense',
    sourceRowIndex = 0
  ): NewTransaction {
    return {
      accountId,
      sourceRowIndex,
      transactionDate,
      originalDescription,
      amountCents,
      transactionType
    }
  }
})

function hashFor(label: string): string {
  return createHash('sha256').update(label).digest('hex')
}
