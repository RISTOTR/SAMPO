import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Database } from 'better-sqlite3'
import OpenAI from 'openai'
import { createDatabase, type SampoDatabase } from '../storage/database'
import { AccountRepository } from '../storage/accounts'
import { ImportService } from '../services/import-service'
import { TransactionRepository } from '../storage/transactions'
import { AiSettingsRepository, AiSuggestionRepository } from '../storage/ai'
import {
  MerchantAliasRepository,
  MerchantRepository,
  TransactionClassificationRepository
} from '../storage/categorisation'
import { SmartClassificationService } from '../ai/smart-classification-service'
import { openAiErrorMetadata } from '../ai/diagnostics'
import {
  mapProviderError,
  OpenAiClassificationProvider,
  structuredOutputSchema,
  testOpenAiResponsesConnection,
  type AiClassificationProvider
} from '../ai/provider'
import { MemorySecretStore } from '../ai/secret-store'
import {
  AiInvalidResponseError,
  AiPartialResponseError,
  AiSuggestionNotFoundError
} from '../ai/errors'
import { AliasConflictError, ManualClassificationPreservedError } from '../categorisation/errors'
import type { AiClassificationSuggestion, NewTransaction, PreparedImport } from '../domain/schemas'

const syntheticHash = 'c'.repeat(64)

type StructuredSchemaNode = {
  type?: string | readonly string[]
  additionalProperties?: boolean
  required?: readonly string[]
  properties?: Record<string, StructuredSchemaNode>
  items?: StructuredSchemaNode
}

type ProviderWireResult = {
  inputId: string
  merchant: { canonicalName: string | null; confidence: number } | null
  category: { categoryId: string | null; confidence: number; categoryUnknown: boolean }
  merchantType: string | null
  needsWebLookup: boolean
  reasonCode:
    | 'known_brand'
    | 'merchant_name_signal'
    | 'local_business_signal'
    | 'category_signal_only'
    | 'ambiguous'
    | 'unknown'
  sources: { title: string; url: string }[]
}

function tempDatabasePath(directory: string): string {
  return join(directory, 'sampo-ai-test.sqlite3')
}

function createTestDatabase(directory: string): SampoDatabase {
  return createDatabase({ path: tempDatabasePath(directory), useWal: false })
}

function makeTransaction(
  accountId: string,
  sourceRowIndex: number,
  description: string
): NewTransaction {
  return {
    accountId,
    sourceRowIndex,
    transactionDate: '2026-02-01',
    originalDescription: description,
    amountCents: -1250,
    transactionType: 'expense'
  }
}

function makePreparedImport(accountId: string, transactions: NewTransaction[]): PreparedImport {
  return {
    accountId,
    sourceKind: 'unknown',
    sourceFileName: 'synthetic-ai-source.txt',
    fileSha256: syntheticHash,
    transactions
  }
}

function wireResult(overrides: Partial<ProviderWireResult> = {}): ProviderWireResult {
  return {
    inputId: 'input-1',
    merchant: null,
    category: { categoryId: null, confidence: 0.2, categoryUnknown: true },
    merchantType: null,
    needsWebLookup: false,
    reasonCode: 'unknown',
    sources: [],
    ...overrides
  }
}

function assertStrictObjectSchemas(node: StructuredSchemaNode, path = '$'): void {
  const type = Array.isArray(node.type) ? node.type : [node.type]
  if (type.includes('object') || node.properties) {
    expect(node.additionalProperties, `${path}.additionalProperties`).toBe(false)
    const propertyNames = Object.keys(node.properties ?? {}).sort()
    expect([...(node.required ?? [])].sort(), `${path}.required`).toEqual(propertyNames)
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      assertStrictObjectSchemas(child, `${path}.properties.${key}`)
    }
  }
  if (node.items) assertStrictObjectSchemas(node.items, `${path}.items`)
}

