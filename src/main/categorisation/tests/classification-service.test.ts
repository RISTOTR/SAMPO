import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClassificationService } from '../classification-service'
import { normaliseMatchText } from '../normalisation'
import { createDatabase, type SampoDatabase } from '../../storage/database'
import { AccountRepository } from '../../storage/accounts'
import {
  CategorisationRuleRepository,
  CategoryRepository,
  MerchantAliasRepository,
  MerchantRepository,
  TransactionClassificationRepository
} from '../../storage/categorisation'
import { TransactionRepository } from '../../storage/transactions'
import { ImportService } from '../../services/import-service'
import type { Account, NewTransaction, PreparedImport } from '../../domain/schemas'

const hash = 'c'.repeat(64)

function makeTransaction(
  accountId: string,
  overrides: Partial<NewTransaction> = {}
): NewTransaction {
  return {
    accountId,
    sourceRowIndex: 0,
    transactionDate: '2026-03-01',
    originalDescription: 'Synthetic Grocery Market',
    amountCents: -1200,
    transactionType: 'expense',
    ...overrides
  }
}

function makeImport(accountId: string, transactions: NewTransaction[]): PreparedImport {
  return {
    accountId,
    sourceKind: 'unknown',
    sourceFileName: 'synthetic.txt',
    fileSha256: hash,
    transactions
  }
}

