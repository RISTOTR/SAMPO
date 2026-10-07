import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { nextTick } from 'vue'
import { readFileSync } from 'fs'
import DashboardView from '../views/DashboardView.vue'
import MonthlyTrend from '../components/dashboard/MonthlyTrend.vue'
import CategorySpending from '../components/dashboard/CategorySpending.vue'
import { comparisonLabel, trendMonths, visibleCategories } from '../presentation/dashboard'
import { useDashboardStore } from '../stores/dashboard'
import { formatCents } from '../formatters'
import { dashboardFixture } from './helpers/dashboard-fixture'
import { node, nodes, renderer, type TestNode } from './helpers/render-host'
const push = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
let unmount = (): void => {}
afterEach(() => {
  unmount()
  push.mockReset()
  vi.unstubAllGlobals()
})
const text = (root: TestNode): string =>
  nodes(root)
    .map((n) => n.text)
    .join(' ')
const click = (root: TestNode, label: string): void => {
  const button = nodes(root).find((n) => n.tag === 'button' && text(n).includes(label))
  expect(button, label).toBeDefined()
  ;(button!.props.onClick as () => void)()
}
async function mountDashboard(data = dashboardFixture()): Promise<TestNode> {
  vi.stubGlobal('window', {
    sampo: { dashboard: { get: vi.fn().mockResolvedValue({ ok: true, data }) } }
  })
  const app = renderer.createApp(DashboardView).use(createPinia())
  const root = node()
  app.mount(root)
  unmount = () => app.unmount()
  await Promise.resolve()
  await nextTick()
  await nextTick()
  return root
}
describe('Dashboard presentation', () => {
  it('renders supplied summary and confirmed recurring aggregates without recalculating totals', async () => {
    const fixture = dashboardFixture()
    const root = await mountDashboard(fixture)
    for (const metric of [
      fixture.totalSpending,
      fixture.totalIncome,
      fixture.netCashFlow,
      fixture.recurringSpending
    ])
      expect(text(root)).toContain(formatCents(metric.amountCents))
    expect(text(root)).toContain('Confirmed series only')
    expect(text(root)).toContain(formatCents(fixture.recurring.recurringBillCents))
    expect(text(root)).toContain('Full date ranges are compared')
  })
  it('drills category, merchant, confirmation, unclassified, and reconciliation actions to their destinations', async () => {
    const root = await mountDashboard()
    const dates = { dateFrom: '2026-07-01', dateTo: '2026-09-30' }
    click(root, 'Housing / Rent')
    expect(push).toHaveBeenLastCalledWith({
      path: '/transactions',
      query: { ...dates, categoryId: dashboardFixture().categories[0]!.categoryId }
    })
    click(root, 'Synthetic Market')
    expect(push).toHaveBeenLastCalledWith({
      path: '/transactions',
      query: { ...dates, merchantId: dashboardFixture().merchants[0]!.merchantId }
    })
    click(root, 'Needs confirmation')
    expect(push).toHaveBeenLastCalledWith({
      path: '/transactions',
      query: { ...dates, confirmationFilter: 'needs_confirmation' }
    })
    click(root, 'Unclassified spending')
    expect(push).toHaveBeenLastCalledWith({
      path: '/transactions',
      query: { ...dates, unclassifiedOnly: 'true' }
    })
    click(root, 'Unreconciled settlements')
    expect(push).toHaveBeenLastCalledWith({ path: '/imports', hash: '#reconciliation-review' })
    click(root, 'Review recurring series')
    expect(push).toHaveBeenLastCalledWith('/recurring')
  })
  it('shows no-import and no-comparison states without invented comparisons', async () => {
    const fixture = dashboardFixture()
    fixture.hasData = false
    const root = await mountDashboard(fixture)
    expect(text(root)).toContain('No transactions in this period')
    expect(text(root)).not.toContain('Monthly trend')
  })
  it('does not show a misleading recurring delta or comparison with absent imports', async () => {
    const fixture = dashboardFixture()
    fixture.period.previousTransactionCount = 0
    const root = await mountDashboard(fixture)
    expect(text(root)).toContain('No imported comparison data')
    expect(text(root)).not.toContain('5.6%')
  })
  it('sorts categories and keeps Unclassified visible beyond the top five', async () => {
    const base = dashboardFixture().categories[0]!
    const categories = Array.from({ length: 8 }, (_, i) => ({
      ...base,
      categoryId: String(i),
      label: `Category ${i}`,
      amountCents: (i + 1) * 100
    }))
    categories.push({ ...base, categoryId: undefined!, label: 'Unclassified', amountCents: 1 })
    expect(visibleCategories(categories, false).map((row) => row.amountCents)).toEqual([
      800, 700, 600, 500, 400, 1
    ])
    const root = node()
    const app = renderer.createApp(CategorySpending, { categories, hasComparison: true })
    app.mount(root)
    unmount = () => app.unmount()
    expect(text(root)).toContain('Unclassified')
    click(root, 'Show all')
    await nextTick()
    expect(nodes(root).filter((n) => n.props.class === 'category-bar-row')).toHaveLength(9)
  })
  it('renders supplied monthly values, negative amounts, zero-height zero bars, and keyboard actions', () => {
    const fixture = dashboardFixture()
    fixture.monthlyTrend[0]!.spendingCents = -1234
    fixture.monthlyTrend[0]!.incomeCents = 0
    const openMonth = vi.fn()
    const root = node()
    const app = renderer.createApp(MonthlyTrend, {
      months: fixture.monthlyTrend,
      period: fixture.period,
      onOpenMonth: openMonth
    })
    app.mount(root)
    unmount = () => app.unmount()
    expect(text(root)).toContain(formatCents(-1234))
    expect(text(root)).toContain(formatCents(200000))
    const zero = nodes(root).find((n) => n.props.class === 'income-bar')!
    expect(zero.props.height).toBe(0)
    const button = nodes(root).find((n) => n.props.role === 'button')!
    ;(button.props.onKeydown as ((event: unknown) => void)[])[0]!({
      key: 'Enter',
      preventDefault: () => {}
    })
    expect(openMonth).toHaveBeenCalledWith('2026-07')
  })
  it('represents missing months explicitly and handles one month and empty charts', () => {
    const fixture = dashboardFixture()
    expect(trendMonths([fixture.monthlyTrend[0]!], '2026-07-01', '2026-09-30')[1]).toEqual({
      month: '2026-08',
      values: undefined
    })
    const root = node()
    const app = renderer.createApp(MonthlyTrend, {
      months: [fixture.monthlyTrend[0]!],
      period: { ...fixture.period, dateTo: '2026-07-31' }
    })
    app.mount(root)
    expect(text(root)).toContain('One month selected')
    app.unmount()
    const empty = renderer.createApp(MonthlyTrend, { months: [], period: fixture.period })
    empty.mount(root)
    unmount = () => empty.unmount()
    expect(text(root)).toContain('No monthly activity')
    expect(nodes(root).some((n) => n.tag === 'svg')).toBe(false)
  })
  it('explains all-zero monthly aggregates without empty axes', () => {
    const fixture = dashboardFixture()
    const root = node()
    const app = renderer.createApp(MonthlyTrend, {
      months: [
        {
          ...fixture.monthlyTrend[0]!,
          spendingCents: 0,
          incomeCents: 0,
          netCashFlowCents: 0,
          recurringSpendCents: 0
        }
      ],
      period: fixture.period
    })
    app.mount(root)
    unmount = () => app.unmount()
    expect(text(root)).toContain('No spending or income in this period')
    expect(nodes(root).some((n) => n.tag === 'svg')).toBe(false)
  })
  it('uses theme tokens and responsive grids without raw transaction aggregation', () => {
    const css = readFileSync('src/renderer/src/assets/main.css', 'utf8')
    expect(css).toMatch(/\.spending-bar\s*\{\s*fill: var\(--accent\)/)
    expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(css).toContain('@media (max-width: 900px)')
    const view = readFileSync('src/renderer/src/views/DashboardView.vue', 'utf8')
    expect(view).not.toMatch(/transactions\.list|amount_cents|SELECT |\.reduce\(/)
    expect(comparisonLabel(10000)).not.toContain('%')
  })
  it('does not let an older period request overwrite the newer selection', async () => {
    let resolveFirst!: (value: unknown) => void
    const fixture = dashboardFixture()
    const get = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockResolvedValueOnce({ ok: true, data: fixture })
    vi.stubGlobal('window', { sampo: { dashboard: { get } } })
    const store = useDashboardStore(createPinia())
    const first = store.load()
    await store.load({ preset: 'last_3_months' })
    resolveFirst({ ok: true, data: { ...fixture, hasData: false } })
    await first
    expect(store.data?.hasData).toBe(true)
  })
})
