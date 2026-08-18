import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const recurringView = readFileSync('src/renderer/src/views/SubscriptionsView.vue', 'utf8')
const recurringStore = readFileSync('src/renderer/src/stores/recurring.ts', 'utf8')
const appShell = readFileSync('src/renderer/src/App.vue', 'utf8')
const router = readFileSync('src/renderer/src/router/index.ts', 'utf8')
const preload = readFileSync('src/preload/index.ts', 'utf8')
const ipc = readFileSync('src/shared/ipc.ts', 'utf8')

describe('recurring renderer contract', () => {
  it('adds Recurring navigation and IPC methods', () => {
    expect(appShell).toContain("{ path: '/recurring', label: 'Recurring' }")
    expect(router).toContain("{ path: '/recurring', name: 'recurring'")
    expect(ipc).toContain("recurringScan: 'sampo:recurring:scan'")
    expect(preload).toContain('recurring: {')
    expect(preload).toContain('scan: () => ipcRenderer.invoke(IPC_CHANNELS.recurringScan)')
  })

  it('renders candidate and confirmed sections', () => {
    expect(recurringView).toContain('Recurring payments')
    expect(recurringView).toContain('Confirmed')
    expect(recurringView).toContain('Candidates')
    expect(recurringView).toContain("series.status === 'candidate'")
    expect(recurringView).toContain("series.status === 'confirmed'")
  })

  it('supports scan, confirmation, and rejection actions', () => {
    expect(recurringView).toContain('Scan for recurring payments')
    expect(recurringView).toContain("recurring.confirm(series.id, 'subscription')")
    expect(recurringView).toContain("recurring.confirm(series.id, 'recurring_bill')")
    expect(recurringView).toContain("recurring.confirm(series.id, 'recurring_payment')")
    expect(recurringView).toContain('recurring.reject(series.id)')
    expect(recurringStore).toContain('window.sampo.recurring.scan()')
    expect(recurringStore).toContain('window.sampo.recurring.confirm')
    expect(recurringStore).toContain('window.sampo.recurring.reject')
  })

  it('shows series details and linked occurrences', () => {
    expect(recurringView).toContain('recurring.selected')
    expect(recurringView).toContain('occurrence in recurring.selected.occurrences')
    expect(recurringView).toContain('occurrence.transactionDate')
    expect(recurringView).toContain('occurrence.description')
    expect(recurringView).toContain('occurrence.categoryPath')
    expect(recurringStore).toContain('window.sampo.recurring.get(seriesId)')
  })

  it('keeps empty state visible', () => {
    expect(recurringView).toContain('No recurring series confirmed yet.')
    expect(recurringView).toContain('No recurring candidates.')
  })
})