describe('Phase 6 categorisation', () => {
  let directory: string
  let database: SampoDatabase
  let account: Account
  let service: ClassificationService
  let categories: CategoryRepository
  let merchants: MerchantRepository
  let aliases: MerchantAliasRepository
  let rules: CategorisationRuleRepository
  let classifications: TransactionClassificationRepository
  let transactions: TransactionRepository
  let imports: ImportService

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-classification-'))
    database = createDatabase({ path: join(directory, 'sampo.sqlite3'), useWal: false })
    account = new AccountRepository(database.connection).create({
      name: 'Synthetic account',
      kind: 'current'
    })
    service = new ClassificationService(database.connection)
    categories = new CategoryRepository(database.connection)
    merchants = new MerchantRepository(database.connection)
    aliases = new MerchantAliasRepository(database.connection)
    rules = new CategorisationRuleRepository(database.connection)
    classifications = new TransactionClassificationRepository(database.connection)
    transactions = new TransactionRepository(database.connection)
    imports = new ImportService(database.connection)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates Phase 6 tables and seeds default categories idempotently', () => {
    const seeded = categories.list()
    expect(seeded.some((category) => category.name === 'Housing')).toBe(true)
    expect(seeded.some((category) => category.name === 'Restaurants and cafés')).toBe(true)
    const count = seeded.length
    database.close()

    database = createDatabase({ path: join(directory, 'sampo.sqlite3'), useWal: false })
    categories = new CategoryRepository(database.connection)
    expect(categories.list()).toHaveLength(count)
  })

  it('normalises matching text deterministically', () => {
    expect(normaliseMatchText('  CAFÉ\u00a0  MARKET   ')).toBe('café market')
    expect(normaliseMatchText('A--B')).toBe('a--b')
  })

  it('enforces category hierarchy and duplicate sibling rules', () => {
    const parent = categories.create({ name: 'Synthetic parent' })
    categories.create({ name: 'Synthetic child', parentId: parent.id })

    expect(() => categories.create({ name: 'synthetic child', parentId: parent.id })).toThrow()
    expect(() =>
      categories.update({ id: parent.id, name: 'Invalid', parentId: parent.id, sortOrder: 0 })
    ).toThrow()
  })

  it('ranks merchant aliases and reports equal-rank merchant conflicts as ambiguous', () => {
    const first = merchants.create({ name: 'Synthetic Market' })
    const second = merchants.create({ name: 'Synthetic Shop' })
    aliases.create({ merchantId: first.id, matchKind: 'contains', pattern: 'Market', priority: 0 })
    aliases.create({
      merchantId: first.id,
      matchKind: 'starts_with',
      pattern: 'Synthetic',
      priority: 0
    })
    const committed = imports.commitPreparedImport(
      makeImport(account.id, [makeTransaction(account.id)])
    )

    expect(service.evaluateTransaction(committed.transactions[0]!.id)).toMatchObject({
      merchantId: first.id,
      status: 'needs_review'
    })

    aliases.create({
      merchantId: second.id,
      matchKind: 'starts_with',
      pattern: 'Synthetic Grocery',
      priority: 0
    })
    expect(service.evaluateTransaction(committed.transactions[0]!.id)).toMatchObject({
      status: 'ambiguous'
    })
  })

  it('reuses confirmed manual merchant and category for identical descriptions without persisting the inferred row', () => {
    const merchant = merchants.create({ name: 'Synthetic Grocery Merchant' })
    const category = categories.create({ name: 'Synthetic Grocery Category' })
    const committed = imports.commitPreparedImport(
      makeImport(account.id, [
        makeTransaction(account.id, { sourceRowIndex: 0 }),
        makeTransaction(account.id, { sourceRowIndex: 1 })
      ])
    )

    service.saveManual({
      transactionId: committed.transactions[0]!.id,
      merchantId: merchant.id,
      categoryId: category.id
    })

    expect(service.evaluateTransaction(committed.transactions[1]!.id)).toMatchObject({
      merchantId: merchant.id,
      merchantName: 'Synthetic Grocery Merchant',
      categoryId: category.id,
      categoryPath: ['Synthetic Grocery Category'],
      status: 'needs_review',
      source: 'rule'
    })
    expect(classifications.findByTransactionId(committed.transactions[1]!.id)).toBeUndefined()
  })

  it('marks identical descriptions ambiguous when confirmed manual merchant examples conflict', () => {
    const firstMerchant = merchants.create({ name: 'Synthetic Grocery Merchant A' })
    const secondMerchant = merchants.create({ name: 'Synthetic Grocery Merchant B' })
    const committed = imports.commitPreparedImport(
      makeImport(account.id, [
        makeTransaction(account.id, { sourceRowIndex: 0 }),
        makeTransaction(account.id, { sourceRowIndex: 1 }),
        makeTransaction(account.id, { sourceRowIndex: 2 })
      ])
    )

    service.saveManual({
      transactionId: committed.transactions[0]!.id,
      merchantId: firstMerchant.id
    })
    service.saveManual({
      transactionId: committed.transactions[1]!.id,
      merchantId: secondMerchant.id
    })

    expect(service.evaluateTransaction(committed.transactions[2]!.id)).toMatchObject({
      status: 'ambiguous',
      source: 'unclassified'
    })
  })

  it('marks identical descriptions ambiguous when confirmed manual category examples conflict', () => {
    const firstCategory = categories.create({ name: 'Synthetic Grocery Category A' })
    const secondCategory = categories.create({ name: 'Synthetic Grocery Category B' })
    const committed = imports.commitPreparedImport(
      makeImport(account.id, [
        makeTransaction(account.id, { sourceRowIndex: 0 }),
        makeTransaction(account.id, { sourceRowIndex: 1 }),
        makeTransaction(account.id, { sourceRowIndex: 2 })
      ])
    )

    service.saveManual({
      transactionId: committed.transactions[0]!.id,
      categoryId: firstCategory.id
    })
    service.saveManual({
      transactionId: committed.transactions[1]!.id,
      categoryId: secondCategory.id
    })

    expect(service.evaluateTransaction(committed.transactions[2]!.id)).toMatchObject({
      status: 'ambiguous',
      source: 'unclassified'
    })
  })

  it('applies rules after import without changing source facts and keeps pending rows reviewable', () => {
    const category = categories.create({ name: 'Synthetic groceries' })
    rules.create({
      name: 'Synthetic grocery rule',
      descriptionMatchKind: 'contains',
      descriptionPattern: 'grocery',
      categoryId: category.id,
      usageType: 'personal'
    })
    const committed = imports.commitPreparedImport(
      makeImport(account.id, [
        makeTransaction(account.id, { sourceRowIndex: 0 }),
        makeTransaction(account.id, {
          sourceRowIndex: 1,
          originalDescription: 'Synthetic Grocery Pending',
          isPending: true
        })
      ])
    )

    const first = classifications.findByTransactionId(committed.transactions[0]!.id)
    const pending = classifications.findByTransactionId(committed.transactions[1]!.id)
    expect(first).toMatchObject({ categoryId: category.id, classificationStatus: 'confirmed' })
    expect(pending).toMatchObject({ categoryId: category.id, classificationStatus: 'needs_review' })
    expect(transactions.findById(committed.transactions[0]!.id).originalDescription).toBe(
      'Synthetic Grocery Market'
    )
  })

  it('preserves manual classifications and previews historical rule application read-only', () => {
    const category = categories.create({ name: 'Synthetic category' })
    const committed = imports.commitPreparedImport(
      makeImport(account.id, [makeTransaction(account.id)])
    )
    service.saveManual({
      transactionId: committed.transactions[0]!.id,
      categoryId: category.id,
      usageType: 'business'
    })

    const preview = service.previewRule({
      name: 'Synthetic preview',
      descriptionMatchKind: 'contains',
      descriptionPattern: 'grocery',
      usageType: 'personal'
    })

    expect(preview.manualPreservedCount).toBe(1)
    expect(rules.list()).toHaveLength(0)
    expect(service.evaluateTransaction(committed.transactions[0]!.id)).toMatchObject({
      source: 'manual',
      usageType: 'business'
    })
  })

  it('keeps broad category rules away from card settlements unless explicit', () => {
    const category = categories.create({ name: 'Synthetic bills' })
    rules.create({
      name: 'Broad synthetic card rule',
      descriptionMatchKind: 'contains',
      descriptionPattern: 'visa',
      categoryId: category.id
    })
    const committed = imports.commitPreparedImport(
      makeImport(account.id, [
        makeTransaction(account.id, {
          transactionType: 'card_settlement',
          originalDescription: 'Synthetic Visa Settlement'
        })
      ])
    )

    expect(classifications.findByTransactionId(committed.transactions[0]!.id)).toBeUndefined()
  })

  it('filters transaction pages by classification and cascades classifications on rollback', () => {
    const category = categories.create({ name: 'Synthetic filter category' })
    const committed = imports.commitPreparedImport(
      makeImport(account.id, [makeTransaction(account.id)])
    )
    service.saveManual({
      transactionId: committed.transactions[0]!.id,
      categoryId: category.id,
      usageType: 'personal'
    })

    expect(
      transactions.listPage({
        categoryId: category.id,
        sortBy: 'transactionDate',
        sortDirection: 'desc',
        limit: 50,
        offset: 0
      }).total
    ).toBe(1)

    imports.rollbackCommittedBatch(committed.batch.id)
    expect(classifications.findByTransactionId(committed.transactions[0]!.id)).toBeUndefined()
    expect(categories.findById(category.id)).toMatchObject({ name: 'Synthetic filter category' })
  })
})
