import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const recurringView = readFileSync('src/renderer/src/views/SubscriptionsView.vue', 'utf8')
const recurringStore = readFileSync('src/renderer/src/stores/recurring.ts', 'utf8')
const manualRecurringForm = readFileSync(
  'src/renderer/src/components/ManualRecurringForm.vue',
  'utf8'
)
const transactionsView = readFileSync('src/renderer/src/views/TransactionsView.vue', 'utf8')
const appShell = readFileSync('src/renderer/src/App.vue', 'utf8')
const router = readFileSync('src/renderer/src/router/index.ts', 'utf8')
const preload = readFileSync('src/preload/index.ts', 'utf8')
const ipc = readFileSync('src/shared/ipc.ts', 'utf8')

describe('recurring renderer contract', () => {
  it('adds Recurring navigation and IPC methods', () => {
    expect(appShell).toContain("{ path: '/recurring', label: 'Recurring' }")
    expect(router).toContain("{ path: '/recurring', name: 'recurring'")
    expect(ipc).toContain("recurringScan: 'sampo:recurring:scan'")
    expect(ipc).toContain("recurringPreviewManual: 'sampo:recurring:preview-manual'")
    expect(ipc).toContain("recurringCreateManual: 'sampo:recurring:create-manual'")
    expect(ipc).toContain("recurringUpdate: 'sampo:recurring:update'")
    expect(ipc).toContain("recurringDelete: 'sampo:recurring:delete'")
    expect(preload).toContain('recurring: {')
    expect(preload).toContain('scan: () => ipcRenderer.invoke(IPC_CHANNELS.recurringScan)')
    expect(preload).toContain('previewManual: (input) =>')
    expect(preload).toContain('createManual: (input) =>')
    expect(preload).toContain('update: (input) =>')
    expect(preload).toContain('delete: (input) =>')
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

  it('supports editing and deleting recurring series', () => {
    expect(recurringView).toContain('Edit recurring series')
    expect(recurringView).toContain('openEdit(series)')
    expect(recurringView).toContain('editPanel.value?.scrollIntoView')
    expect(recurringView).toContain('@click.stop="openEdit(series)"')
    expect(recurringView).toContain('deleteSeries(series.id)')
    expect(recurringView).toContain('recurring.update')
    expect(recurringView).toContain('recurring.deleteSeries')
    expect(recurringStore).toContain('window.sampo.recurring.update')
    expect(recurringStore).toContain('window.sampo.recurring.delete')
  })

  it('exposes manual recurring creation from recurring and transactions views', () => {
    expect(recurringView).toContain('+ Add recurring payment')
    expect(recurringView).toContain('ManualRecurringForm')
    expect(transactionsView).toContain('Mark as recurring')
    expect(transactionsView).toContain('Edit recurring')
    expect(transactionsView).toContain('openRecurringCreator(transaction.id)')
    expect(transactionsView).toContain(':transaction-id="recurringTransactionId"')
  })

  it('shows already marked recurring transactions in lists', () => {
    expect(recurringView).toContain('series.occurrenceCount')
    expect(recurringView).toContain('transactions ·')
    expect(recurringView).toContain('recurring.selected.source')
    expect(transactionsView).toContain('<th>Recurring</th>')
    expect(transactionsView).toContain('transaction.recurring.displayName')
    expect(transactionsView).toContain('transaction.recurring.cadence')
    expect(transactionsView).toContain('Not recurring')
  })

  it('lets users review matches and select type and cadence before manual save', () => {
    expect(manualRecurringForm).toContain('matchingTransactionCount')
    expect(manualRecurringForm).toContain('matching historical transactions')
    expect(manualRecurringForm).toContain('value="subscription"')
    expect(manualRecurringForm).toContain('value="recurring_bill"')
    expect(manualRecurringForm).toContain('value="recurring_payment"')
    expect(manualRecurringForm).toContain('value="monthly"')
    expect(manualRecurringForm).toContain('value="quarterly"')
    expect(manualRecurringForm).toContain('value="yearly"')
    expect(manualRecurringForm).toContain('value="irregular"')
    expect(manualRecurringForm).toContain('recurring.createManual')
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
