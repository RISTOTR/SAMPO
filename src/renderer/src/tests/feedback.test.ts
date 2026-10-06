import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { nextTick } from 'vue'
import TransactionsFeedback from '../components/TransactionsFeedback.vue'
import { useAiStore } from '../stores/ai'
import { useClassificationStore } from '../stores/classification'
import { renderer, node, nodes } from './helpers/render-host'
let unmount: () => void
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  unmount?.()
  vi.useRealTimers()
})
function setup(): {
  ai: ReturnType<typeof useAiStore>
  classification: ReturnType<typeof useClassificationStore>
  root: ReturnType<typeof node>
} {
  const pinia = createPinia()
  const app = renderer.createApp(TransactionsFeedback).use(pinia)
  const root = node()
  app.mount(root)
  unmount = () => {
    app.unmount()
    unmount = () => {}
  }
  return { ai: useAiStore(pinia), classification: useClassificationStore(pinia), root }
}
function roles(root: ReturnType<typeof node>, role: string): ReturnType<typeof nodes> {
  return nodes(root).filter((n) => n.props.role === role)
}
function close(root: ReturnType<typeof node>): void {
  const button = nodes(root).find((n) => n.props['aria-label'] === 'Dismiss message')!
  ;(button.props.onClick as () => void)()
}
describe('Transactions feedback', () => {
  it('renders status immediately and dismisses after exactly five seconds', async () => {
    const { ai, root } = setup()
    ai.message = 'Done'
    await nextTick()
    expect(roles(root, 'status')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(4999)
    expect(ai.message).toBe('Done')
    await vi.advanceTimersByTimeAsync(1)
    expect(ai.message).toBeNull()
    expect(roles(root, 'status')).toHaveLength(0)
  })
  it('dismisses immediately and cancels its timer', async () => {
    const { ai, root } = setup()
    ai.message = 'Done'
    await nextTick()
    close(root)
    await nextTick()
    expect(ai.message).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('replaces older feedback and restarts the deadline for a new message', async () => {
    const { ai, classification, root } = setup()
    classification.message = 'Saved'
    await nextTick()
    await vi.advanceTimersByTimeAsync(4000)
    ai.message = 'AI finished'
    await nextTick()
    expect(roles(root, 'status')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(ai.message).toBe('AI finished')
    await vi.advanceTimersByTimeAsync(4000)
    expect(roles(root, 'status')).toHaveLength(0)
  })
  it('resets the timer when the same source reports newer feedback', async () => {
    const { ai } = setup()
    ai.message = 'First'
    await nextTick()
    await vi.advanceTimersByTimeAsync(4000)
    ai.message = 'Second'
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)
    expect(ai.message).toBe('Second')
    await vi.advanceTimersByTimeAsync(4000)
    expect(ai.message).toBeNull()
  })
  it('keeps accessible errors until manually dismissed', async () => {
    const { ai, root } = setup()
    ai.error = 'Provider failed'
    await nextTick()
    expect(roles(root, 'alert')[0]?.props['aria-live']).toBe('assertive')
    await vi.advanceTimersByTimeAsync(20000)
    expect(ai.error).toBe('Provider failed')
    close(root)
    await nextTick()
    expect(ai.error).toBeNull()
    expect(roles(root, 'alert')).toHaveLength(0)
  })
  it('does not duplicate or restart timers during unrelated store updates', async () => {
    const { ai } = setup()
    ai.message = 'Done'
    await nextTick()
    await vi.advanceTimersByTimeAsync(4000)
    ai.suggestions = []
    await nextTick()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(ai.message).toBeNull()
  })
  it('never times out active progress and starts the timer when work finishes', async () => {
    const { ai, root } = setup()
    ai.submitting = true
    ai.message = 'Classifying 3 transactions...'
    await nextTick()
    expect(roles(root, 'status')[0]?.props['aria-live']).toBe('polite')
    await vi.advanceTimersByTimeAsync(10000)
    expect(ai.message).toContain('Classifying')
    ai.message = '3 suggestions ready'
    ai.submitting = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(4999)
    expect(ai.message).toBe('3 suggestions ready')
    await vi.advanceTimersByTimeAsync(1)
    expect(ai.message).toBeNull()
  })
  it('clears pending timers on unmount', async () => {
    const { ai } = setup()
    ai.message = 'Saved'
    await nextTick()
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(ai.message).toBe('Saved')
  })
})
