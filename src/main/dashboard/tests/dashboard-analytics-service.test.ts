import { createHash } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { DashboardAnalyticsService } from '../dashboard-analytics-service'
import type { NewTransaction, PreparedImport } from '../../domain/schemas'
import { AccountRepository } from '../../storage/accounts'
import { createDatabase, type SampoDatabase } from '../../storage/database'
import { ImportService } from '../../services/import-service'
import {
  CategoryRepository,
  MerchantRepository,
  TransactionClassificationRepository
} from '../../storage/categorisation'
import { TransactionLinkRepository } from '../../storage/transaction-links'
import { RecurringDetectionService } from '../../recurring/recurring-service'

describe('DashboardAnalyticsService', () => {
  let directory: string
  let database: SampoDatabase
  let connection: Database
  let accountId: string
  let visaAccountId: string
  let imports: ImportService
  let categories: CategoryRepository
  let merchants: MerchantRepository
  let classifications: TransactionClassificationRepository
  let links: TransactionLinkRepository
  let recurring: RecurringDetectionService
  let dashboard: DashboardAnalyticsService
  let sourceRowIndex = 0

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-dashboard-'))
    database = createDatabase({ path: join(directory, 'dashboard.sqlite3'), useWal: false })
    connection = database.connection
    const accounts = new AccountRepository(connection)
    accountId = accounts.create({ name: 'Synthetic current', kind: 'current' }).id
    visaAccountId = accounts.create({ name: 'Synthetic Visa', kind: 'credit_card' }).id
    imports = new ImportService(connection)
    categories = new CategoryRepository(connection)
    merchants = new MerchantRepository(connection)
    classifications = new TransactionClassificationRepository(connection)
    links = new TransactionLinkRepository(connection)
    recurring = new RecurringDetectionService(connection)
    dashboard = new DashboardAnalyticsService(connection)
    sourceRowIndex = 0
  })

  afterEach(() => {
    database?.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('returns safe empty values with no imported data', () => {
    const data = dashboard.getDashboard()

    expect(data).toMatchObject({
      hasData: false,
      transactionCount: 0,
      totalSpending: { amountCents: 0 },
      totalIncome: { amountCents: 0 },
      netCashFlow: { amountCents: 0 }
    })
    expect(data.categories).toHaveLength(0)
    expect(data.monthlyTrend).toHaveLength(0)
  })

  it('calculates deterministic dashboard metrics and avoids Visa settlement double counting', () => {
    const food = categories.create({ name: 'Synthetic Food' })
    const groceries = categories.create({ name: 'Synthetic Groceries', parentId: food.id })
    const utilities = categories.create({ name: 'Synthetic Utilities' })
    const groceryMerchant = merchants.create({ name: 'Synthetic Grocer' })
    const utilityMerchant = merchants.create({ name: 'Synthetic Utility' })

    const december = commit('december', [
      transaction('2025-12-10', 'Synthetic Grocer', -70000, 'expense', visaAccountId)
    ])
    const visa = commit('january-visa', [
      transaction('2026-01-05', 'Synthetic Grocer', -100000, 'expense', visaAccountId),
      transaction('2026-01-08', 'Synthetic Restaurant', -50000, 'expense', visaAccountId),
      transaction('2026-01-10', 'Synthetic Refund', 20000, 'refund', visaAccountId)
    ])
    const account = commit('january-account', [
      transaction('2026-01-01', 'Synthetic Salary', 300000, 'income', accountId),
      transaction('2026-01-20', 'Synthetic Utility', -30000, 'expense', accountId),
      transaction('2026-01-31', 'Synthetic Visa Settlement', -130000, 'card_settlement', accountId)
    ])

    links.createMany(
      visa.transactions.slice(0, 3).map((item) => ({
        fromTransactionId: account.transactions[2]!.id,
        toTransactionId: item.id,
        kind: 'card_settlement'
      }))
    )
    classify(december.transactions[0]!.id, groceryMerchant.id, groceries.id)
    classify(visa.transactions[0]!.id, groceryMerchant.id, groceries.id)
    classify(account.transactions[1]!.id, utilityMerchant.id, utilities.id)
    recurring.createManual({
      transactionId: account.transactions[1]!.id,
      displayName: 'Synthetic Utility',
      recurrenceType: 'recurring_bill',
      cadence: 'monthly'
    })

    const data = dashboard.getDashboard({ preset: 'latest_month' })

    expect(data.period).toMatchObject({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      previousDateFrom: '2025-12-01',
      previousDateTo: '2025-12-31'
    })
    expect(data.totalSpending.amountCents).toBe(160000)
    expect(data.totalIncome.amountCents).toBe(300000)
    expect(data.netCashFlow.amountCents).toBe(140000)
    expect(data.transactionCount).toBe(6)
    expect(data.totalSpending.comparison).toMatchObject({ amountCents: 90000 })
    expect(data.totalSpending.comparison?.percent).toBeCloseTo(128.6)
    expect(data.categories.reduce((sum, category) => sum + category.amountCents, 0)).toBe(
      data.totalSpending.amountCents
    )

    expect(data.categories.map((category) => category.label)).toContain('Unclassified')
    expect(
      data.categories.find((category) => category.label === 'Synthetic Food / Synthetic Groceries')
    ).toMatchObject({
      amountCents: 100000,
      previousAmountCents: 70000,
      differenceCents: 30000
    })
    expect(
      data.categories.find((category) => category.label === 'Synthetic Utilities')
    ).toMatchObject({
      amountCents: 30000
    })
    expect(data.categories.find((category) => category.label === 'Unclassified')).toMatchObject({
      amountCents: 30000,
      transactionCount: 2
    })

    expect(data.merchants[0]).toMatchObject({
      merchantId: groceryMerchant.id,
      label: 'Synthetic Grocer',
      amountCents: 100000
    })
    expect(data.merchants.map((merchant) => merchant.label)).not.toContain(
      'Synthetic Visa Settlement'
    )
    expect(data.merchants.reduce((sum, merchant) => sum + merchant.amountCents, 0)).toBe(
      data.totalSpending.amountCents
    )
    expect(data.recurring).toMatchObject({
      totalCents: 30000,
      recurringBillCents: 30000,
      confirmedSeriesCount: 1
    })
    expect(data.monthlyTrend).toContainEqual(
      expect.objectContaining({
        month: '2026-01',
        spendingCents: 160000,
        incomeCents: 300000,
        recurringSpendCents: 30000
      })
    )
    expect(data.monthlyTrend.find((month) => month.month === '2026-01')?.spendingCents).toBe(
      data.totalSpending.amountCents
    )
    expect(data.biggestChanges[0]).toMatchObject({
      label: 'Synthetic Food / Synthetic Groceries',
      differenceCents: 30000
    })
    expect(data.dataQuality.needsConfirmationCount).toBeGreaterThan(0)
    expect(data.dataQuality.classifiedSpendingPercent).toBeCloseTo(81.3)
  })

  it('supports multi-month period selection and excludes candidate recurring series', () => {
    const utilityMerchant = merchants.create({ name: 'Synthetic Utility' })
    const utilities = categories.create({ name: 'Synthetic Utilities Multi' })
    const rows = commit('multi-month', [
      transaction('2026-01-10', 'Synthetic Utility', -10000, 'expense', accountId),
      transaction('2026-02-10', 'Synthetic Utility', -12000, 'expense', accountId),
      transaction('2026-03-10', 'Synthetic Utility', -14000, 'expense', accountId)
    ])
    for (const item of rows.transactions) classify(item.id, utilityMerchant.id, utilities.id)

    recurring.scan()
    const data = dashboard.getDashboard({ preset: 'last_3_months' })

    expect(data.period).toMatchObject({ dateFrom: '2026-01-01', dateTo: '2026-03-31' })
    expect(data.totalSpending.amountCents).toBe(36000)
    expect(data.categories.reduce((sum, category) => sum + category.amountCents, 0)).toBe(
      data.totalSpending.amountCents
    )
    expect(data.recurring.totalCents).toBe(0)
    expect(data.monthlyTrend.map((month) => month.month)).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  function classify(transactionId: string, merchantId: string, categoryId: string): void {
    classifications.save({
      transactionId,
      merchantId,
      merchantSource: 'manual',
      categoryId,
      categorySource: 'manual',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
  }

  function commit(
    hashLabel: string,
    rows: NewTransaction[]
  ): ReturnType<ImportService['commitPreparedImport']> {
    return imports.commitPreparedImport(prepared(hashLabel, rows))
  }

  function prepared(hashLabel: string, rows: NewTransaction[]): PreparedImport {
    return {
      accountId: rows[0]?.accountId ?? accountId,
      sourceKind: 'unknown',
      sourceFileName: `${hashLabel}.txt`,
      fileSha256: createHash('sha256').update(hashLabel).digest('hex'),
      transactions: rows
    }
  }

  function transaction(
    transactionDate: string,
    originalDescription: string,
    amountCents: number,
    transactionType: NewTransaction['transactionType'],
    targetAccountId: string
  ): NewTransaction {
    return {
      accountId: targetAccountId,
      sourceRowIndex: sourceRowIndex++,
      transactionDate,
      originalDescription,
      amountCents,
      transactionType
    }
  }
})