describe('OpenAI classification provider', () => {
  it('tests connection with a minimal Responses request and no classification content', async () => {
    const secretStore = new MemorySecretStore()
    await secretStore.setOpenAiApiKey('test-api-key')
    let request: unknown

    await testOpenAiResponsesConnection(
      secretStore,
      () =>
        ({
          responses: {
            create: async (input: unknown) => {
              request = input
              return { output_text: 'OK' }
            }
          }
        }) as never
    )

    expect(request).toEqual({
      model: 'gpt-5.6-luna',
      input: 'Reply with OK.',
      store: false
    })
    expect(JSON.stringify(request)).not.toContain('json_schema')
    expect(JSON.stringify(request)).not.toContain('categories')
    expect(JSON.stringify(request)).not.toContain('merchant')
    expect(JSON.stringify(request)).not.toContain('SAMPLE SUPERMARKET')
    expect(JSON.stringify(request)).not.toContain('amountCents')
  })

  it('uses structured outputs, disables response storage, and sends only descriptors', async () => {
    const secretStore = new MemorySecretStore()
    await secretStore.setOpenAiApiKey('test-api-key')
    let request: unknown
    const provider = new OpenAiClassificationProvider(
      secretStore,
      () =>
        ({
          responses: {
            create: async (input: unknown) => {
              request = input
              return {
                output_text: JSON.stringify({
                  results: [wireResult()]
                })
              }
            }
          }
        }) as never
    )

    await provider.classify(
      [{ inputId: 'input-1', descriptor: 'synthetic grocery', sourceContext: 'card_purchase' }],
      { categories: [], allowWebLookup: false }
    )

    expect(request).toMatchObject({
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
      tools: undefined
    })
    expect(JSON.stringify(request)).toContain('synthetic grocery')
    expect(JSON.stringify(request)).not.toContain('amountCents')
    expect(JSON.stringify(request)).not.toContain('transactionDate')
    expect(JSON.stringify(request)).not.toContain('balanceCents')
  })

  it('generates a strict OpenAI schema recursively', () => {
    assertStrictObjectSchemas(structuredOutputSchema)
    const resultsItem = structuredOutputSchema.properties.results.items

    expect(resultsItem.required).toContain('merchant')
    expect(resultsItem.required).toContain('merchantType')
    expect(resultsItem.required).toContain('sources')
    expect(resultsItem.properties.merchant.type).toEqual(['object', 'null'])
    expect(resultsItem.properties.merchant.required).toEqual(['canonicalName', 'confidence'])
    expect(resultsItem.properties.merchant.properties.canonicalName.type).toEqual([
      'string',
      'null'
    ])
    expect(resultsItem.properties.category.required).toEqual([
      'categoryId',
      'confidence',
      'categoryUnknown'
    ])
    expect(resultsItem.properties.category.properties.categoryId.type).toEqual(['string', 'null'])
    expect(resultsItem.properties.merchantType.type).toEqual(['string', 'null'])
  })

  it.each([
    [
      'merchant canonicalName = null',
      wireResult({
        merchant: { canonicalName: null, confidence: 0.15 },
        reasonCode: 'ambiguous'
      }),
      {
        merchant: { canonicalName: undefined, confidence: 0.15 },
        category: { categoryId: undefined, confidence: 0.2, categoryUnknown: true }
      }
    ],
    [
      'category categoryId = null',
      wireResult({
        merchant: { canonicalName: 'Synthetic Merchant', confidence: 0.85 },
        category: { categoryId: null, confidence: 0.3, categoryUnknown: true },
        merchantType: 'retailer',
        reasonCode: 'merchant_name_signal'
      }),
      {
        merchant: { canonicalName: 'Synthetic Merchant', confidence: 0.85 },
        category: { categoryId: undefined, confidence: 0.3, categoryUnknown: true },
        merchantType: 'retailer'
      }
    ],
    [
      'category-only suggestion',
      wireResult({
        merchant: null,
        category: { categoryId: 'food.groceries', confidence: 0.91, categoryUnknown: false },
        reasonCode: 'category_signal_only'
      }),
      {
        merchant: undefined,
        category: { categoryId: 'food.groceries', confidence: 0.91, categoryUnknown: false }
      }
    ],
    [
      'merchant-only suggestion',
      wireResult({
        merchant: { canonicalName: 'Synthetic Merchant', confidence: 0.9 },
        category: { categoryId: null, confidence: 0.1, categoryUnknown: true },
        merchantType: 'retailer',
        reasonCode: 'merchant_name_signal'
      }),
      {
        merchant: { canonicalName: 'Synthetic Merchant', confidence: 0.9 },
        category: { categoryId: undefined, confidence: 0.1, categoryUnknown: true },
        merchantType: 'retailer'
      }
    ],
    [
      'fully unknown suggestion',
      wireResult(),
      {
        merchant: undefined,
        category: { categoryId: undefined, confidence: 0.2, categoryUnknown: true },
        merchantType: undefined
      }
    ],
    [
      'normal complete suggestion',
      wireResult({
        merchant: { canonicalName: 'Synthetic Supermarket', confidence: 0.96 },
        category: { categoryId: 'food.groceries', confidence: 0.94, categoryUnknown: false },
        merchantType: 'supermarket',
        reasonCode: 'known_brand',
        sources: [{ title: 'Synthetic source', url: 'https://example.test/source' }]
      }),
      {
        merchant: { canonicalName: 'Synthetic Supermarket', confidence: 0.96 },
        category: { categoryId: 'food.groceries', confidence: 0.94, categoryUnknown: false },
        merchantType: 'supermarket',
        sources: [{ title: 'Synthetic source', url: 'https://example.test/source' }]
      }
    ]
  ])('accepts %s', async (_label, result, expected) => {
    const secretStore = new MemorySecretStore()
    await secretStore.setOpenAiApiKey('test-api-key')
    const provider = new OpenAiClassificationProvider(
      secretStore,
      () =>
        ({
          responses: {
            create: async () => ({
              output_text: JSON.stringify({ results: [result] })
            })
          }
        }) as never
    )

    const [classification] = await provider.classify(
      [{ inputId: 'input-1', descriptor: 'synthetic grocery', sourceContext: 'card_purchase' }],
      { categories: [], allowWebLookup: false }
    )

    expect(classification).toMatchObject(expected)
  })

  it('uses web search only when explicitly allowed', async () => {
    const secretStore = new MemorySecretStore()
    await secretStore.setOpenAiApiKey('test-api-key')
    let request: unknown
    const provider = new OpenAiClassificationProvider(
      secretStore,
      () =>
        ({
          responses: {
            create: async (input: unknown) => {
              request = input
              return {
                output_text: JSON.stringify({
                  results: [wireResult({ needsWebLookup: true, reasonCode: 'ambiguous' })]
                })
              }
            }
          }
        }) as never
    )

    await provider.classify(
      [{ inputId: 'input-1', descriptor: 'synthetic local shop', sourceContext: 'card_purchase' }],
      { categories: [], allowWebLookup: true }
    )

    expect(request).toMatchObject({
      tools: [{ type: 'web_search_preview', search_context_size: 'low' }]
    })
  })

  it('rejects malformed structured output', async () => {
    const secretStore = new MemorySecretStore()
    await secretStore.setOpenAiApiKey('test-api-key')
    const provider = new OpenAiClassificationProvider(
      secretStore,
      () =>
        ({
          responses: {
            create: async () => ({
              output_text: JSON.stringify({ results: [{ inputId: 'input-1' }] })
            })
          }
        }) as never
    )

    await expect(
      provider.classify(
        [{ inputId: 'input-1', descriptor: 'synthetic grocery', sourceContext: 'card_purchase' }],
        { categories: [], allowWebLookup: false }
      )
    ).rejects.toBeInstanceOf(AiInvalidResponseError)
  })

  it('maps official OpenAI SDK error classes without collapsing them into network errors', () => {
    expect(
      mapProviderError(
        new OpenAI.BadRequestError(
          400,
          { message: 'bad request', param: 'model' },
          'bad request',
          new Headers()
        )
      ).code
    ).toBe('AI_INVALID_REQUEST')
    expect(
      mapProviderError(
        new OpenAI.AuthenticationError(401, { message: 'bad key' }, 'bad key', new Headers())
      ).code
    ).toBe('AI_INVALID_KEY')
    expect(
      mapProviderError(
        new OpenAI.PermissionDeniedError(
          403,
          { message: 'permission denied' },
          'permission denied',
          new Headers()
        )
      ).code
    ).toBe('AI_PERMISSION_ERROR')
    expect(
      mapProviderError(
        new OpenAI.NotFoundError(404, { message: 'model missing' }, 'model missing', new Headers())
      ).code
    ).toBe('AI_MODEL_NOT_FOUND')
    expect(
      mapProviderError(
        new OpenAI.UnprocessableEntityError(
          422,
          { message: 'unprocessable request' },
          'unprocessable request',
          new Headers()
        )
      ).code
    ).toBe('AI_UNPROCESSABLE_REQUEST')
    expect(
      mapProviderError(
        new OpenAI.RateLimitError(
          429,
          { message: 'quota', code: 'insufficient_quota' },
          'quota',
          new Headers()
        )
      ).code
    ).toBe('AI_QUOTA_EXCEEDED')
    expect(mapProviderError(new OpenAI.APIConnectionTimeoutError()).code).toBe('AI_TIMEOUT')
    expect(
      mapProviderError(
        new OpenAI.APIConnectionError({
          message: 'Connection error.',
          cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.openai.com'), {
            code: 'ENOTFOUND'
          })
        })
      ).code
    ).toBe('AI_NETWORK_ERROR')
    expect(mapProviderError(new TypeError('local coding error')).code).toBe('AI_SERVICE_ERROR')
  })

  it('extracts only safe diagnostic metadata from OpenAI connection errors', () => {
    const error = new OpenAI.APIConnectionError({
      message: 'Connection error.',
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.openai.com'), {
        code: 'ENOTFOUND'
      })
    })

    expect(openAiErrorMetadata(error)).toMatchObject({
      constructorName: 'APIConnectionError',
      message: 'Connection error.',
      causeCode: 'ENOTFOUND',
      causeMessage: 'getaddrinfo ENOTFOUND api.openai.com'
    })
    expect(JSON.stringify(openAiErrorMetadata(error))).not.toContain('Authorization')
    expect(JSON.stringify(openAiErrorMetadata(error))).not.toContain('sk-')
  })
})

