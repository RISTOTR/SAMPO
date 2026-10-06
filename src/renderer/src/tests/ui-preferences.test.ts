import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from '../App.vue'
import TransactionColumns from '../components/TransactionColumns.vue'
import { uiPreferenceKey, useUiPreferencesStore } from '../stores/ui-preferences'
import { defaultTransactionColumns, transactionColumns } from '../preferences/transaction-columns'

let saved: Map<string, string>
beforeEach(() => {
  saved = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value)
  })
  vi.stubGlobal('document', { documentElement: { dataset: {} } })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

function reopen(): ReturnType<typeof useUiPreferencesStore> {
  setActivePinia(createPinia())
  return useUiPreferencesStore()
}

describe('renderer presentation preferences', () => {
  it('collapses and restores the sidebar, persisting both states', () => {
    const ui = useUiPreferencesStore()
    expect(ui.sidebarCollapsed).toBe(false)
    ui.toggleSidebar()
    const restored = reopen()
    expect(restored.sidebarCollapsed).toBe(true)
    restored.toggleSidebar()
    expect(reopen().sidebarCollapsed).toBe(false)
  })

  it('defaults to a rail on small windows and allows an explicit expanded preference', () => {
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({ matches: query.includes('max-width') })
    })
    const ui = useUiPreferencesStore()
    expect(ui.sidebarCollapsed).toBe(true)
    ui.toggleSidebar()
    expect(reopen().sidebarCollapsed).toBe(false)
  })

  it('uses OS theme initially and applies and persists an explicit override', () => {
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({ matches: query.includes('color-scheme') })
    })
    const ui = useUiPreferencesStore()
    expect(document.documentElement.dataset.theme).toBe('dark')
    ui.toggleTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(reopen().theme).toBe('light')
    expect(JSON.parse(saved.get(uiPreferenceKey)!)).toMatchObject({ theme: 'light' })
  })

  it('starts AI review expanded and remembers collapse/expand', () => {
    const ui = useUiPreferencesStore()
    expect(ui.aiPanelCollapsed).toBe(false)
    ui.toggleAiPanel()
    const restored = reopen()
    expect(restored.aiPanelCollapsed).toBe(true)
    restored.toggleAiPanel()
    expect(reopen().aiPanelCollapsed).toBe(false)
  })

  it('uses exactly the requested default columns, enables optional columns and resets', () => {
    const ui = useUiPreferencesStore()
    expect(
      transactionColumns
        .filter((column) => ui.isColumnVisible(column.id))
        .map((column) => column.label)
    ).toEqual([
      'Date',
      'Description',
      'Account',
      'Merchant',
      'Category',
      'Class status',
      'Recurring',
      'Actions'
    ])
    ui.toggleColumn('amount')
    ui.toggleColumn('type')
    const restored = reopen()
    expect(restored.isColumnVisible('amount')).toBe(true)
    expect(restored.isColumnVisible('type')).toBe(true)
    restored.showAllColumns()
    expect(restored.columns).toHaveLength(transactionColumns.length)
    restored.resetColumns()
    expect(reopen().columns).toEqual(defaultTransactionColumns)
  })

  it.each(['not-json', 'null', '{"columns":["removed"]}', '{"columns":42}'])(
    'falls back safely for invalid stored preferences: %s',
    (value) => {
      saved.set(uiPreferenceKey, value)
      expect(useUiPreferencesStore().columns).toEqual(defaultTransactionColumns)
    }
  )

  it('retains valid column choices while ignoring retired keys and duplicates', () => {
    saved.set(uiPreferenceKey, JSON.stringify({ columns: ['date', 'amount', 'retired', 'amount'] }))
    expect(useUiPreferencesStore().columns).toEqual(['date', 'amount'])
  })

  it('continues to work when localStorage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    })
    const ui = useUiPreferencesStore()
    expect(() => {
      ui.toggleTheme()
      ui.toggleSidebar()
      ui.toggleColumn('amount')
    }).not.toThrow()
    expect(ui.isColumnVisible('amount')).toBe(true)
  })

  it('renders accessible shell controls and labelled routes in both sidebar states', async () => {
    const pinia = createPinia()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { render: () => null } }]
    })
    await router.push('/')
    await router.isReady()
    const app = createSSRApp(App).use(pinia).use(router)
    const ui = useUiPreferencesStore(pinia)
    expect(await renderToString(app)).toContain('aria-label="Collapse sidebar"')
    ui.toggleSidebar()
    ui.toggleTheme()
    const html = await renderToString(app)
    expect(html).toContain('aria-label="Expand sidebar"')
    expect(html).toContain('aria-label="Switch to light mode"')
    expect(html).toContain('title="Transactions" aria-label="Transactions"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('<main class="content" data-main-scroll>')
    ui.toggleSidebar()
    expect(await renderToString(app)).toContain('Local-first personal finance')
  })

  it('renders a native keyboard-accessible column disclosure with labelled checkboxes', async () => {
    const html = await renderToString(createSSRApp(TransactionColumns).use(createPinia()))
    expect(html).toContain('<summary>Columns</summary>')
    expect(html).toContain('role="group" aria-label="Visible transaction columns"')
    expect(html).toContain('Reset to default')
    expect(html).toContain('Show all')
    expect(html.match(/type="checkbox"/g)).toHaveLength(transactionColumns.length)
  })
})
