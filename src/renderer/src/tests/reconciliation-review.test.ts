import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import ReconciliationWarnings from '../components/ReconciliationWarnings.vue'
import { useReconciliationStore } from '../stores/reconciliation'
import { node, nodes, renderer } from './helpers/render-host'

afterEach(() => vi.unstubAllGlobals())

describe('reconciliation review', () => {
  it('renders blocking preview reasons and concrete next steps', () => {
    const root = node()
    const app = renderer.createApp(ReconciliationWarnings, {
      warnings: [
        {
          code: 'visa_batch_incomplete',
          message: 'Statement movements are missing.',
          blocking: true
        },
        { code: 'amount_mismatch', message: 'Totals differ.', blocking: true }
      ]
    })
    app.mount(root)
    const text = nodes(root)
      .map((item) => item.text)
      .join(' ')
    expect(text).toContain('Blocked:')
    expect(text).toContain('Statement movements are missing.')
    expect(text).toContain('overlapping import')
    expect(text).toContain('must match exactly')
    app.unmount()
  })

  it('clears stale candidates and exposes lookup and preview failures', async () => {
    setActivePinia(createPinia())
    const findCandidates = vi
      .fn()
      .mockResolvedValue({ ok: true, data: [{ visaImportBatchId: 'old' }] })
    const preview = vi
      .fn()
      .mockRejectedValue({ code: 'RECONCILIATION_ERROR', message: 'Preview unavailable' })
    vi.stubGlobal('window', { sampo: { reconciliation: { findCandidates, preview } } })
    const store = useReconciliationStore()
    await store.findCandidates('first')
    expect(store.candidates).toHaveLength(1)
    findCandidates.mockRejectedValueOnce({
      code: 'RECONCILIATION_ERROR',
      message: 'Lookup unavailable'
    })
    await store.findCandidates('second')
    expect(store.candidates).toEqual([])
    expect(store.error).toBe('Lookup unavailable')
    expect(store.findingCandidates).toBe(false)
    await store.loadPreview('second', 'batch')
    expect(store.preview).toBeNull()
    expect(store.error).toBe('Preview unavailable')
    expect(store.loadingPreview).toBe(false)
  })

  it('ignores a late result for a previously selected settlement', async () => {
    setActivePinia(createPinia())
    let resolveFirst!: (value: unknown) => void
    const findCandidates = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockResolvedValueOnce({ ok: true, data: [{ visaImportBatchId: 'new' }] })
    vi.stubGlobal('window', { sampo: { reconciliation: { findCandidates } } })
    const store = useReconciliationStore()
    const first = store.findCandidates('first')
    await store.findCandidates('second')
    resolveFirst({ ok: true, data: [{ visaImportBatchId: 'old' }] })
    await first
    expect(store.candidates.map((item) => item.visaImportBatchId)).toEqual(['new'])
  })
})
