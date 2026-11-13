import type { Mock } from 'vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, isProxy, nextTick } from 'vue'
import ReviewSuggestions from '../components/ReviewSuggestions.vue'
import type { ReviewItemDto, ReviewPageDto, ReviewAcceptInputDto } from '../../../shared/dtos'

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
const item: ReviewItemDto = {
  transactionId: '11111111-1111-4111-8111-111111111111',
  description: 'Synthetic shop',
  date: '2026-01-01',
  amountCents: -100,
  currency: 'EUR',
  merchantName: 'Synthetic',
  merchantSource: 'Learned',
  categorySource: 'Rule',
  categoryPath: ['Synthetic'],
  canAcceptMerchant: true,
  canAcceptCategory: true,
  canBulkAccept: true,
  conflict: false
}
type State = {
  page: ReviewPageDto
  selected: string[]
  error: string | null
  load: () => Promise<void>
  accept: (ids: string[]) => Promise<void>
  reject: (row: ReviewItemDto) => Promise<void>
}
let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  vi.unstubAllGlobals()
})
function mount(api: object): { state: State; changed: Mock } {
  vi.stubGlobal('window', { sampo: { review: api } })
  const changed = vi.fn()
  const app = renderer.createApp(
    { ...ReviewSuggestions, render: () => null },
    { query: {}, collapsed: false, onChanged: changed }
  )
  app.provide(Symbol.for('v-scx'), {})
  app.mount({})
  unmount = () => app.unmount()
  const state = (app._instance as unknown as { setupState: State }).setupState
  return { state, changed }
}
describe('Review Suggestions synchronization', () => {
  it('sends plain selected IDs, refreshes the count, and notifies Transactions after acceptance', async () => {
    let remaining = [item]
    const accept = vi.fn(async (input: ReviewAcceptInputDto) => {
      expect(isProxy(input.transactionIds)).toBe(false)
      expect(input.transactionIds).toEqual([item.transactionId])
      remaining = []
      return { ok: true, data: 1 }
    })
    const { state, changed } = mount({
      list: async () => ({ ok: true, data: { items: remaining, total: remaining.length } }),
      accept
    })
    await state.load()
    state.selected = [item.transactionId]
    await nextTick()
    await state.accept(state.selected)
    expect(state.page.total).toBe(0)
    expect(state.selected).toEqual([])
    expect(changed).toHaveBeenCalledOnce()
  })
  it('keeps failed selections reviewable and does not emit a success refresh', async () => {
    const { state, changed } = mount({
      list: async () => ({ ok: true, data: { items: [item], total: 1 } }),
      accept: async () => ({
        ok: false,
        error: { code: 'validation_error', message: 'Synthetic failure' }
      })
    })
    await state.load()
    state.selected = [item.transactionId]
    await state.accept(state.selected)
    expect(state.error).toBe('Synthetic failure')
    expect(state.selected).toEqual([item.transactionId])
    expect(changed).not.toHaveBeenCalled()
  })
  it('discards late queue responses and removes hidden selections', async () => {
    let finish: (value: unknown) => void = () => {}
    const list = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue({ ok: true, data: { items: [], total: 0 } })
    const { state } = mount({ list })
    const old = state.load()
    state.selected = [item.transactionId]
    await state.load()
    finish({ ok: true, data: { items: [item], total: 1 } })
    await old
    expect(state.page.total).toBe(0)
    expect(state.selected).toEqual([])
  })
})
