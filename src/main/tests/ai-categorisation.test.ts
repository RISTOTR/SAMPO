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
  CategoryRepository,
  MerchantAliasRepository,
  MerchantRepository,
  TransactionClassificationRepository
} from '../storage/categorisation'
import { SmartClassificationService } from '../ai/smart-classification-service'
import { ApplicationWorkflow } from '../workflows/application-workflow'
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

  it('requires web search for targeted merchant enrichment', async () => {
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
                  results: [
                    wireResult({
                      merchant: { canonicalName: 'Synthetic Web Merchant', confidence: 0.91 },
                      needsWebLookup: false,
                      reasonCode: 'local_business_signal',
                      sources: [
                        { title: 'Synthetic merchant source', url: 'https://example.test/merchant' }
                      ]
                    })
                  ]
                })
              }
            }
          }
        }) as never
    )

    await provider.classify(
      [{ inputId: 'input-1', descriptor: 'synthetic local shop', sourceContext: 'card_purchase' }],
      { categories: [], allowWebLookup: true, requireWebLookup: true }
    )

    expect(request).toMatchObject({
      tools: [{ type: 'web_search_preview', search_context_size: 'medium' }],
      tool_choice: 'required'
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

  it.each(['manual', 'ai'] as const)(
    'learns confirmed %s fields across monthly imports, reopen and pending promotion',
    (source) => {
      const { transactionIds, categoryId } = seedTransactions(connection, [
        'Synthetic Monthly Learning'
      ])
      let workflow = createWorkflow(connection)
      if (source === 'manual') {
        workflow.saveManualClassification({
          transactionId: transactionIds[0],
          merchantName: 'Synthetic Learned Merchant',
          categoryId
        })
      } else {
        const suggestion = createSuggestion(connection, {
          transactionId: transactionIds[0],
          suggestedMerchantName: 'Synthetic Learned Merchant',
          suggestedCategoryId: categoryId
        })
        workflow.acceptAiSuggestion({
          suggestionId: suggestion.id,
          acceptMerchant: true,
          acceptCategory: true
        })
      }
      const original = new TransactionRepository(connection).findById(transactionIds[0])
      const merchantId = workflow.getClassification(original.id).merchantId
      database.close()
      database = createTestDatabase(directory)
      connection = database.connection
      workflow = createWorkflow(connection)
      const monthly = {
        ...makeTransaction(original.accountId, 0, '  SYNTHETIC  Monthly Learning  '),
        transactionDate: '2026-03-01',
        isPending: true
      }
      const imported = new ImportService(connection).commitPreparedImport({
        ...makePreparedImport(original.accountId, [monthly]),
        fileSha256: 'd'.repeat(64)
      })
      const id = imported.transactions[0]!.id
      const assertDetected = (): void => {
        const proposal = workflow.getClassification(id)
        expect(proposal).toMatchObject({
          merchantId,
          categoryId,
          merchantDisplay: { source: 'detected' },
          categoryDisplay: { source: 'detected' }
        })
        expect(
          workflow.listTransactions({}).items.find((row) => row.id === id)?.classification
        ).toMatchObject({
          merchantId,
          categoryId,
          merchantDisplay: { source: 'detected' },
          categoryDisplay: { source: 'detected' }
        })
      }
      assertDetected()
      const completed = new ImportService(connection).commitPreparedImport({
        ...makePreparedImport(original.accountId, [{ ...monthly, isPending: false }]),
        fileSha256: 'e'.repeat(64)
      })
      expect(completed.transactions).toHaveLength(0)
      expect(new TransactionRepository(connection).findById(id).isPending).toBe(false)
      assertDetected()
      expect(
        new TransactionClassificationRepository(connection).findByTransactionId(original.id)
      ).toMatchObject({
        merchantSource: source,
        categorySource: source,
        classificationStatus: 'confirmed'
      })
    }
  )

  it('fills a missing field on a confirmed partial classification without replacing the confirmed field', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Partial Learning',
      'Synthetic Partial Learning'
    ])
    const workflow = createWorkflow(connection)
    workflow.saveManualClassification({
      transactionId: transactionIds[0],
      merchantName: 'Synthetic Learned Merchant',
      categoryId
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[1]!,
      suggestedCategoryId: categoryId
    })
    workflow.acceptAiSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: false
    })
    expect(workflow.getClassification(transactionIds[1]!)).toMatchObject({
      merchantName: 'Synthetic Learned Merchant',
      categoryId,
      merchantDisplay: { source: 'detected' },
      categoryDisplay: { source: 'authoritative' }
    })
  })

  it('preserves confirmed AI provenance when a pending transaction is promoted', () => {
    const account = new AccountRepository(connection).create({
      name: 'Synthetic Pending Account',
      kind: 'credit_card'
    })
    const movement = {
      ...makeTransaction(account.id, 0, 'Synthetic Pending Confirmed'),
      isPending: true
    }
    const imported = new ImportService(connection).commitPreparedImport(
      makePreparedImport(account.id, [movement])
    )
    const id = imported.transactions[0]!.id
    const categoryId = new CategoryRepository(connection)
      .list()
      .find((c) => c.key === 'food.groceries')!.id
    const suggestion = createSuggestion(connection, {
      transactionId: id,
      suggestedMerchantName: 'Synthetic Confirmed Merchant',
      suggestedCategoryId: categoryId
    })
    createWorkflow(connection).acceptAiSuggestion({
      suggestionId: suggestion.id,
      acceptMerchant: true,
      acceptCategory: true
    })
    const repository = new TransactionClassificationRepository(connection)
    const before = repository.findByTransactionId(id)
    new ImportService(connection).commitPreparedImport({
      ...makePreparedImport(account.id, [{ ...movement, isPending: false }]),
      fileSha256: 'f'.repeat(64)
    })
    expect(repository.findByTransactionId(id)).toEqual(before)
    expect(new TransactionRepository(connection).findById(id).isPending).toBe(false)
  })

  it('keeps pending AI out of learning and prefers manual examples over accepted AI examples', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Learning Precedence',
      'Synthetic Learning Precedence',
      'Synthetic Learning Precedence'
    ])
    const workflow = createWorkflow(connection)
    const otherCategory = new CategoryRepository(connection)
      .list()
      .find((c) => c.key === 'housing.rent')!.id
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0]!,
      suggestedMerchantName: 'Synthetic AI Merchant',
      suggestedCategoryId: otherCategory
    })
    expect(workflow.getClassification(transactionIds[2]!)).toMatchObject({ source: 'unclassified' })
    expect(workflow.getClassification(transactionIds[2]!).categoryId).toBeUndefined()
    workflow.acceptAiSuggestion({
      suggestionId: suggestion.id,
      acceptMerchant: true,
      acceptCategory: true
    })
    expect(workflow.getClassification(transactionIds[2]!)).toMatchObject({
      merchantName: 'Synthetic AI Merchant',
      categoryId: otherCategory
    })
    workflow.saveManualClassification({
      transactionId: transactionIds[1]!,
      merchantName: 'Synthetic Manual Merchant',
      categoryId
    })
    expect(workflow.getClassification(transactionIds[2]!)).toMatchObject({
      merchantName: 'Synthetic Manual Merchant',
      categoryId,
      status: 'needs_review'
    })
  })

  it('keeps conflicting manual examples ambiguous rather than selecting a winner', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Conflicting Learning',
      'Synthetic Conflicting Learning',
      'Synthetic Conflicting Learning'
    ])
    const otherCategory = new CategoryRepository(connection)
      .list()
      .find((c) => c.key === 'housing.rent')!.id
    const workflow = createWorkflow(connection)
    workflow.saveManualClassification({ transactionId: transactionIds[0]!, categoryId })
    workflow.saveManualClassification({
      transactionId: transactionIds[1]!,
      categoryId: otherCategory
    })
    expect(workflow.getClassification(transactionIds[2]!)).toMatchObject({
      status: 'ambiguous',
      conflicts: [{ field: 'category', reason: 'conflicting_manual_examples' }]
    })
  })

  it('keeps matching AI fields actionable until an imported detection is confirmed', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Detection Delta'
    ])
    const merchant = new MerchantRepository(connection).create({
      name: 'Synthetic Detected Merchant'
    })
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0]!,
      merchantId: merchant.id,
      categoryId,
      classificationSource: 'rule',
      classificationStatus: 'needs_review'
    })
    createSuggestion(connection, {
      transactionId: transactionIds[0]!,
      suggestedMerchantName: merchant.name,
      suggestedCategoryId: categoryId
    })
    const workflow = createWorkflow(connection)
    expect(workflow.listAiSuggestions({})[0]).toMatchObject({
      canAcceptMerchant: true,
      canAcceptCategory: true
    })
    workflow.saveManualClassification({
      transactionId: transactionIds[0]!,
      merchantId: merchant.id,
      categoryId
    })
    expect(workflow.listAiSuggestions({})).toHaveLength(0)
  })

  it('skips resolved learned classifications but preserves reviewable exact-description detections', async () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Learned Review',
      'Synthetic Learned Review'
    ])
    const workflow = createWorkflow(connection)
    workflow.saveManualClassification({
      transactionId: transactionIds[0],
      merchantName: 'Synthetic Learned Merchant',
      categoryId
    })
    const detected = workflow.getClassification(transactionIds[1]!)
    expect(detected.status).toBe('needs_review')
    expect(detected.merchantId).toBeTruthy()
    expect(detected.categoryId).toBe(categoryId)
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[1],
      merchantId: detected.merchantId,
      categoryId,
      classificationSource: 'rule',
      classificationStatus: 'confirmed'
    })
    createSuggestion(connection, {
      transactionId: transactionIds[1],
      suggestedMerchantName: 'Synthetic Unnecessary Alternative',
      suggestedCategoryId: categoryId
    })
    new AiSettingsRepository(connection).update({ aiEnabled: true })
    let calls = 0
    const service = new SmartClassificationService(connection, {
      classify: async () => {
        calls += 1
        return []
      }
    })
    expect((await service.classifyTransactions(transactionIds)).suggestionsCreated).toBe(0)
    expect(calls).toBe(0)
    expect(workflow.listAiSuggestions()).toEqual([])
  })

  it('generates only unresolved fields and ignores confirmation during a provider request', async () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Inflight Review'
    ])
    const workflow = createWorkflow(connection)
    workflow.saveManualClassification({
      transactionId: transactionIds[0],
      merchantName: 'Synthetic Final'
    })
    new AiSettingsRepository(connection).update({ aiEnabled: true })
    let confirmDuringRequest = false
    let calls = 0
    const service = new SmartClassificationService(connection, {
      classify: async (inputs) => {
        calls += 1
        if (confirmDuringRequest)
          workflow.saveManualClassification({
            transactionId: transactionIds[0],
            merchantName: 'Synthetic Final',
            categoryId
          })
        return inputs.map((input) => ({
          inputId: input.inputId,
          merchant: { canonicalName: 'Synthetic AI', confidence: 0.9 },
          category: { categoryId, confidence: 0.9, categoryUnknown: false },
          needsWebLookup: false,
          reasonCode: 'known_brand' as const
        }))
      }
    })
    await service.classifyTransactions(transactionIds)
    expect(workflow.listAiSuggestions()).toEqual([
      expect.objectContaining({
        canAcceptMerchant: false,
        canAcceptCategory: true,
        suggestedMerchantName: undefined
      })
    ])
    confirmDuringRequest = true
    expect((await service.classifyTransactions(transactionIds)).suggestionsCreated).toBe(0)
    expect(calls).toBe(2)
    expect(workflow.listAiSuggestions()).toEqual([])
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

  it('runs targeted required web enrichment for unresolved merchants and preserves the first-pass category', async () => {
    const { transactionIds, categoryId } = seedTransactions(connection, ['EXPJUANDEAUSTRIA'])
    new AiSettingsRepository(connection).update({
      aiEnabled: true,
      allowWebLookup: true,
      country: 'Spain',
      city: 'Madrid'
    })
    const contexts: Parameters<AiClassificationProvider['classify']>[1][] = []
    const service = new SmartClassificationService(connection, {
      classify: async (items, context) => {
        contexts.push(context)
        if (!context.allowWebLookup) {
          return [
            {
              inputId: items[0]!.inputId,
              merchant: undefined,
              category: { categoryId, confidence: 0.78, categoryUnknown: false },
              merchantType: undefined,
              needsWebLookup: true,
              reasonCode: 'category_signal_only'
            }
          ]
        }

        expect(context.requireWebLookup).toBe(true)
        return [
          {
            inputId: items[0]!.inputId,
            merchant: { canonicalName: 'Carrefour Express', confidence: 0.89 },
            category: { categoryId: undefined, confidence: 0.2, categoryUnknown: true },
            merchantType: 'supermarket',
            needsWebLookup: false,
            reasonCode: 'local_business_signal',
            sources: [
              { title: 'Carrefour Express result', url: 'https://example.test/carrefour-express' }
            ]
          }
        ]
      }
    })

    const summary = await service.classifyTransactions(transactionIds)
    const [suggestion] = new AiSuggestionRepository(connection).listPending()

    expect(contexts).toHaveLength(2)
    expect(contexts[0]).toMatchObject({ allowWebLookup: false })
    expect(contexts[1]).toMatchObject({ allowWebLookup: true, requireWebLookup: true })
    expect(suggestion).toMatchObject({
      transactionId: transactionIds[0],
      suggestedMerchantName: 'Carrefour Express',
      suggestedCategoryId: categoryId,
      usedWebSearch: true,
      needsWebLookup: false,
      reasonCode: 'local_business_signal'
    })
    expect(summary).toMatchObject({
      suggestionsCreated: 1,
      canonicalMerchantsSuggested: 1,
      webLookupsPerformed: 1
    })
  })

  it('manually classifies selected transactions when automatic import classification is disabled', async () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Manual AI Classify'
    ])
    new AiSettingsRepository(connection).update({
      aiEnabled: true,
      classifyNewImports: false
    })
    let providerReached = false
    const service = new SmartClassificationService(connection, {
      classify: async (items) => {
        providerReached = true
        expect(items.map((item) => item.inputId)).toEqual(['item-1'])
        return [
          {
            inputId: 'item-1',
            merchant: undefined,
            category: { categoryId, confidence: 0.93, categoryUnknown: false },
            merchantType: undefined,
            needsWebLookup: false,
            reasonCode: 'category_signal_only'
          }
        ]
      }
    })

    const summary = await service.classifyTransactions(transactionIds)
    const suggestions = new AiSuggestionRepository(connection).listPending()

    expect(providerReached).toBe(true)
    expect(summary).toMatchObject({
      eligibleTransactionCount: 1,
      suggestionsCreated: 1,
      skippedDeterministicOrManual: 0
    })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId,
      status: 'pending'
    })
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

    expect(accepted.suggestion.status).toBe('accepted')
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

    expect(accepted.suggestion.status).toBe('accepted')
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

    expect(accepted.suggestion.status).toBe('accepted')
    expect(classification?.categoryId).toBe(categoryId)
    expect(classification?.merchantId).toBeTruthy()
    expect(classification?.classificationSource).toBe('ai')
  })

  it('keeps a two-field suggestion pending after merchant-only acceptance', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, ['Synthetic Partial AI'])
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId,
      suggestedMerchantName: 'Synthetic Partial Merchant'
    })
    const workflow = createWorkflow(connection)

    const merchantReview = workflow.acceptAiSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: false,
      acceptMerchant: true
    })
    const afterMerchant = workflow.listAiSuggestions({
      transactionQuery: {
        search: 'partial',
        confirmationFilter: 'needs_confirmation',
        sortBy: 'transactionDate',
        sortDirection: 'desc'
      }
    })

    expect(merchantReview).toMatchObject({
      merchant: 'accepted',
      category: 'not_suggested',
      suggestionStatus: 'pending'
    })
    expect(afterMerchant).toEqual([
      expect.objectContaining({
        id: suggestion.id,
        suggestedMerchantName: undefined,
        suggestedCategoryId: categoryId,
        canAcceptMerchant: false,
        canAcceptCategory: true,
        status: 'pending'
      })
    ])
    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
    ).toMatchObject({
      merchantId: expect.any(String),
      categoryId: undefined,
      classificationStatus: 'confirmed'
    })

    const categoryReview = workflow.acceptAiSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: false
    })

    expect(categoryReview).toMatchObject({
      category: 'accepted',
      merchant: 'not_suggested',
      suggestionStatus: 'accepted'
    })
    expect(new AiSuggestionRepository(connection).findById(suggestion.id).status).toBe('accepted')
    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
    ).toMatchObject({
      merchantId: expect.any(String),
      categoryId,
      classificationStatus: 'confirmed'
    })
  })

  it.each(['merchant', 'category', 'both'] as const)(
    'resolves manual %s fields independently and keeps them resolved after restart',
    (field) => {
      const { transactionIds, categoryId } = seedTransactions(connection, [
        'Synthetic Field Review'
      ])
      const differentCategory = new CategoryRepository(connection).create({
        name: 'Synthetic Alternative'
      })
      const suggestion = createSuggestion(connection, {
        transactionId: transactionIds[0],
        suggestedMerchantName: 'Synthetic AI Alternative',
        suggestedCategoryId: differentCategory.id
      })
      const workflow = createWorkflow(connection)
      workflow.saveManualClassification({
        transactionId: transactionIds[0],
        merchantName: field !== 'category' ? 'Synthetic Manual Decision' : undefined,
        categoryId: field !== 'merchant' ? categoryId : undefined
      })
      const verify = (): void => {
        const active = createWorkflow(connection).listAiSuggestions()
        if (field === 'both') {
          expect(active).toEqual([])
          expect(new AiSuggestionRepository(connection).findById(suggestion.id).status).toBe(
            'superseded'
          )
        } else {
          expect(active).toEqual([
            expect.objectContaining({
              canAcceptMerchant: field === 'category',
              canAcceptCategory: field === 'merchant',
              suggestedMerchantName: field === 'category' ? 'Synthetic AI Alternative' : undefined,
              suggestedCategoryId: field === 'merchant' ? differentCategory.id : undefined
            })
          ])
          expect(new AiSuggestionRepository(connection).findById(suggestion.id).status).toBe(
            'pending'
          )
        }
      }
      verify()
      database.close()
      database = createTestDatabase(directory)
      connection = database.connection
      verify()
      // A stale client can still submit an old suggestion: the backend must protect decisions.
      const stale = createSuggestion(connection, {
        transactionId: transactionIds[0],
        suggestedMerchantName: 'Synthetic AI Alternative',
        suggestedCategoryId: differentCategory.id
      })
      const review = createWorkflow(connection).acceptAiSuggestion({
        suggestionId: stale.id,
        acceptMerchant: true,
        acceptCategory: true
      })
      expect(review).toMatchObject({
        merchant: field === 'category' ? 'accepted' : 'preserved_manual',
        category: field === 'merchant' ? 'accepted' : 'preserved_manual',
        suggestionStatus: 'superseded'
      })
      const saved = new TransactionClassificationRepository(connection).findByTransactionId(
        transactionIds[0]
      )
      if (field !== 'merchant') expect(saved?.categoryId).toBe(categoryId)
      if (field !== 'category')
        expect(new MerchantRepository(connection).findById(saved!.merchantId!).name).toBe(
          'Synthetic Manual Decision'
        )
      expect(createWorkflow(connection).listAiSuggestions()).toEqual([])
    }
  )

  it('supersedes suggestions for every matching row in bulk manual confirmation', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Bulk Review',
      'Synthetic Bulk Review',
      'Synthetic Bulk Review'
    ])
    const suggestions = transactionIds.map((transactionId) =>
      createSuggestion(connection, {
        transactionId,
        suggestedMerchantName: 'Synthetic Alternative',
        suggestedCategoryId: categoryId
      })
    )
    const workflow = createWorkflow(connection)
    workflow.saveManualClassificationAndConfirmMatches({
      transactionId: transactionIds[0],
      merchantName: 'Synthetic Final Merchant',
      categoryId
    })
    expect(workflow.listAiSuggestions()).toEqual([])
    for (const suggestion of suggestions) {
      expect(new AiSuggestionRepository(connection).findById(suggestion.id).status).toBe(
        'superseded'
      )
    }
  })

  it('filters differing historical suggestions and preserves their historical values', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Historical Review'
    ])
    const workflow = createWorkflow(connection)
    workflow.saveManualClassification({
      transactionId: transactionIds[0],
      merchantName: 'Synthetic Final',
      categoryId
    })
    const alternative = new CategoryRepository(connection).create({
      name: 'Synthetic Historical Category'
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedMerchantName: 'Synthetic Old AI',
      suggestedCategoryId: alternative.id
    })
    expect(workflow.listAiSuggestions()).toEqual([])
    expect(new AiSuggestionRepository(connection).findById(suggestion.id)).toMatchObject({
      status: 'superseded',
      suggestedMerchantName: 'Synthetic Old AI',
      suggestedCategoryId: alternative.id
    })
  })

  it('omits non-actionable AI suggestions that already match the current classification', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, ['Synthetic Matching AI'])
    const merchant = new MerchantRepository(connection).create({
      name: 'Synthetic Matched Merchant'
    })
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      merchantId: merchant.id,
      merchantSource: 'manual',
      categoryId,
      categorySource: 'manual',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId,
      suggestedMerchantName: 'Synthetic Matched Merchant'
    })

    expect(createWorkflow(connection).listAiSuggestions()).toEqual([])
  })

  it('returns only a category delta when the AI merchant already matches', () => {
    const { transactionIds } = seedTransactions(connection, ['Synthetic Category Delta'])
    const merchant = new MerchantRepository(connection).create({ name: 'Synthetic Same Merchant' })
    const category = new CategoryRepository(connection).create({ name: 'Synthetic Delta Category' })
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      merchantId: merchant.id,
      merchantSource: 'manual',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: category.id,
      suggestedMerchantName: 'Synthetic Same Merchant'
    })

    expect(createWorkflow(connection).listAiSuggestions()).toEqual([
      expect.objectContaining({
        id: suggestion.id,
        currentMerchantName: undefined,
        suggestedMerchantName: undefined,
        suggestedCategoryId: category.id,
        suggestedCategoryPath: ['Synthetic Delta Category'],
        currentCategoryPath: undefined,
        canAcceptMerchant: false,
        canAcceptCategory: true
      })
    ])
  })

  it('returns only a merchant delta when the AI category already matches', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Merchant Delta'
    ])
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      categoryId,
      categorySource: 'manual',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId,
      suggestedMerchantName: 'Synthetic Different Merchant'
    })

    expect(createWorkflow(connection).listAiSuggestions()).toEqual([
      expect.objectContaining({
        id: suggestion.id,
        currentMerchantName: undefined,
        suggestedMerchantName: 'Synthetic Different Merchant',
        suggestedCategoryId: undefined,
        suggestedCategoryPath: undefined,
        currentCategoryPath: undefined,
        canAcceptMerchant: true,
        canAcceptCategory: false
      })
    ])
  })

  it('accepts the second same-merchant suggestion by its own suggestion id', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Same Merchant One',
      'Synthetic Same Merchant Two'
    ])
    const first = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId,
      suggestedMerchantName: 'Synthetic Shared Merchant'
    })
    const second = createSuggestion(connection, {
      transactionId: transactionIds[1],
      suggestedCategoryId: categoryId,
      suggestedMerchantName: 'Synthetic Shared Merchant'
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    const accepted = service.acceptSuggestion({
      suggestionId: second.id,
      acceptCategory: true,
      acceptMerchant: false
    })

    expect(accepted.suggestion.id).toBe(second.id)
    expect(new AiSuggestionRepository(connection).findById(first.id).status).toBe('pending')
    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
    ).toBeUndefined()
    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[1])
    ).toMatchObject({ categoryId, classificationSource: 'ai' })
  })

  it('filters pending suggestions by matching transaction ids without current-page pagination', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Filtered One',
      'Synthetic Filtered Two'
    ])
    createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedMerchantName: 'Synthetic Unresolved Merchant',
      suggestedCategoryId: categoryId
    })
    createSuggestion(connection, {
      transactionId: transactionIds[1],
      suggestedCategoryId: categoryId
    })
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      categoryId,
      classificationSource: 'ai',
      classificationStatus: 'confirmed'
    })
    const transactions = new TransactionRepository(connection)
    const filteredIds = transactions.listFilteredIds({
      categoryId,
      sortBy: 'transactionDate',
      sortDirection: 'desc'
    })
    const firstPage = transactions.listPage({
      sortBy: 'transactionDate',
      sortDirection: 'desc',
      limit: 1,
      offset: 0
    })

    expect(firstPage.items).toHaveLength(1)
    expect(filteredIds).toEqual([transactionIds[0]])
    expect(new AiSuggestionRepository(connection).listPendingForTransactions(filteredIds)).toEqual([
      expect.objectContaining({ transactionId: transactionIds[0] })
    ])
  })

  it('reviews a filtered suggestion through the workflow using the persisted suggestion id', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Workflow Filtered'
    ])
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId
    })
    const workflow = createWorkflow(connection)
    const [visibleSuggestion] = workflow.listAiSuggestions({
      transactionQuery: { unclassifiedOnly: true, sortBy: 'transactionDate', sortDirection: 'desc' }
    })

    expect(visibleSuggestion?.id).toBe(suggestion.id)

    workflow.acceptAiSuggestion({
      suggestionId: visibleSuggestion!.id,
      acceptCategory: true,
      acceptMerchant: false
    })

    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
    ).toMatchObject({ categoryId, classificationSource: 'ai' })
    expect(new AiSuggestionRepository(connection).findById(suggestion.id).status).toBe('accepted')
  })

  it('rejects a filtered suggestion through the workflow using the persisted suggestion id', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Workflow Reject'
    ])
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId
    })
    const workflow = createWorkflow(connection)
    const [visibleSuggestion] = workflow.listAiSuggestions({
      transactionQuery: { unclassifiedOnly: true, sortBy: 'transactionDate', sortDirection: 'desc' }
    })

    expect(visibleSuggestion?.id).toBe(suggestion.id)

    workflow.rejectAiSuggestion({ suggestionId: visibleSuggestion!.id })

    expect(new AiSuggestionRepository(connection).findById(suggestion.id).status).toBe('rejected')
  })

  it('exposes detected merchant without treating it as authoritative in the editor payload', () => {
    const { transactionIds } = seedTransactions(connection, ['Synthetic Alias Display'])
    const merchant = new MerchantRepository(connection).create({ name: 'Synthetic Alias Merchant' })
    new MerchantAliasRepository(connection).create({
      merchantId: merchant.id,
      matchKind: 'exact',
      pattern: 'Synthetic Alias Display'
    })
    const workflow = createWorkflow(connection)
    const row = workflow.listTransactions({
      sortBy: 'transactionDate',
      sortDirection: 'desc',
      limit: 50,
      offset: 0
    }).items[0]!
    const editor = workflow.getClassification(transactionIds[0])

    expect(row.classification?.merchantDisplay).toMatchObject({
      source: 'detected',
      displayName: 'Synthetic Alias Merchant'
    })
    expect(row.classification?.merchantDisplay?.authoritativeId).toBeUndefined()
    expect(editor.merchantDisplay).toMatchObject({
      source: 'detected',
      displayName: 'Synthetic Alias Merchant'
    })
    expect(editor.merchantDisplay?.authoritativeId).toBeUndefined()
    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
    ).toBeUndefined()
  })

  it('keeps authoritative merchant consistent between table and editor after manual save', () => {
    const { transactionIds } = seedTransactions(connection, ['Synthetic Manual Display'])
    const merchant = new MerchantRepository(connection).create({
      name: 'Synthetic Authoritative Merchant'
    })
    const workflow = createWorkflow(connection)

    workflow.saveManualClassification({
      transactionId: transactionIds[0],
      merchantId: merchant.id
    })

    const row = workflow.listTransactions({
      sortBy: 'transactionDate',
      sortDirection: 'desc',
      limit: 50,
      offset: 0
    }).items[0]!
    const editor = workflow.getClassification(transactionIds[0])

    expect(row.classification?.merchantDisplay).toMatchObject({
      source: 'authoritative',
      authoritativeId: merchant.id,
      authoritativeName: 'Synthetic Authoritative Merchant',
      displayName: 'Synthetic Authoritative Merchant'
    })
    expect(editor.merchantDisplay).toMatchObject({
      source: 'authoritative',
      authoritativeId: merchant.id,
      authoritativeName: 'Synthetic Authoritative Merchant',
      displayName: 'Synthetic Authoritative Merchant'
    })
  })

  it('exposes detected category without treating it as authoritative', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, ['Synthetic Rule Display'])
    const workflow = createWorkflow(connection)
    workflow.createRule({
      name: 'Synthetic rule display',
      descriptionMatchKind: 'exact',
      descriptionPattern: 'Synthetic Rule Display',
      categoryId
    })
    const row = workflow.listTransactions({
      sortBy: 'transactionDate',
      sortDirection: 'desc',
      limit: 50,
      offset: 0
    }).items[0]!
    const editor = workflow.getClassification(transactionIds[0])

    expect(row.classification?.categoryDisplay).toMatchObject({
      source: 'detected',
      detectedId: categoryId
    })
    expect(row.classification?.categoryDisplay?.authoritativeId).toBeUndefined()
    expect(editor.categoryDisplay).toMatchObject({
      source: 'detected',
      detectedId: categoryId
    })
    expect(editor.categoryDisplay?.authoritativeId).toBeUndefined()
  })

  it('finds exact normalized duplicate descriptions and excludes non-matches', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      '  Synthetic   Duplicate  ',
      'synthetic duplicate',
      'Synthetic Different'
    ])
    const workflow = createWorkflow(connection)
    const merchant = new MerchantRepository(connection).create({
      name: 'Synthetic Duplicate Merchant'
    })

    const summary = workflow.matchingClassificationSummary({
      transactionId: transactionIds[0],
      merchantId: merchant.id,
      categoryId
    })

    expect(summary.totalMatchingTransactionCount).toBe(2)
    expect(summary.otherMatchingTransactionCount).toBe(1)
    expect(summary.eligibleCount).toBe(1)
  })

  it('confirms matching exact-description transactions through explicit similar save', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Confirm Match',
      'Synthetic Confirm Match',
      'Synthetic Confirm Match',
      'Synthetic Other Match'
    ])
    const merchants = new MerchantRepository(connection)
    const selectedMerchant = merchants.create({ name: 'Synthetic Selected Merchant' })
    const preservedMerchant = merchants.create({ name: 'Synthetic Preserved Merchant' })
    const otherCategoryId = connection
      .prepare("SELECT id FROM categories WHERE key = 'transport.public'")
      .pluck()
      .get() as string
    const classifications = new TransactionClassificationRepository(connection)
    classifications.save({
      transactionId: transactionIds[1],
      merchantId: preservedMerchant.id,
      merchantSource: 'manual',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    classifications.save({
      transactionId: transactionIds[2],
      categoryId: otherCategoryId,
      categorySource: 'manual',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    const workflow = createWorkflow(connection)

    const result = workflow.saveManualClassificationAndConfirmMatches({
      transactionId: transactionIds[0],
      merchantId: selectedMerchant.id,
      categoryId
    })

    expect(result.confirmedMatchingTransactionCount).toBe(2)
    expect(classifications.findByTransactionId(transactionIds[0])).toMatchObject({
      merchantId: selectedMerchant.id,
      merchantSource: 'manual',
      categoryId,
      categorySource: 'manual'
    })
    expect(classifications.findByTransactionId(transactionIds[1])).toMatchObject({
      merchantId: selectedMerchant.id,
      merchantSource: 'manual',
      categoryId,
      categorySource: 'manual'
    })
    expect(classifications.findByTransactionId(transactionIds[2])).toMatchObject({
      merchantId: selectedMerchant.id,
      merchantSource: 'manual',
      categoryId,
      categorySource: 'manual'
    })
    expect(classifications.findByTransactionId(transactionIds[3])).toBeUndefined()
  })

  it('overwrites exact-description rows when similar save is explicit', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Preserved Similar',
      'Synthetic Preserved Similar',
      'Synthetic Preserved Similar'
    ])
    const merchants = new MerchantRepository(connection)
    const selectedMerchant = merchants.create({ name: 'Synthetic Similar Merchant' })
    const preservedMerchant = merchants.create({ name: 'Synthetic Preserved Similar Merchant' })
    const otherCategoryId = connection
      .prepare("SELECT id FROM categories WHERE key = 'transport.public'")
      .pluck()
      .get() as string
    const classifications = new TransactionClassificationRepository(connection)

    for (const transactionId of transactionIds.slice(1)) {
      classifications.save({
        transactionId,
        merchantId: preservedMerchant.id,
        merchantSource: 'manual',
        categoryId: otherCategoryId,
        categorySource: 'manual',
        usageType: 'business',
        costBehaviour: 'fixed',
        necessity: 'essential',
        classificationSource: 'manual',
        classificationStatus: 'confirmed'
      })
    }

    const workflow = createWorkflow(connection)
    const summary = workflow.matchingClassificationSummary({
      transactionId: transactionIds[0],
      merchantId: selectedMerchant.id,
      categoryId
    })

    expect(summary.otherMatchingTransactionCount).toBe(2)
    expect(summary.eligibleCount).toBe(2)

    const result = workflow.saveManualClassificationAndConfirmMatches({
      transactionId: transactionIds[0],
      merchantId: selectedMerchant.id,
      categoryId,
      usageType: 'personal',
      costBehaviour: 'variable',
      necessity: 'discretionary'
    })

    expect(result.confirmedMatchingTransactionCount).toBe(2)
    for (const transactionId of transactionIds.slice(1)) {
      expect(classifications.findByTransactionId(transactionId)).toMatchObject({
        merchantId: selectedMerchant.id,
        merchantSource: 'manual',
        categoryId,
        categorySource: 'manual',
        usageType: 'personal',
        costBehaviour: 'variable',
        necessity: 'discretionary',
        classificationSource: 'manual',
        classificationStatus: 'confirmed'
      })
    }
  })

  it('rolls back save plus matching confirmation when the current save is invalid', () => {
    const { transactionIds } = seedTransactions(connection, [
      'Synthetic Transactional Match',
      'Synthetic Transactional Match'
    ])
    const merchant = new MerchantRepository(connection).create({
      name: 'Synthetic Transactional Merchant'
    })
    const workflow = createWorkflow(connection)

    expect(() =>
      workflow.saveManualClassificationAndConfirmMatches({
        transactionId: transactionIds[0],
        merchantId: merchant.id,
        categoryId: randomUUID()
      })
    ).toThrow()

    const classifications = new TransactionClassificationRepository(connection)
    expect(classifications.findByTransactionId(transactionIds[0])).toBeUndefined()
    expect(classifications.findByTransactionId(transactionIds[1])).toBeUndefined()
  })

  it('keeps ordinary manual save limited to the current transaction', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Ordinary Save',
      'Synthetic Ordinary Save'
    ])
    const merchant = new MerchantRepository(connection).create({
      name: 'Synthetic Ordinary Merchant'
    })
    const workflow = createWorkflow(connection)

    workflow.saveManualClassification({
      transactionId: transactionIds[0],
      merchantId: merchant.id,
      categoryId
    })

    const classifications = new TransactionClassificationRepository(connection)
    expect(classifications.findByTransactionId(transactionIds[0])).toMatchObject({
      merchantId: merchant.id,
      categoryId
    })
    expect(classifications.findByTransactionId(transactionIds[1])).toBeUndefined()
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

  it('accepts AI category while preserving an existing manual merchant', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Manual Merchant'
    ])
    const merchant = new MerchantRepository(connection).create({
      name: 'Synthetic Manual Merchant'
    })
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      merchantId: merchant.id,
      merchantSource: 'manual',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    const review = service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: false
    })

    expect(review).toMatchObject({ category: 'accepted', merchant: 'not_suggested' })
    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
    ).toMatchObject({
      merchantId: merchant.id,
      merchantSource: 'manual',
      categoryId,
      categorySource: 'ai',
      classificationSource: 'manual'
    })
  })

  it('accepts AI merchant while preserving an existing manual category', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Manual Category'
    ])
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      categoryId,
      categorySource: 'manual',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedMerchantName: 'Synthetic Suggested Merchant'
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    const review = service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: false,
      acceptMerchant: true
    })
    const classification = new TransactionClassificationRepository(connection).findByTransactionId(
      transactionIds[0]
    )

    expect(review).toMatchObject({ category: 'not_suggested', merchant: 'accepted' })
    expect(classification?.categoryId).toBe(categoryId)
    expect(classification?.categorySource).toBe('manual')
    expect(classification?.merchantId).toBeTruthy()
    expect(classification?.merchantSource).toBe('ai')
    expect(classification?.classificationSource).toBe('manual')
  })

  it('preserves a differing manual merchant when accepting both fields', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Both Manual Merchant'
    ])
    const merchant = new MerchantRepository(connection).create({
      name: 'Synthetic Preserved Merchant'
    })
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      merchantId: merchant.id,
      merchantSource: 'manual',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId,
      suggestedMerchantName: 'Synthetic Suggested Merchant'
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    const review = service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: true
    })

    const classification = new TransactionClassificationRepository(connection).findByTransactionId(
      transactionIds[0]
    )
    expect(review).toMatchObject({ category: 'accepted', merchant: 'preserved_manual' })
    expect(classification).toMatchObject({
      categoryId,
      merchantSource: 'manual',
      categorySource: 'ai'
    })
    expect(classification?.merchantId).toBe(merchant.id)
  })

  it('accepts the eligible merchant from Accept Both while preserving manual category', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Both Manual Category'
    ])
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      categoryId,
      categorySource: 'manual',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId,
      suggestedMerchantName: 'Synthetic Suggested Both Merchant'
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    const review = service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: true
    })
    const classification = new TransactionClassificationRepository(connection).findByTransactionId(
      transactionIds[0]
    )

    expect(review).toMatchObject({ category: 'preserved_manual', merchant: 'accepted' })
    expect(classification?.categoryId).toBe(categoryId)
    expect(classification?.categorySource).toBe('manual')
    expect(classification?.merchantId).toBeTruthy()
    expect(classification?.merchantSource).toBe('ai')
  })

  it('returns a deliberate no-change result when both suggested fields are already manual', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, ['Synthetic Both Manual'])
    const merchant = new MerchantRepository(connection).create({
      name: 'Synthetic Fully Manual Merchant'
    })
    new TransactionClassificationRepository(connection).save({
      transactionId: transactionIds[0],
      merchantId: merchant.id,
      merchantSource: 'manual',
      categoryId,
      categorySource: 'manual',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId,
      suggestedMerchantName: 'Synthetic Fully Manual Merchant'
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    const review = service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: true
    })

    expect(review).toMatchObject({
      category: 'preserved_manual',
      merchant: 'preserved_manual',
      suggestion: expect.objectContaining({ status: 'superseded' })
    })
    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
    ).toMatchObject({
      merchantId: merchant.id,
      merchantSource: 'manual',
      categoryId,
      categorySource: 'manual'
    })
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

    expect(acceptedAgain.suggestion.status).toBe('accepted')
    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
        ?.categoryId
    ).toBe(categoryId)
  })

  it('treats repeated reject of a processed suggestion as idempotent', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, ['Synthetic Rejected'])
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    const rejected = service.rejectSuggestion(suggestion.id)
    const rejectedAgain = service.rejectSuggestion(suggestion.id)

    expect(rejected.status).toBe('rejected')
    expect(rejectedAgain.status).toBe('rejected')
  })

  it('accepts an AI merchant without creating a deterministic merchant alias', () => {
    const { transactionIds } = seedTransactions(connection, ['Synthetic Accepted Merchant'])
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedMerchantName: 'Synthetic Accepted Merchant Name'
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    const review = service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: false,
      acceptMerchant: true
    })

    expect(review).toMatchObject({ merchant: 'accepted' })
    expect(
      new TransactionClassificationRepository(connection).findByTransactionId(transactionIds[0])
    ).toMatchObject({ merchantSource: 'ai', classificationStatus: 'confirmed' })
    expect(new MerchantAliasRepository(connection).list()).toHaveLength(0)
    expect(new AiSuggestionRepository(connection).findById(suggestion.id).status).toBe('accepted')
  })

  it('keeps accepted AI classifications confirmed in the transaction read model', () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Confirmed AI Read Model'
    ])
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedCategoryId: categoryId,
      suggestedMerchantName: 'Synthetic Confirmed Merchant'
    })
    const service = new SmartClassificationService(connection, { classify: async () => [] })

    service.acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: true
    })

    const row = createWorkflow(connection).listTransactions({
      sortBy: 'transactionDate',
      sortDirection: 'desc',
      limit: 50,
      offset: 0
    }).items[0]!

    expect(row.classification).toMatchObject({
      classificationSource: 'ai',
      classificationStatus: 'confirmed',
      merchantDisplay: { source: 'authoritative' },
      categoryDisplay: { source: 'authoritative' }
    })
  })

  it('does not generate another AI suggestion for fully confirmed AI fields', async () => {
    const { transactionIds, categoryId } = seedTransactions(connection, [
      'Synthetic Already Confirmed AI'
    ])
    const suggestion = createSuggestion(connection, {
      transactionId: transactionIds[0],
      suggestedMerchantName: 'Synthetic Confirmed Merchant',
      suggestedCategoryId: categoryId
    })
    new SmartClassificationService(connection, { classify: async () => [] }).acceptSuggestion({
      suggestionId: suggestion.id,
      acceptCategory: true,
      acceptMerchant: true
    })
    new AiSettingsRepository(connection).update({ aiEnabled: true })
    let providerReached = false
    const service = new SmartClassificationService(connection, {
      classify: async () => {
        providerReached = true
        return []
      }
    })

    const summary = await service.classifyTransactions(transactionIds)

    expect(providerReached).toBe(false)
    expect(summary.suggestionsCreated).toBe(0)
    expect(summary.skippedDeterministicOrManual).toBe(1)
    expect(new AiSuggestionRepository(connection).listPending()).toHaveLength(0)
  })

  it('treats creating the same active merchant alias for the same merchant as idempotent', () => {
    const merchant = new MerchantRepository(connection).create({ name: 'Synthetic Alias Merchant' })
    const aliases = new MerchantAliasRepository(connection)

    const first = aliases.create({
      merchantId: merchant.id,
      matchKind: 'exact',
      pattern: 'Synthetic Alias Pattern'
    })
    const second = aliases.create({
      merchantId: merchant.id,
      matchKind: 'exact',
      pattern: 'Synthetic Alias Pattern'
    })

    expect(second.id).toBe(first.id)
    expect(aliases.list()).toHaveLength(1)
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

function createWorkflow(database: Database): ApplicationWorkflow {
  return new ApplicationWorkflow(
    database,
    { selectImportFile: async () => undefined },
    new MemorySecretStore(),
    { classify: async () => [] }
  )
}

function countRows(database: Database, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
    .count
}
