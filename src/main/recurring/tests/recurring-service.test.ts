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
    return merchantId
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
