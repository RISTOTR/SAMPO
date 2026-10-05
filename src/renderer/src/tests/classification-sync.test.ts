import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAiStore } from '../stores/ai'
import { useClassificationStore } from '../stores/classification'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('classification refresh ordering', () => {
  it('does not resurrect an accepted AI delta from an older pending request', async () => {
    const old = deferred<unknown>()
    const listSuggestions = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ ok: true, data: [] })
    vi.stubGlobal('window', {
      sampo: {
        ai: {
          listSuggestions,
          acceptSuggestion: vi.fn().mockResolvedValue({
            ok: true,
            data: { merchant: 'accepted', category: 'not_suggested' }
          })
        }
      }
    })
    const store = useAiStore()
    const oldLoad = store.loadSuggestions()
    await store.acceptSuggestion('suggestion', { acceptMerchant: true, acceptCategory: false })
    old.resolve({ ok: true, data: [{ id: 'stale' }] })
    await oldLoad
    expect(store.suggestions).toEqual([])
  })

  it('retains an acceptance failure across transaction-triggered suggestion reloads', async () => {
    vi.stubGlobal('window', {
      sampo: {
        ai: {
          listSuggestions: vi.fn().mockResolvedValue({ ok: true, data: [] }),
          acceptSuggestion: vi.fn().mockResolvedValue({
            ok: false,
            error: { code: 'storage_error', message: 'Save failed' }
          })
        }
      }
    })
    const store = useAiStore()
    await store.acceptSuggestion('suggestion', { acceptMerchant: true, acceptCategory: false })
    await store.loadSuggestions()
    expect(store.error).toBe('Save failed')
  })

  it('retains manual mutation errors across reference refreshes', async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, data: [] })
    vi.stubGlobal('window', {
      sampo: {
        classification: {
          saveManual: vi.fn().mockResolvedValue({
            ok: false,
            error: { code: 'storage_error', message: 'Manual save failed' }
          })
        },
        categories: { list },
        merchants: { list },
        merchantAliases: { list },
        rules: { list }
      }
    })
    const store = useClassificationStore()
    await store.saveManual({ transactionId: 'transaction' })
    await store.loadReference()
    expect(store.error).toBe('Manual save failed')
  })

  it('does not replace a saved classification with an older editor response', async () => {
    const old = deferred<unknown>()
    vi.stubGlobal('window', {
      sampo: {
        classification: {
          get: vi.fn().mockReturnValue(old.promise),
          saveManual: vi.fn().mockResolvedValue({
            ok: true,
            data: { transactionId: 'transaction', merchantId: 'new' }
          })
        }
      }
    })
    const store = useClassificationStore()
    const load = store.loadClassification('transaction')
    await store.saveManual({ transactionId: 'transaction' })
    old.resolve({ ok: true, data: { transactionId: 'transaction', merchantId: 'old' } })
    await load
    expect(store.current?.merchantId).toBe('new')
  })
})
