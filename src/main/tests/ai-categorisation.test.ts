import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Database } from 'better-sqlite3'
import { createDatabase, type SampoDatabase } from '../storage/database'
import { AccountRepository } from '../storage/accounts'
import { ImportService } from '../services/import-service'
import { TransactionRepository } from '../storage/transactions'
import { AiSettingsRepository, AiSuggestionRepository } from '../storage/ai'
import { TransactionClassificationRepository } from '../storage/categorisation'
import { SmartClassificationService } from '../ai/smart-classification-service'
import { OpenAiClassificationProvider, type AiClassificationProvider } from '../ai/provider'
import { MemorySecretStore } from '../ai/secret-store'
import { AiInvalidResponseError, AiPartialResponseError } from '../ai/errors'
import type { NewTransaction, PreparedImport } from '../domain/schemas'

const syntheticHash = 'c'.repeat(64)

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

describe('OpenAI classification provider', () => {
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
                  results: [
                    {
                      inputId: 'input-1',
                      category: { categoryId: null, confidence: 0.2, categoryUnknown: true },
                      needsWebLookup: false,
                      reasonCode: 'unknown'
                    }
                  ]
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
                  results: [
                    {
                      inputId: 'input-1',
                      category: { categoryId: null, confidence: 0.2, categoryUnknown: true },
                      needsWebLookup: true,
                      reasonCode: 'ambiguous'
                    }
                  ]
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
