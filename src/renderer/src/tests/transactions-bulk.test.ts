import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, isProxy, nextTick, reactive } from 'vue'
import { createPinia } from 'pinia'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { SampoApi } from '../../../shared/app-info'
import type { AiClassificationProvider } from '../../../main/ai/provider'
import { IPC_CHANNELS } from '../../../shared/ipc'
import { registerApplicationIpcHandlers } from '../../../main/ipc-handlers'
import { createDatabase, type SampoDatabase } from '../../../main/storage/database'
import { ApplicationWorkflow } from '../../../main/workflows/application-workflow'
import { AccountRepository } from '../../../main/storage/accounts'
import {
  CategoryRepository,
  TransactionClassificationRepository
} from '../../../main/storage/categorisation'
import { AiSettingsRepository } from '../../../main/storage/ai'
import { ImportService } from '../../../main/services/import-service'
import { MemorySecretStore } from '../../../main/ai/secret-store'
import TransactionsView from '../views/TransactionsView.vue'
import { useClassificationStore } from '../stores/classification'
import { useAiStore } from '../stores/ai'
import { useTransactionsStore } from '../stores/transactions'

const bridge = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  api: undefined as SampoApi | undefined,
  invoke: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      bridge.handlers.set(channel, handler)
  },
  ipcRenderer: { invoke: (...args: unknown[]) => bridge.invoke(...args) },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: SampoApi) => {
      bridge.api = api
    }
  },
  BrowserWindow: { fromWebContents: () => null }
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
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
type View = {
  selectedTransactionIds: string[]
  bulkForm: { categoryId: string }
  filters: { search: string }
  bulkUpdate: () => Promise<void>
  classifySelectedWithAi: () => Promise<void>
  nextPage: () => Promise<void>
  applyFilters: () => Promise<void>
}
let directory: string
let database: SampoDatabase
let unmount: (() => void) | undefined
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sampo-bulk-'))
  database = createDatabase({ path: join(directory, 'synthetic.sqlite3'), useWal: false })
  bridge.handlers.clear()
  bridge.invoke.mockReset()
})
afterEach(() => {
  unmount?.()
  database.close()
  rmSync(directory, { recursive: true, force: true })
  vi.unstubAllGlobals()
})
async function setup(): Promise<{
  view: View
  categoryId: string
  workflow: ApplicationWorkflow
  provider: ReturnType<typeof vi.fn<AiClassificationProvider['classify']>>
  transactions: ReturnType<typeof useTransactionsStore>
  ids: string[]
  ai: ReturnType<typeof useAiStore>
  classification: ReturnType<typeof useClassificationStore>
}> {
  const db = database.connection
  const categoryId = new CategoryRepository(db).list().find((c) => c.key === 'food.groceries')!.id
  const provider = vi.fn<AiClassificationProvider['classify']>(
    async (inputs: { inputId: string }[]) =>
      inputs.map((input) => ({
        inputId: input.inputId,
        merchant: { canonicalName: 'Synthetic Merchant', confidence: 0.9 },
        category: { categoryId, confidence: 0.9, categoryUnknown: false },
        needsWebLookup: false,
        reasonCode: 'known_brand' as const
      }))
  )
  const secrets = new MemorySecretStore()
  await secrets.setOpenAiApiKey('synthetic-key')
  new AiSettingsRepository(db).update({ aiEnabled: true })
  const workflow = new ApplicationWorkflow(
    db,
    { selectImportFile: async () => undefined },
    secrets,
    { classify: provider }
  )
  const account = new AccountRepository(db).create({
    name: 'Synthetic bulk account',
    kind: 'current'
  })
  new ImportService(db).commitPreparedImport({
    accountId: account.id,
    sourceKind: 'unknown',
    sourceFileName: 'synthetic.txt',
    fileSha256: 'b'.repeat(64),
    transactions: [0, 1, 2].map((index) => ({
      accountId: account.id,
      sourceRowIndex: index,
      transactionDate: `2026-03-0${index + 1}`,
      originalDescription: `Synthetic bulk ${index}`,
      amountCents: -1250,
      transactionType: 'expense' as const
    }))
  })
  registerApplicationIpcHandlers(workflow, () => true)
  bridge.invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
    // Model Electron's structured-clone boundary. This intentionally rejects Proxy payloads.
    const wireArgs = structuredClone(args)
    return bridge.handlers.get(channel)!({}, ...wireArgs)
  })
  await import('../../../preload/index')
  vi.stubGlobal('window', { sampo: bridge.api })
  const pinia = createPinia()
  const app = renderer.createApp({ ...TransactionsView, render: () => null }).use(pinia)
  app.provide(Symbol.for('v-scx'), {})
  app.mount({})
  unmount = () => app.unmount()
  await new Promise<void>((resolve) => setImmediate(resolve))
  await nextTick()
  const view = (app._instance as unknown as { setupState: View }).setupState
  const transactions = useTransactionsStore(pinia)
  return {
    view,
    categoryId,
    workflow,
    provider,
    transactions,
    ids: transactions.page.items.map((row) => row.id),
    ai: useAiStore(pinia),
    classification: useClassificationStore(pinia)
  }
}
function calls(channel: string): typeof bridge.invoke.mock.calls {
  return bridge.invoke.mock.calls.filter(([name]) => name === channel)
}

