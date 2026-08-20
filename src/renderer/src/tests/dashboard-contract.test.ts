import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const appShell = readFileSync('src/renderer/src/App.vue', 'utf8')
const router = readFileSync('src/renderer/src/router/index.ts', 'utf8')
const dashboardView = readFileSync('src/renderer/src/views/DashboardView.vue', 'utf8')
const dashboardStore = readFileSync('src/renderer/src/stores/dashboard.ts', 'utf8')
const transactionsView = readFileSync('src/renderer/src/views/TransactionsView.vue', 'utf8')
const preload = readFileSync('src/preload/index.ts', 'utf8')
const ipc = readFileSync('src/shared/ipc.ts', 'utf8')

describe('dashboard renderer contract', () => {
  it('adds dashboard navigation, route, preload, and IPC', () => {
    expect(appShell).toContain("{ path: '/', label: 'Dashboard' }")
    expect(router).toContain("{ path: '/', name: 'dashboard'")
    expect(preload).toContain('dashboard: {')
    expect(preload).toContain(
      'get: (query) => ipcRenderer.invoke(IPC_CHANNELS.dashboardGet, query)'
    )
    expect(ipc).toContain("dashboardGet: 'sampo:dashboard:get'")
    expect(dashboardStore).toContain('window.sampo.dashboard.get(query)')
  })

  it('renders required dashboard sections and period selector', () => {
    expect(dashboardView).toContain('Latest imported month')
    expect(dashboardView).toContain('Spending by category')
    expect(dashboardView).toContain('Top merchants')
    expect(dashboardView).toContain('Monthly trend')
    expect(dashboardView).toContain('Biggest changes')
    expect(dashboardView).toContain('Recurring spending')
    expect(dashboardView).toContain('Data quality')
  })

  it('drills down through transactions route query filters', () => {
    expect(dashboardView).toContain("path: '/transactions'")
    expect(dashboardView).toContain('categoryId')
    expect(dashboardView).toContain('merchantId')
    expect(dashboardView).toContain("confirmationFilter: 'needs_confirmation'")
    expect(transactionsView).toContain('applyRouteQueryFilters()')
    expect(transactionsView).toContain('queryString(route.query.categoryId)')
    expect(transactionsView).toContain('queryString(route.query.merchantId)')
  })
})
