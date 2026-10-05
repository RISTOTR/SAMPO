import { describe, expect, it } from 'vitest'
import { captureTransactionPosition, scrollPanelIntoContent } from '../presentation/content-scroll'
import { transactionReviewState, transactionReviewLabels } from '../presentation/transaction-review'
import type { TransactionRowDto } from '../../../shared/dtos'

type Classification = NonNullable<TransactionRowDto['classification']>
function classification(overrides: Partial<Classification> = {}): Classification {
  return {
    merchantId: 'merchant',
    categoryId: 'category',
    classificationSource: 'manual',
    classificationStatus: 'confirmed',
    usageType: 'unspecified',
    costBehaviour: 'unspecified',
    necessity: 'unspecified',
    ...overrides
  }
}

describe('transaction review presentation', () => {
  it('keeps fully confirmed rows neutral', () => {
    expect(transactionReviewState({ classification: classification() })).toBe('confirmed')
  })
  it.each(['needs_review', 'ambiguous'] as const)('marks %s rows for review', (status) => {
    expect(
      transactionReviewState({ classification: classification({ classificationStatus: status }) })
    ).toBe('needs-review')
  })
  it('marks missing classifications and partial confirmations without changing their status', () => {
    expect(transactionReviewState({})).toBe('unclassified')
    const partial = classification({ categoryId: undefined })
    expect(transactionReviewState({ classification: partial })).toBe('needs-review')
    expect(partial.classificationStatus).toBe('confirmed')
  })
  it('does not mistake detected DTO values for authoritative confirmed fields', () => {
    expect(
      transactionReviewState({
        classification: classification({
          merchantDisplay: { source: 'authoritative', authoritativeId: 'merchant' },
          categoryDisplay: {
            source: 'detected',
            detectedId: 'category',
            displayPath: ['Synthetic']
          }
        })
      })
    ).toBe('needs-review')
  })
  it('supplies meaningful accessible labels independent of column visibility', () => {
    expect(transactionReviewLabels.confirmed).toBe('Confirmed')
    expect(transactionReviewLabels['needs-review']).toBe('Needs confirmation')
    expect(transactionReviewLabels.unclassified).toContain('Unclassified')
  })
})

function scrollFixture(): {
  content: HTMLElement
  root: HTMLElement
  rows: { id: string; y: number }[]
} {
  const rows = [
    { id: 'a', y: 300 },
    { id: 'b', y: 400 },
    { id: 'c', y: 500 }
  ]
  const content = {
    scrollTop: 350,
    scrollHeight: 1800,
    clientHeight: 600,
    isConnected: true,
    getBoundingClientRect: () => ({ top: 0 })
  } as unknown as HTMLElement
  const root = {
    isConnected: true,
    closest: () => content,
    querySelectorAll: () =>
      rows.map((row) => ({
        dataset: { transactionRow: row.id },
        getBoundingClientRect: () => ({
          top: row.y - content.scrollTop,
          bottom: row.y + 100 - content.scrollTop
        })
      }))
  } as unknown as HTMLElement
  return { content, root, rows }
}

describe('main-content-only scrolling', () => {
  it('reveals a panel by moving only its owning content container', () => {
    const { content } = scrollFixture()
    const panel = {
      closest: () => content,
      getBoundingClientRect: () => ({ top: 400 })
    } as unknown as HTMLElement
    scrollPanelIntoContent(panel)
    expect(content.scrollTop).toBe(734)
  })
  it('preserves the visible row offset when content above it grows or shrinks', () => {
    const { content, root, rows } = scrollFixture()
    const restore = captureTransactionPosition(root)
    rows.forEach((row) => {
      row.y += 220
    })
    restore()
    expect(content.scrollTop).toBe(570)
    rows.forEach((row) => {
      row.y -= 300
    })
    restore()
    expect(content.scrollTop).toBe(270)
  })
  it('uses the nearest remaining row after filtering/pagination removes the anchor', () => {
    const { content, root, rows } = scrollFixture()
    const restore = captureTransactionPosition(root)
    rows.splice(0, 1)
    restore()
    expect(content.scrollTop).toBe(450)
  })
  it('clamps position when the table becomes empty or the content becomes shorter', () => {
    const { content, root, rows } = scrollFixture()
    const restore = captureTransactionPosition(root)
    rows.splice(0)
    Object.defineProperty(content, 'scrollHeight', { value: 650 })
    restore()
    expect(content.scrollTop).toBe(50)
  })
  it('does not scroll a removed route or absent panel', () => {
    const { content, root } = scrollFixture()
    const restore = captureTransactionPosition(root)
    Object.defineProperty(root, 'isConnected', { value: false })
    content.scrollTop = 0
    restore()
    expect(content.scrollTop).toBe(0)
    expect(() => {
      captureTransactionPosition(null)()
      scrollPanelIntoContent(null)
    }).not.toThrow()
  })
})
