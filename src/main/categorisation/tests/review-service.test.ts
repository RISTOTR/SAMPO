import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, type SampoDatabase } from '../../storage/database'
import { AccountRepository } from '../../storage/accounts'
import { ImportService } from '../../services/import-service'
import {
  CategoryRepository,
  MerchantRepository,
  TransactionClassificationRepository,
  CategorisationRuleRepository,
  MerchantAliasRepository
} from '../../storage/categorisation'
import { AiSettingsRepository, AiSuggestionRepository } from '../../storage/ai'
import { ClassificationService } from '../classification-service'
import { ReviewService } from '../review-service'
import { SmartClassificationService } from '../../ai/smart-classification-service'
import type { Mock } from 'vitest'
import type { Transaction, AiClassificationSuggestion } from '../../domain/schemas'
import type { AiClassificationInput, AiClassificationProvider } from '../../ai/provider'

describe('consolidated classification review', () => {
  let directory: string
  let db: SampoDatabase
  let accountId: string
  let merchantId: string
  let categoryId: string
  let classifier: ClassificationService
  let review: ReviewService
  let sequence: number
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-review-'))
    db = createDatabase({ path: join(directory, 'test.sqlite3'), useWal: false })
    accountId = new AccountRepository(db.connection).create({
      name: 'Synthetic',
      kind: 'current'
    }).id
    merchantId = new MerchantRepository(db.connection).create({ name: 'Synthetic supermarket' }).id
    categoryId = new CategoryRepository(db.connection).create({ name: 'Synthetic groceries' }).id
    classifier = new ClassificationService(db.connection)
    review = new ReviewService(db.connection)
    new AiSettingsRepository(db.connection).update({ aiEnabled: true })
    sequence = 0
  })
  afterEach(() => {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  function add(descriptions: string[], context = accountId): Transaction[] {
    sequence++
    return new ImportService(db.connection).commitPreparedImport({
      accountId: context,
      sourceKind: 'unknown',
      sourceFileName: 'synthetic.txt',
      fileSha256: sequence.toString(16).padStart(64, '0'),
      transactions: descriptions.map((originalDescription, sourceRowIndex) => ({
        accountId: context,
        sourceRowIndex,
        originalDescription,
        amountCents: -1000 - sequence,
        transactionDate: '2026-01-01',
        transactionType: 'expense'
      }))
    }).transactions
  }
  function confirm(id: string): void {
    classifier.saveManual({ transactionId: id, merchantId, categoryId })
  }
  function provider(): { classify: Mock<AiClassificationProvider['classify']> } {
    return {
      classify: vi.fn(async (inputs: AiClassificationInput[]) =>
        inputs.map((input) => ({
          inputId: input.inputId,
          merchant: { canonicalName: 'Synthetic AI shop', confidence: 0.9 },
          category: { categoryId, confidence: 0.9, categoryUnknown: false },
          needsWebLookup: false,
          reasonCode: 'known_brand' as const
        }))
      )
    }
  }
  function stale(id: string, confidence = 900): AiClassificationSuggestion {
    return new AiSuggestionRepository(db.connection).create({
      transactionId: id,
      provider: 'openai',
      model: 'synthetic',
      suggestedMerchantName: 'Synthetic wrong shop',
      suggestedCategoryId: categoryId,
      merchantConfidence: confidence,
      categoryConfidence: confidence,
      needsWebLookup: false,
      usedWebSearch: false,
      reasonCode: 'known_brand'
    })
  }
  it('lists detections and unclassified rows, excludes confirmed, accepts selected and survives restart', () => {
    const [a, b, c] = add(['SYNTHETIC MARKET', 'SYNTHETIC MARKET', 'UNKNOWN SHOP'])
    confirm(a!.id)
    expect(
      review
        .list({})
        .items.map((item) => item.transactionId)
        .sort()
    ).toEqual([b!.id, c!.id].sort())
    expect(review.list({ source: 'Local' }).items[0]).toMatchObject({
      transactionId: b!.id,
      merchantSource: 'Learned',
      canBulkAccept: true
    })
    expect(review.accept({ transactionIds: [b!.id] })).toBe(1)
    db.close()
    db = createDatabase({ path: join(directory, 'test.sqlite3'), useWal: false })
    review = new ReviewService(db.connection)
    expect(review.list({}).items.map((item) => item.transactionId)).toEqual([c!.id])
  })
  it('local history beats rules and stale AI; truncated acceptance teaches exact history', async () => {
    const [a, b] = add(['SYNTHMARKETPLACE', 'SYNTHMARKET'])
    confirm(a!.id)
    new CategorisationRuleRepository(db.connection).create({
      name: 'Wrong rule',
      descriptionMatchKind: 'exact',
      descriptionPattern: 'SYNTHMARKET',
      merchantId: new MerchantRepository(db.connection).create({ name: 'Wrong merchant' }).id
    })
    stale(b!.id)
    expect(review.list({}).items[0]).toMatchObject({
      merchantName: 'Synthetic supermarket',
      merchantSource: 'Historical match'
    })
    const p = provider()
    const ai = new SmartClassificationService(db.connection, p)
    await ai.classifyTransactions([b!.id])
    expect(p.classify).not.toHaveBeenCalled()
    review.accept({ transactionIds: [b!.id] })
    const [next] = add(['SYNTHMARKET'])
    expect(review.list({}).items[0]?.merchantSource).toBe('Learned')
    await ai.classifyTransactions([next!.id])
    expect(p.classify).not.toHaveBeenCalled()
  })
  it('keeps conflicting manual history and multiple prefix candidates reviewable without AI', async () => {
    const [a, b, c] = add(['SYNTHMARKET ONE', 'SYNTHMARKET TWO', 'SYNTHMARKET'])
    confirm(a!.id)
    confirm(b!.id)
    expect(review.list({}).items[0]).toMatchObject({
      transactionId: c!.id,
      conflict: true,
      canAcceptMerchant: false,
      canBulkAccept: false
    })
    const p = provider()
    await new SmartClassificationService(db.connection, p).classifyTransactions([c!.id])
    expect(p.classify).not.toHaveBeenCalled()
  })
  it('does not transfer history across accounts', () => {
    const [a] = add(['SYNTHMARKETPLACE'])
    confirm(a!.id)
    const other = new AccountRepository(db.connection).create({
      name: 'Other synthetic',
      kind: 'credit_card'
    }).id
    const [b] = add(['SYNTHMARKET'], other)
    expect(review.list({}).items.find((item) => item.transactionId === b!.id)).toMatchObject({
      merchantSource: 'Unclassified'
    })
  })
  it('partial acceptance does not confirm the other detected field; rejection stays rejected', () => {
    const [a, b] = add(['SYNTHETIC SHOP', 'SYNTHETIC SHOP'])
    confirm(a!.id)
    review.accept({ transactionIds: [b!.id], acceptMerchant: true, acceptCategory: false })
    expect(
      new TransactionClassificationRepository(db.connection).findByTransactionId(b!.id)
    ).toMatchObject({ merchantId, categoryId: undefined })
    expect(review.list({}).items[0]).toMatchObject({
      canAcceptMerchant: false,
      canAcceptCategory: true
    })
    review.reject({ transactionId: b!.id })
    expect(new ReviewService(db.connection).list({}).items[0]).toMatchObject({
      canAcceptCategory: false,
      merchantName: 'Synthetic supermarket'
    })
    classifier.saveManual({ transactionId: b!.id, merchantId, categoryId })
    expect(review.list({}).total).toBe(0)
  })
  it('batches unique context descriptors and reuses persistent results for later matching rows', async () => {
    const rows = add(['UNKNOWN SYNTH', 'UNKNOWN SYNTH', 'ANOTHER SYNTH'])
    const p = provider()
    const ai = new SmartClassificationService(db.connection, p)
    const result = await ai.classifyTransactions(rows.map((row) => row.id))
    expect(p.classify).toHaveBeenCalledTimes(1)
    expect(p.classify.mock.calls[0]![0]).toHaveLength(2)
    expect(result).toMatchObject({ aiClassifications: 2, suggestionsCreated: 3 })
    const [later] = add(['UNKNOWN SYNTH'])
    db.close()
    db = createDatabase({ path: join(directory, 'test.sqlite3'), useWal: false })
    review = new ReviewService(db.connection)
    await new SmartClassificationService(db.connection, p).classifyTransactions([later!.id])
    expect(p.classify).toHaveBeenCalledTimes(1)
    expect(review.list({ source: 'AI' }).total).toBe(4)
  })
  it('bulk acceptance skips low-confidence AI and never touches unselected rows', () => {
    const [a, b, c] = add(['UNKNOWN ONE', 'UNKNOWN TWO', 'UNKNOWN THREE'])
    stale(a!.id, 100)
    stale(b!.id)
    stale(c!.id)
    expect(review.accept({ transactionIds: [a!.id, b!.id] })).toBe(1)
    expect(
      review
        .list({})
        .items.map((item) => item.transactionId)
        .sort()
    ).toEqual([a!.id, c!.id].sort())
  })
  it('invalidates descriptor cache when any copied suggestion is rejected', async () => {
    const rows = add(['UNKNOWN CACHE', 'UNKNOWN CACHE'])
    const p = provider()
    const ai = new SmartClassificationService(db.connection, p)
    await ai.classifyTransactions(rows.map((row) => row.id))
    review.reject({ transactionId: rows[0]!.id })
    const [next] = add(['UNKNOWN CACHE'])
    await ai.classifyTransactions([next!.id])
    expect(p.classify).toHaveBeenCalledTimes(2)
  })

  it('uses a unique exact-alias truncation only with confirmed merchant history in context', () => {
    const [known] = add(['SYNTHETIC HISTORY'])
    confirm(known!.id)
    new MerchantAliasRepository(db.connection).create({
      merchantId,
      pattern: 'ALIASMARKETPLACE',
      matchKind: 'exact'
    })
    const [next] = add(['ALIASMARKET'])
    expect(review.list({}).items.find((item) => item.transactionId === next!.id)).toMatchObject({
      merchantName: 'Synthetic supermarket',
      merchantSource: 'Historical match'
    })
  })

  it('validates assignable categories and rolls back a bulk request if one row is invalid', () => {
    const rows = add(['UNKNOWN VALID', 'UNKNOWN INVALID'])
    stale(rows[0]!.id)
    stale(rows[1]!.id)
    expect(() =>
      review.accept({ transactionIds: [rows[0]!.id, '11111111-1111-4111-8111-999999999999'] })
    ).toThrow()
    expect(
      new TransactionClassificationRepository(db.connection).findByTransactionId(rows[0]!.id)
    ).toBeUndefined()
    new CategoryRepository(db.connection).setActive(categoryId, false)
    expect(() => review.accept({ transactionIds: [rows[0]!.id] })).toThrow()
  })
})