describe('smart classification service', () => {
  let directory: string
  let database: SampoDatabase
  let connection: Database
  let providerResults: Awaited<ReturnType<AiClassificationProvider['classify']>>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-ai-db-'))
    database = createTestDatabase(directory)
    connection = database.connection
    providerResults = []
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('groups duplicate descriptors and creates reviewable pending suggestions', async () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Grocery Store',
      'Synthetic Grocery Store'
    ])
    new AiSettingsRepository(connection).update({ aiEnabled: true })
    providerResults = [
      {
        inputId: 'item-1',
        merchant: { canonicalName: 'Synthetic Grocery', confidence: 0.95 },
        category: { categoryId, confidence: 0.92, categoryUnknown: false },
        needsWebLookup: false,
        reasonCode: 'merchant_name_signal'
      }
    ]
    const service = new SmartClassificationService(connection, {
      classify: async () => providerResults
    })

    const summary = await service.classifyTransactions(transactionIds)
    const suggestions = new AiSuggestionRepository(connection).listPending()

    expect(summary).toMatchObject({
      eligibleTransactionCount: 2,
      uniqueDescriptionCount: 1,
      suggestionsCreated: 2,
      highConfidenceCategories: 2
    })
    expect(suggestions).toHaveLength(2)
    expect(suggestions.every((suggestion) => suggestion.status === 'pending')).toBe(true)
  })

  it('preserves manual classifications and rejects partial provider responses', async () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Manual Store',
      'Synthetic Unknown Store'
    ])
    new AiSettingsRepository(connection).update({ aiEnabled: true })
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      categoryId,
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    const service = new SmartClassificationService(connection, {
      classify: async () => []
    })

    await expect(service.classifyTransactions(transactionIds)).rejects.toBeInstanceOf(
      AiPartialResponseError
    )
    expect(new AiSuggestionRepository(connection).listPending()).toHaveLength(0)
  })

  it('accepts category-only suggestions without creating merchants', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, ['Synthetic Groceries'])
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    const accepted = service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: false
    })
    const classification = new TransactionClassificationRepository(connection).findByTransactionId(
      transactionIds[0]
    )

    expect(accepted.status).toBe('accepted')
    expect(classification).toMatchObject({
      categoryId,
      merchantId: undefined,
      classificationSource: 'ai',
      classificationStatus: 'confirmed'
    })
    expect(countRows(connection, 'merchants')).toBe(0)
  })

  it('accepts merchant-only suggestions without requiring a category', () => {
    const { transactionIds } = seedTransactions(connection, ['Synthetic Merchant Only'])
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedMerchantName: 'Synthetic Merchant'
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    const accepted = service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: false,
      acceptMerchant: true
    })
    const classification = new TransactionClassificationRepository(connection).findByTransactionId(
      transactionIds[0]
    )

    expect(accepted.status).toBe('accepted')
    expect(classification?.merchantId).toBeTruthy()
    expect(classification?.categoryId).toBeUndefined()
    expect(classification?.classificationSource).toBe('ai')
  })

  it('accepts both category and merchant when both values are available', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, ['Synthetic Both'])
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId,
      suggestedMerchantName: 'Synthetic Both Merchant'
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    const accepted = service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: true
    })
    const classification = new TransactionClassificationRepository(connection).findByTransactionId(
      transactionIds[0]
    )

    expect(accepted.status).toBe('accepted')
    expect(classification?.categoryId).toBe(categoryId)
    expect(classification?.merchantId).toBeTruthy()
    expect(classification?.classificationSource).toBe('ai')
  })

  it('preserves existing merchant when accepting only category', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Existing Merchant'
    ])
    const merchant = new MerchantRepository(connection).create({ name: 'Existing Merchant' })
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      merchantId: merchant.id,
      classificationSource: 'ai',
      classificationStatus: 'confirmed'
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: false
    })

    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
    ).toMatchObject({ merchantId: merchant.id, categoryId })
  })

  it('preserves existing category when accepting only merchant', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Existing Category'
    ])
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      categoryId,
      classificationSource: 'ai',
      classificationStatus: 'confirmed'
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedMerchantName: 'Synthetic New Merchant'
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: false,
      acceptMerchant: true
    })

    const classification = new TransactionClassificationRepository(connection).findByTransactionId(
      transactionIds[0]
    )
    expect(classification?.categoryId).toBe(categoryId)
    expect(classification?.merchantId).toBeTruthy()
  })

  it('throws a typed safe error for missing suggestions', () => {
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    expect(() =>
      service.acceptSuggestion({
        suggestionId: randomUUID(),
        acceptCategory: true,
        acceptMerchant: false
      })
    ).toThrow(AiSuggestionNotFoundError)
  })

  it('does not overwrite existing manual classifications', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, ['Synthetic Manual'])
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      categoryId,
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedMerchantName: 'Synthetic Manual Merchant'
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    expect(() =>
      service.acceptSuggestion({
        suggestionId: suggestion.id,
        acceptCategory: false,
        acceptMerchant: true
      })
    ).toThrow(ManualClassificationPreservedError)
    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
    ).toMatchObject({ categoryId, classificationSource: 'manual' })
    expect(new AiSuggestionRepository(connection).findById(suggestion.id).status).toBe('pending')
  })

  it('treats repeated accept of an accepted suggestion as idempotent', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, ['Synthetic Repeated'])
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: false
    })
    const acceptedAgain = service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: false
    })

    expect(acceptedAgain.status).toBe('accepted')
    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
        ?.categoryId
    ).toBe(categoryId)
  })

  it('rolls back classification and suggestion status when alias creation fails', () => {
    const { transactionIds } = seedTransactions(connection, ['Synthetic Alias Conflict'])
    const merchants = new MerchantRepository(connection)
    const existingMerchant = merchants.create({ name: 'Existing Alias Merchant' })
    new MerchantAliasRepository(connection).create({
      merchantId: existingMerchant.id,
      matchKind: 'exact',
      pattern: 'Synthetic Alias Conflict',
      priority: 0
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedMerchantName: 'New Alias Merchant'
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    expect(() =>
      service.acceptSuggestion({
        suggestionId: suggestion.id,
        acceptCategory: false,
        acceptMerchant: true
      })
    ).toThrow(AliasConflictError)

    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
    ).toBeUndefined()
    expect(new AiSuggestionRepository(connection).findById(suggestion.id).status).toBe('pending')
    expect(merchants.list({ search: 'New Alias Merchant' })).toHaveLength(0)
  })
})

