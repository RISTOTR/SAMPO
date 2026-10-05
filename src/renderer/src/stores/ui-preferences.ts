import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { z } from 'zod'
import {
  defaultTransactionColumns,
  transactionColumns,
  type TransactionColumn
} from '../preferences/transaction-columns'

export const uiPreferenceKey = 'sampo.ui.v1'
const preferencesSchema = z.object({
  theme: z.enum(['light', 'dark']).optional().catch(undefined),
  sidebarCollapsed: z.boolean().optional().catch(undefined),
  aiPanelCollapsed: z.boolean().catch(false),
  columns: z.array(z.string()).optional().catch(undefined)
})

function readPreferences(): z.infer<typeof preferencesSchema> {
  try {
    return preferencesSchema.parse(JSON.parse(localStorage.getItem(uiPreferenceKey) ?? '{}'))
  } catch {
    return preferencesSchema.parse({})
  }
}

function mediaMatches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false
}

export const useUiPreferencesStore = defineStore('ui-preferences', () => {
  const saved = readPreferences()
  const theme = ref(
    saved.theme ?? (mediaMatches('(prefers-color-scheme: dark)') ? 'dark' : 'light')
  )
  const sidebarCollapsed = ref(saved.sidebarCollapsed ?? mediaMatches('(max-width: 1100px)'))
  const aiPanelCollapsed = ref(saved.aiPanelCollapsed)
  const validColumns = saved.columns?.filter((id): id is TransactionColumn =>
    transactionColumns.some((column) => column.id === id)
  )
  const columns = ref<TransactionColumn[]>(
    validColumns && (validColumns.length > 0 || saved.columns?.length === 0)
      ? [...new Set(validColumns)]
      : [...defaultTransactionColumns]
  )

  watch(
    theme,
    (value) => {
      if (typeof document !== 'undefined') document.documentElement.dataset.theme = value
    },
    { immediate: true, flush: 'sync' }
  )

  watch(
    [theme, sidebarCollapsed, aiPanelCollapsed, columns],
    () => {
      try {
        // Only presentation preferences belong here, never financial data or identifiers.
        localStorage.setItem(
          uiPreferenceKey,
          JSON.stringify({
            theme: theme.value,
            sidebarCollapsed: sidebarCollapsed.value,
            aiPanelCollapsed: aiPanelCollapsed.value,
            columns: columns.value
          })
        )
      } catch {
        // Unavailable storage must not prevent using the UI in this session.
      }
    },
    { deep: true, flush: 'sync' }
  )

  function toggleTheme(): void {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
  }
  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }
  function toggleAiPanel(): void {
    aiPanelCollapsed.value = !aiPanelCollapsed.value
  }
  function isColumnVisible(id: TransactionColumn): boolean {
    return columns.value.includes(id)
  }
  function toggleColumn(id: TransactionColumn): void {
    columns.value = isColumnVisible(id)
      ? columns.value.filter((column) => column !== id)
      : [...columns.value, id]
  }
  function resetColumns(): void {
    columns.value = [...defaultTransactionColumns]
  }
  function showAllColumns(): void {
    columns.value = transactionColumns.map((column) => column.id)
  }

  return {
    theme,
    sidebarCollapsed,
    aiPanelCollapsed,
    columns,
    toggleTheme,
    toggleSidebar,
    toggleAiPanel,
    isColumnVisible,
    toggleColumn,
    resetColumns,
    showAllColumns
  }
})
