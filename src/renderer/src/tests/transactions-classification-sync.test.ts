import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import TransactionsView from '../views/TransactionsView.vue'
import { useTransactionsStore } from '../stores/transactions'
import { useAiStore } from '../stores/ai'
import { createDatabase, type SampoDatabase } from '../../../main/storage/database'
import { ApplicationWorkflow } from '../../../main/workflows/application-workflow'
import { AccountRepository } from '../../../main/storage/accounts'
import {
  CategoryRepository,
  TransactionClassificationRepository
} from '../../../main/storage/categorisation'
import { ImportService } from '../../../main/services/import-service'
import { AiSuggestionRepository } from '../../../main/storage/ai'
import { MemorySecretStore } from '../../../main/ai/secret-store'

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))

// Run the real view setup and handlers with real stores and a temporary SQLite workflow.
// Rendering is suppressed: these tests assert the reactive state consumed by the template.
const renderer = createRenderer<object, object>({
  patchProp: () => {},
  insert: () => {},
  remove: () => {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText: () => {},
  setElementText: () => {},
  parentNode: () => null,
  nextSibling: () => null
})
type ViewState = {
  openEditor: (id: string) => Promise<void>
  saveManual: () => Promise<void>
  acceptAiSuggestion: (
    id: string,
    options: { acceptMerchant: boolean; acceptCategory: boolean }
  ) => Promise<void>
  manualForm: { merchantId: string; categoryId: string }
  newMerchantName: string
}

let directory: string
let database: SampoDatabase
let unmount: (() => void) | undefined
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sampo-sync-'))
  database = createDatabase({ path: join(directory, 'test.sqlite3'), useWal: false })
})
afterEach(() => {
  unmount?.()
  database.close()
  rmSync(directory, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

async function setup(): Promise<{
  view: ViewState
  transactionId: string
  categoryId: string
  suggestion: ReturnType<AiSuggestionRepository['create']>
  transactions: ReturnType<typeof useTransactionsStore>
  ai: ReturnType<typeof useAiStore>
}> {
  const db = database.connection
  const workflow = new ApplicationWorkflow(
    db,
    { selectImportFile: async () => undefined },
    new MemorySecretStore(),
    {
      classify: async () => {
        throw new Error('Unexpected AI call')
      }
    }
  )
  const account = new AccountRepository(db).create({
    name: 'Synthetic sync account',
    kind: 'current'
  })
  const imported = new ImportService(db).commitPreparedImport({
    accountId: account.id,
    sourceKind: 'unknown',
    sourceFileName: 'synthetic-sync.txt',
    fileSha256: 'a'.repeat(64),
    transactions: [
      {
        accountId: account.id,
        sourceRowIndex: 0,
        transactionDate: '2026-03-01',
        originalDescription: 'Synthetic Sync Description',
        amountCents: -1250,
        transactionType: 'expense'
      }
    ]
  })
  const transactionId = imported.transactions[0]!.id
  const categoryId = new CategoryRepository(db).list().find((c) => c.key === 'food.groceries')!.id
  const suggestion = new AiSuggestionRepository(db).create({
    transactionId,
    provider: 'openai',
    model: 'synthetic',
    suggestedMerchantName: 'Synthetic Suggested Merchant',
    suggestedCategoryId: categoryId,
    merchantConfidence: 900,
    categoryConfidence: 900,
    needsWebLookup: false,
    usedWebSearch: false,
    reasonCode: 'known_brand'
  })
  const ok = <T>(value: T): Promise<{ ok: true; data: T }> =>
    Promise.resolve({ ok: true, data: value })
  vi.stubGlobal('window', {
    sampo: {
      accounts: { list: () => ok(workflow.listAccounts()) },
      categories: { list: () => ok(workflow.listCategories()) },
      merchants: { list: () => ok(workflow.listMerchants({})) },
      merchantAliases: { list: () => ok(workflow.listMerchantAliases()) },
      rules: { list: () => ok(workflow.listRules()) },
      transactions: {
        list: (query: Parameters<typeof workflow.listTransactions>[0]) =>
          ok(workflow.listTransactions(query))
      },
      classification: {
        get: (id: string) => ok(workflow.getClassification(id)),
        saveManual: (input: unknown) => ok(workflow.saveManualClassification(input)),
        matchingSummary: (input: unknown) => ok(workflow.matchingClassificationSummary(input))
      },
      ai: {
        getSettings: async () => ({ ok: true, data: await workflow.getAiSettings() }),
        listSuggestions: (input: Parameters<typeof workflow.listAiSuggestions>[0]) =>
          ok(workflow.listAiSuggestions(input)),
        acceptSuggestion: (input: unknown) => ok(workflow.acceptAiSuggestion(input))
      }
    }
  })
  const pinia = createPinia()
  const app = renderer.createApp({ ...TransactionsView, render: () => null })
  app.use(pinia)
  app.provide(Symbol.for('v-scx'), {})
  app.mount({})
  unmount = () => app.unmount()
  await new Promise<void>((resolve) => setImmediate(resolve))
  await nextTick()
  const view = (app._instance as unknown as { setupState: ViewState }).setupState
  return {
    view,
    transactionId,
    categoryId,
    suggestion,
    transactions: useTransactionsStore(pinia),
    ai: useAiStore(pinia)
  }
}

describe('Transactions classification mutation synchronization', () => {
  it.each(['merchant', 'category', 'both'] as const)(
    'manual %s save immediately refreshes Transactions and matching AI deltas',
    async (field) => {
      const { view, transactionId, categoryId, transactions, ai } = await setup()
      await view.openEditor(transactionId)
      view.manualForm.categoryId = field === 'merchant' ? '' : categoryId
      if (field !== 'category') view.newMerchantName = 'Synthetic Suggested Merchant'
      await view.saveManual()
      const persisted = new TransactionClassificationRepository(
        database.connection
      ).findByTransactionId(transactionId)
      const row = transactions.page.items[0]!
      if (field !== 'category')
        expect(row.classification?.merchantDisplay).toMatchObject({
          source: 'authoritative',
          displayName: 'Synthetic Suggested Merchant'
        })
      if (field !== 'merchant')
        expect(row.classification?.categoryDisplay).toMatchObject({
          source: 'authoritative',
          authoritativeId: categoryId
        })
      expect(persisted?.classificationStatus).toBe('confirmed')
      if (field === 'both') expect(ai.suggestions).toHaveLength(0)
      else
        expect(ai.suggestions[0]).toMatchObject({
          canAcceptMerchant: field === 'category',
          canAcceptCategory: field === 'merchant'
        })
    }
  )

  it.each(['merchant', 'category'] as const)(
    'accepting AI %s refreshes the open editor and leaves only the other delta',
    async (first) => {
      const { view, transactionId, categoryId, suggestion, transactions, ai } = await setup()
      await view.openEditor(transactionId)
      await view.acceptAiSuggestion(suggestion.id, {
        acceptMerchant: first === 'merchant',
        acceptCategory: first === 'category'
      })
      expect(ai.suggestions).toHaveLength(1)
      expect(ai.suggestions[0]).toMatchObject({
        canAcceptMerchant: first === 'category',
        canAcceptCategory: first === 'merchant'
      })
      const row = transactions.page.items[0]!
      if (first === 'merchant') {
        expect(row.classification?.merchantDisplay?.source).toBe('authoritative')
        expect(view.manualForm.merchantId).toBe(row.classification?.merchantId)
        expect(view.newMerchantName).toBe('')
      } else {
        expect(row.classification?.categoryDisplay?.source).toBe('authoritative')
        expect(view.manualForm.categoryId).toBe(categoryId)
      }
      await view.acceptAiSuggestion(suggestion.id, {
        acceptMerchant: first === 'category',
        acceptCategory: first === 'merchant'
      })
      expect(ai.suggestions).toHaveLength(0)
      expect(transactions.page.items[0]!.classification).toMatchObject({
        merchantDisplay: { source: 'authoritative' },
        categoryDisplay: { source: 'authoritative' }
      })
      expect(new AiSuggestionRepository(database.connection).findById(suggestion.id).status).toBe(
        'accepted'
      )
    }
  )
})