function seedTransactions(
  database: Database,
  descriptions: string[]
): { transactionIds: string[]; categoryId: string } {
  const accounts = new AccountRepository(database)
  const account = accounts.create({
    name: 'Synthetic AI account',
    kind: 'current',
    institution: 'Synthetic institution'
  })
  const result = new ImportService(database).commitPreparedImport(
    makePreparedImport(
      account.id,
      descriptions.map((description, index) => makeTransaction(account.id, index, description))
    )
  )
  const categoryId = database
    .prepare("SELECT id FROM categories WHERE key = 'food.groceries'")
    .pluck()
    .get() as string
  return {
    transactionIds: new TransactionRepository(database)
      .listForImportBatch(result.batch.id)
      .map((transaction) => transaction.id),
    categoryId
  }
}

function createSuggestion(
  database: Database,
  input: {
    transactionId: string
    suggestedMerchantName?: string
    suggestedCategoryId?: string
  }
): AiClassificationSuggestion {
  return new AiSuggestionRepository(database).create({
    transactionId: input.transactionId,
    provider: 'openai',
    model: 'gpt-5.6-luna',
    suggestedMerchantName: input.suggestedMerchantName,
    suggestedCategoryId: input.suggestedCategoryId,
    merchantConfidence: input.suggestedMerchantName ? 900 : 0,
    categoryConfidence: input.suggestedCategoryId ? 900 : 0,
    needsWebLookup: false,
    usedWebSearch: false,
    reasonCode: input.suggestedMerchantName ? 'merchant_name_signal' : 'category_signal_only'
  })
}

function countRows(database: Database, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
    .count
}