describe('bulk renderer → preload → IPC → workflow', () => {
  it('normalizes a reactive bulk request and persists only the two selected rows', async () => {
    const { view, ids, categoryId, transactions, classification } = await setup()
    view.selectedTransactionIds = ids.slice(0, 2)
    view.bulkForm.categoryId = categoryId
    expect(isProxy(view.selectedTransactionIds)).toBe(true)
    bridge.invoke.mockClear()
    await view.bulkUpdate()
    expect(classification.error).toBeNull()
    const payload = calls(IPC_CHANNELS.classificationBulkUpdate)[0]![1]
    expect(payload).toMatchObject({
      transactionIds: ids.slice(0, 2),
      categoryId,
      overwriteManual: false
    })
    expect(isProxy(payload.transactionIds)).toBe(false)
    expect(calls(IPC_CHANNELS.transactionsList)).toHaveLength(1)
    expect(calls(IPC_CHANNELS.aiListSuggestions)).toHaveLength(1)
    expect(view.selectedTransactionIds).toEqual([])
    const repo = new TransactionClassificationRepository(database.connection)
    for (const id of ids.slice(0, 2))
      expect(repo.findByTransactionId(id)?.categoryId).toBe(categoryId)
    expect(repo.findByTransactionId(ids[2]!)).toBeUndefined()
    expect(
      transactions.page.items.filter((row) => row.classification?.categoryId === categoryId)
    ).toHaveLength(2)
  })
  it('also normalizes callers that pass an entirely reactive input object', async () => {
    const { ids, categoryId, classification } = await setup()
    await classification.bulkUpdate(reactive({ transactionIds: ids.slice(0, 2), categoryId }))
    expect(classification.error).toBeNull()
    expect(isProxy(calls(IPC_CHANNELS.classificationBulkUpdate)[0]![1])).toBe(false)
  })
  it('Classify already serializes safely, reaches main for multiple rows, refreshes and retains visible selection', async () => {
    const { view, ids, ai, provider } = await setup()
    view.selectedTransactionIds = ids.slice(0, 2)
    bridge.invoke.mockClear()
    await view.classifySelectedWithAi()
    expect(ai.error).toBeNull()
    expect(calls(IPC_CHANNELS.aiSmartClassify)[0]![1]).toEqual({ transactionIds: ids.slice(0, 2) })
    expect(isProxy(calls(IPC_CHANNELS.aiSmartClassify)[0]![1].transactionIds)).toBe(false)
    expect(provider).toHaveBeenCalledOnce()
    expect(ai.suggestions.map((s) => s.transactionId).sort()).toEqual(ids.slice(0, 2).sort())
    expect(calls(IPC_CHANNELS.transactionsList)).toHaveLength(1)
    expect(calls(IPC_CHANNELS.aiListSuggestions).length).toBeGreaterThan(0)
    expect(view.selectedTransactionIds).toEqual(ids.slice(0, 2))
  })
  it.each(['apply', 'classify'] as const)(
    'retains %s errors and selection, without success refresh',
    async (action) => {
      const { view, ids, categoryId, provider, classification, ai, workflow } = await setup()
      view.selectedTransactionIds = ids.slice(0, 2)
      view.bulkForm.categoryId = categoryId
      if (action === 'classify')
        provider.mockRejectedValueOnce(new Error('Synthetic provider failure'))
      else workflow.saveManualClassification({ transactionId: ids[0], categoryId })
      bridge.invoke.mockClear()
      await (action === 'apply' ? view.bulkUpdate() : view.classifySelectedWithAi())
      expect(action === 'apply' ? classification.error : ai.error).toBeTruthy()
      expect(view.selectedTransactionIds).toEqual(ids.slice(0, 2))
      expect(calls(IPC_CHANNELS.transactionsList)).toHaveLength(0)
      expect(calls(IPC_CHANNELS.aiListSuggestions)).toHaveLength(0)
    }
  )
  it('never invokes either action with an empty selection', async () => {
    const { view, classification } = await setup()
    bridge.invoke.mockClear()
    await view.bulkUpdate()
    await view.classifySelectedWithAi()
    await classification.bulkUpdate({ transactionIds: [] })
    expect(bridge.invoke).not.toHaveBeenCalled()
  })
  it('clears selection on pagination and drops hidden IDs after filtering', async () => {
    const { view, ids } = await setup()
    view.selectedTransactionIds = ids.slice(0, 2)
    await view.nextPage()
    expect(view.selectedTransactionIds).toEqual([])
    view.selectedTransactionIds = ids.slice(0, 2)
    view.filters.search = 'Synthetic bulk 0'
    await view.applyFilters()
    expect(view.selectedTransactionIds).toEqual([])
    view.selectedTransactionIds = ids.slice(0, 2) // stale IDs from an obsolete page must not escape
    bridge.invoke.mockClear()
    await view.classifySelectedWithAi()
    expect(calls(IPC_CHANNELS.aiSmartClassify)).toHaveLength(0)
  })
})
