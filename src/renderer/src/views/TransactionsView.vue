<script setup lang="ts">
import { captureTransactionPosition, scrollPanelIntoContent } from '../presentation/content-scroll'
import {
  transactionReviewState,
  transactionReviewLabels,
  transactionReviewIcons
} from '../presentation/transaction-review'
import TransactionColumns from '../components/TransactionColumns.vue'
import { useUiPreferencesStore } from '../stores/ui-preferences'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { formatCents, formatDate } from '../formatters'
import { useAccountsStore } from '../stores/accounts'
import { useAiStore } from '../stores/ai'
import { useClassificationStore } from '../stores/classification'
import { useRecurringStore } from '../stores/recurring'
import { useTransactionsStore } from '../stores/transactions'
import type { AiSuggestionDto, TransactionListQueryDto } from '../../../shared/dtos'
import ManualRecurringForm from '../components/ManualRecurringForm.vue'

const viewRoot = ref<HTMLElement | null>(null)
let returnFromEditor: (() => void) | undefined
let returnFromRecurring: (() => void) | undefined
const ui = useUiPreferencesStore()
const accounts = useAccountsStore()
const ai = useAiStore()
const classification = useClassificationStore()
const recurring = useRecurringStore()
const transactions = useTransactionsStore()
const route = useRoute()
watch(
  [
    () => transactions.page.items,
    () => ai.suggestions,
    () => ui.aiPanelCollapsed,
    () => ui.sidebarCollapsed
  ],
  () => {
    const restore = captureTransactionPosition(viewRoot.value)
    void nextTick(restore)
  },
  { flush: 'pre' }
)

const filters = reactive({
  search: '',
  confirmationFilter: 'all' as 'all' | 'needs_confirmation' | 'confirmed',
  accountId: '',
  dateFrom: '',
  dateTo: '',
  transactionType: '',
  pending: '',
  excludedFromSpending: '',
  categoryId: '',
  merchantId: '',
  usageType: '',
  costBehaviour: '',
  necessity: '',
  classificationStatus: '',
  unclassifiedOnly: false,
  sortBy: 'transactionDate' as 'transactionDate' | 'amount',
  sortDirection: 'desc' as 'asc' | 'desc',
  offset: 0
})
const selectedTransactionIds = ref<string[]>([])
const editorTransactionId = ref<string | null>(null)
const recurringTransactionId = ref<string | null>(null)
const editorPanel = ref<HTMLElement | null>(null)
const recurringPanel = ref<HTMLElement | null>(null)
const newMerchantName = ref('')
const manualForm = reactive({
  merchantId: '',
  categoryId: '',
  usageType: 'unspecified',
  costBehaviour: 'unspecified',
  necessity: 'unspecified'
})
const bulkForm = reactive({
  categoryId: '',
  usageType: '',
  costBehaviour: '',
  necessity: ''
})
let filterReloadTimer: ReturnType<typeof setTimeout> | undefined
let suppressFilterReload = false

const currentPage = computed(
  () => Math.floor(transactions.page.offset / transactions.page.limit) + 1
)
const totalPages = computed(() =>
  Math.max(1, Math.ceil(transactions.page.total / transactions.page.limit))
)

const editorMerchantOptions = computed(() => {
  const options = classification.merchants.map((merchant) => ({
    id: merchant.id,
    name: merchant.name
  }))
  const currentId = classification.current?.merchantId
  const currentName = classification.current?.merchantName

  if (currentId && currentName && !options.some((merchant) => merchant.id === currentId)) {
    options.push({ id: currentId, name: currentName })
  }

  return options
})

const editorTransaction = computed(() =>
  editorTransactionId.value
    ? transactions.page.items.find((transaction) => transaction.id === editorTransactionId.value)
    : undefined
)

const editorSuggestion = computed(() =>
  editorTransactionId.value ? aiSuggestionFor(editorTransactionId.value) : undefined
)

watch(
  () => [
    filters.search,
    filters.confirmationFilter,
    filters.accountId,
    filters.dateFrom,
    filters.dateTo,
    filters.transactionType,
    filters.pending,
    filters.excludedFromSpending,
    filters.categoryId,
    filters.merchantId,
    filters.usageType,
    filters.costBehaviour,
    filters.necessity,
    filters.classificationStatus,
    filters.unclassifiedOnly,
    filters.sortBy,
    filters.sortDirection
  ],
  () => scheduleFilterReload()
)

watch(
  () => route.query,
  async () => {
    applyRouteQueryFilters()
    await loadTransactions()
  }
)

onMounted(async () => {
  await Promise.all([accounts.load(), classification.loadReference(), ai.loadSettings()])
  applyRouteQueryFilters()
  await loadTransactions()
})

onBeforeUnmount(() => {
  if (filterReloadTimer) clearTimeout(filterReloadTimer)
})

function currentTransactionQuery(): TransactionListQueryDto {
  const transactionType = filters.transactionType
    ? (filters.transactionType as NonNullable<TransactionListQueryDto['transactionType']>)
    : undefined

  return {
    search: filters.search.trim() || undefined,
    confirmationFilter: filters.confirmationFilter,
    accountId: filters.accountId || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    transactionType,
    pending: filters.pending === '' ? undefined : filters.pending === 'true',
    excludedFromSpending:
      filters.excludedFromSpending === '' ? undefined : filters.excludedFromSpending === 'true',
    categoryId: filters.categoryId || undefined,
    merchantId: filters.merchantId || undefined,
    usageType: filters.usageType
      ? (filters.usageType as NonNullable<TransactionListQueryDto['usageType']>)
      : undefined,
    costBehaviour: filters.costBehaviour
      ? (filters.costBehaviour as NonNullable<TransactionListQueryDto['costBehaviour']>)
      : undefined,
    necessity: filters.necessity
      ? (filters.necessity as NonNullable<TransactionListQueryDto['necessity']>)
      : undefined,
    classificationStatus: filters.classificationStatus
      ? (filters.classificationStatus as NonNullable<
          TransactionListQueryDto['classificationStatus']
        >)
      : undefined,
    unclassifiedOnly: filters.unclassifiedOnly || undefined,
    sortBy: filters.sortBy,
    sortDirection: filters.sortDirection,
    limit: 50,
    offset: filters.offset
  }
}

function applyRouteQueryFilters(): void {
  filters.search = queryString(route.query.search)
  filters.confirmationFilter =
    queryString(route.query.confirmationFilter) === 'needs_confirmation'
      ? 'needs_confirmation'
      : queryString(route.query.confirmationFilter) === 'confirmed'
        ? 'confirmed'
        : 'all'
  filters.dateFrom = queryString(route.query.dateFrom)
  filters.dateTo = queryString(route.query.dateTo)
  filters.categoryId = queryString(route.query.categoryId)
  filters.merchantId = queryString(route.query.merchantId)
  filters.unclassifiedOnly = queryString(route.query.unclassifiedOnly) === 'true'
  filters.offset = 0
}

function queryString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function currentSuggestionTransactionQuery(
  transactionQuery = currentTransactionQuery()
): NonNullable<Parameters<typeof ai.loadSuggestions>[0]>['transactionQuery'] {
  const query = { ...transactionQuery }
  delete query.limit
  delete query.offset
  return query
}

function aiSuggestionFor(transactionId: string): AiSuggestionDto | undefined {
  return ai.suggestions.find((suggestion) => suggestion.transactionId === transactionId)
}

function suggestionChangeLabels(suggestion: AiSuggestionDto): string {
  return [
    suggestion.suggestedMerchantName ? 'Merchant' : undefined,
    suggestion.suggestedCategoryId ? 'Category' : undefined
  ]
    .filter(Boolean)
    .join(' + ')
}

function suggestionCurrentValue(suggestion: AiSuggestionDto): string {
  return [
    suggestion.suggestedMerchantName
      ? `Merchant: ${suggestion.currentMerchantName ?? 'Unassigned'}`
      : undefined,
    suggestion.suggestedCategoryId
      ? `Category: ${suggestion.currentCategoryPath?.join(' / ') ?? 'Unclassified'}`
      : undefined
  ]
    .filter(Boolean)
    .join(' | ')
}

function suggestionAiValue(suggestion: AiSuggestionDto): string {
  return [
    suggestion.suggestedMerchantName ? `Merchant: ${suggestion.suggestedMerchantName}` : undefined,
    suggestion.suggestedCategoryPath
      ? `Category: ${suggestion.suggestedCategoryPath.join(' / ')}`
      : undefined
  ]
    .filter(Boolean)
    .join(' | ')
}

function suggestionConfidence(suggestion: AiSuggestionDto): string {
  return [
    suggestion.suggestedMerchantName ? `Merchant ${suggestion.merchantConfidenceBand}` : undefined,
    suggestion.suggestedCategoryId ? `Category ${suggestion.categoryConfidenceBand}` : undefined
  ]
    .filter(Boolean)
    .join(' | ')
}

async function handleMerchantChange(): Promise<void> {
  newMerchantName.value = ''
  await refreshMatchingSummary()
}

async function loadTransactions(): Promise<void> {
  const transactionQuery = currentTransactionQuery()
  const suggestionInput = currentSuggestionListInput(
    currentSuggestionTransactionQuery(transactionQuery)
  )
  await transactions.load(transactionQuery)
  await ai.loadSuggestions(suggestionInput)
}

async function loadAiSuggestions(): Promise<void> {
  await ai.loadSuggestions(currentSuggestionListInput())
}

function scheduleFilterReload(): void {
  if (suppressFilterReload) return
  if (filterReloadTimer) clearTimeout(filterReloadTimer)
  filterReloadTimer = setTimeout(() => {
    void applyFilters()
  }, 150)
}

async function applyFilters(): Promise<void> {
  if (filterReloadTimer) {
    clearTimeout(filterReloadTimer)
    filterReloadTimer = undefined
  }
  filters.offset = 0
  selectedTransactionIds.value = []
  await loadTransactions()
}

async function resetFilters(): Promise<void> {
  suppressFilterReload = true
  filters.search = ''
  filters.confirmationFilter = 'all'
  filters.accountId = ''
  filters.dateFrom = ''
  filters.dateTo = ''
  filters.transactionType = ''
  filters.pending = ''
  filters.excludedFromSpending = ''
  filters.categoryId = ''
  filters.merchantId = ''
  filters.usageType = ''
  filters.costBehaviour = ''
  filters.necessity = ''
  filters.classificationStatus = ''
  filters.unclassifiedOnly = false
  filters.sortBy = 'transactionDate'
  filters.sortDirection = 'desc'
  filters.offset = 0
  selectedTransactionIds.value = []
  suppressFilterReload = false
  await applyFilters()
}

async function nextPage(): Promise<void> {
  filters.offset += transactions.page.limit
  await loadTransactions()
}

async function previousPage(): Promise<void> {
  filters.offset = Math.max(0, filters.offset - transactions.page.limit)
  await loadTransactions()
}

async function openEditor(transactionId: string): Promise<void> {
  if (!editorTransactionId.value) returnFromEditor = captureTransactionPosition(viewRoot.value)
  logTransactionsDiagnostic('edit clicked', { transactionIdPresent: Boolean(transactionId) })
  const row = transactions.page.items.find((item) => item.id === transactionId)

  logTransactionsDiagnostic('editor row snapshot', {
    rowFound: Boolean(row),
    rowMerchantIdPresent: Boolean(row?.classification?.merchantId),
    rowMerchantDisplayNamePresent: Boolean(row?.classification?.merchantDisplay?.displayName),
    rowMerchantSource: row?.classification?.merchantDisplay?.source ?? 'missing',
    rowAuthoritativeMerchantIdPresent: Boolean(
      row?.classification?.merchantDisplay?.authoritativeId
    )
  })
  try {
    await Promise.all([
      classification.loadClassification(transactionId),
      classification.loadReference()
    ])
    editorTransactionId.value = transactionId
    manualForm.merchantId =
      classification.current?.merchantDisplay?.authoritativeId ??
      classification.current?.merchantId ??
      ''
    const suggestion = aiSuggestionFor(transactionId)
    manualForm.categoryId =
      classification.current?.categoryDisplay?.authoritativeId ??
      classification.current?.categoryDisplay?.detectedId ??
      classification.current?.categoryId ??
      suggestion?.suggestedCategoryId ??
      ''
    manualForm.usageType = classification.current?.usageType ?? 'unspecified'
    manualForm.costBehaviour = classification.current?.costBehaviour ?? 'unspecified'
    manualForm.necessity = classification.current?.necessity ?? 'unspecified'
    newMerchantName.value = ''
    await refreshMatchingSummary()
    logTransactionsDiagnostic('editor state set', {
      transactionLoaded: Boolean(classification.current),

      merchantIdPresent: Boolean(manualForm.merchantId),
      merchantNamePresent: Boolean(classification.current?.merchantName),
      merchantDisplayNamePresent: Boolean(classification.current?.merchantDisplay?.displayName),
      merchantDisplaySource: classification.current?.merchantDisplay?.source ?? 'missing',
      authoritativeMerchantIdPresent: Boolean(
        classification.current?.merchantDisplay?.authoritativeId
      ),

      merchantOptionPresent:
        !manualForm.merchantId ||
        editorMerchantOptions.value.some((merchant) => merchant.id === manualForm.merchantId),

      merchantOptionCount: editorMerchantOptions.value.length
    })
    await nextTick()
    scrollPanelIntoContent(editorPanel.value)
  } catch {
    editorTransactionId.value = null
    classification.error = 'Transaction could not be loaded.'
  }
}

async function openRecurringCreator(transactionId: string): Promise<void> {
  returnFromRecurring = captureTransactionPosition(viewRoot.value)
  recurringTransactionId.value = transactionId
  await nextTick()
  scrollPanelIntoContent(recurringPanel.value)
}

async function saveManual(): Promise<void> {
  if (!editorTransactionId.value) return
  await classification.saveManual(editorClassificationInput())
  if (classification.error) return

  closeEditor()
  await classification.loadReference()
  await loadTransactions()
}

async function saveManualAndConfirmMatches(): Promise<void> {
  if (!editorTransactionId.value) return
  const result = await classification.saveManualAndConfirmMatches(editorClassificationInput())
  if (classification.error || !result) return

  closeEditor()
  await classification.loadReference()
  await loadTransactions()
}

function closeEditor(): void {
  if (returnFromEditor) void nextTick(returnFromEditor)
  returnFromEditor = undefined
  const transactionId = editorTransactionId.value
  editorTransactionId.value = null
  newMerchantName.value = ''

  if (!transactionId) return
  selectedTransactionIds.value = selectedTransactionIds.value.filter((id) => id !== transactionId)
}

function closeRecurringCreator(): void {
  if (returnFromRecurring) void nextTick(returnFromRecurring)
  returnFromRecurring = undefined
  recurringTransactionId.value = null
  recurring.clearManualPreview()
}

async function refreshMatchingSummary(): Promise<void> {
  if (!editorTransactionId.value) return
  await classification.loadMatchingSummary(editorClassificationInput())
}

function editorClassificationInput(): Parameters<typeof classification.saveManual>[0] {
  if (!editorTransactionId.value) {
    throw new Error('Classification editor is not open')
  }

  return {
    transactionId: editorTransactionId.value,
    merchantId: manualForm.merchantId || undefined,
    merchantName:
      manualForm.merchantId || !newMerchantName.value.trim()
        ? undefined
        : newMerchantName.value.trim(),
    categoryId: manualForm.categoryId || undefined,
    usageType: manualForm.usageType as never,
    costBehaviour: manualForm.costBehaviour as never,
    necessity: manualForm.necessity as never
  }
}

function useTransactionDescriptionAsMerchant(): void {
  const description = editorTransaction.value?.description
  if (!description) return
  manualForm.merchantId = ''
  newMerchantName.value = description
  void refreshMatchingSummary()
}

function useAiMerchantSuggestion(): void {
  const merchantName = editorSuggestion.value?.suggestedMerchantName
  if (!merchantName) return
  manualForm.merchantId = ''
  newMerchantName.value = merchantName
  void refreshMatchingSummary()
}

function useAiCategorySuggestion(): void {
  const categoryId = editorSuggestion.value?.suggestedCategoryId
  if (!categoryId) return
  manualForm.categoryId = categoryId
  void refreshMatchingSummary()
}

async function handleRecurringSaved(): Promise<void> {
  closeRecurringCreator()
  await loadTransactions()
}

async function bulkUpdate(): Promise<void> {
  await classification.bulkUpdate({
    transactionIds: selectedTransactionIds.value,
    categoryId: bulkForm.categoryId || undefined,
    usageType: bulkForm.usageType ? (bulkForm.usageType as never) : undefined,
    costBehaviour: bulkForm.costBehaviour ? (bulkForm.costBehaviour as never) : undefined,
    necessity: bulkForm.necessity ? (bulkForm.necessity as never) : undefined,
    markConfirmed: true,
    overwriteManual: false
  })
  if (classification.error) return
  selectedTransactionIds.value = []
  await loadTransactions()
}

async function classifySelectedWithAi(): Promise<void> {
  const selectedIds = [...selectedTransactionIds.value]
  await ai.classifyTransactions(selectedIds)
  if (ai.error) return

  await loadTransactions()

  if (selectedIds.length === 1) {
    await openEditor(selectedIds[0]!)
  }
}

async function acceptAiSuggestion(
  suggestionId: string,
  options: { acceptCategory: boolean; acceptMerchant: boolean }
): Promise<void> {
  logAiSuggestionDiagnostic('button clicked', {
    action: acceptAction(options),
    suggestionIdPresent: Boolean(suggestionId)
  })
  const transactionId = ai.suggestions.find((item) => item.id === suggestionId)?.transactionId
  await ai.acceptSuggestion(suggestionId, options, currentSuggestionListInput())
  if (ai.error) return
  await classification.loadReference()
  if (editorTransactionId.value) {
    await classification.loadClassification(editorTransactionId.value)
    if (editorTransactionId.value === transactionId) {
      if (options.acceptMerchant) {
        manualForm.merchantId = classification.current?.merchantId ?? ''
        newMerchantName.value = ''
      }
      if (options.acceptCategory) manualForm.categoryId = classification.current?.categoryId ?? ''
      await refreshMatchingSummary()
    }
  }
  await loadTransactions()
}

async function rejectAiSuggestion(suggestionId: string): Promise<void> {
  logAiSuggestionDiagnostic('button clicked', {
    action: 'reject',
    suggestionIdPresent: Boolean(suggestionId)
  })
  await ai.rejectSuggestion(suggestionId, currentSuggestionListInput())
  await loadTransactions()
}

async function acceptHighConfidenceCategories(): Promise<void> {
  await ai.acceptHighConfidenceCategories(currentSuggestionListInput())
  if (ai.error) return
  if (editorTransactionId.value) await openEditor(editorTransactionId.value)
  await loadTransactions()
}

function currentSuggestionListInput(
  transactionQuery = currentSuggestionTransactionQuery()
): NonNullable<Parameters<typeof ai.loadSuggestions>[0]> {
  return { transactionQuery }
}

function logTransactionsDiagnostic(label: string, metadata: Record<string, unknown>): void {
  if (import.meta.env.PROD) return
  console.warn(`[sampo-transactions] ${label}`, metadata)
}

function logAiSuggestionDiagnostic(label: string, metadata: Record<string, unknown>): void {
  if (import.meta.env.PROD) return
  console.warn(`[sampo-ai-suggestions] ${label}`, metadata)
}

function acceptAction(options: { acceptCategory: boolean; acceptMerchant: boolean }): string {
  if (options.acceptCategory && options.acceptMerchant) return 'accept_both'
  if (options.acceptCategory) return 'accept_category'
  if (options.acceptMerchant) return 'accept_merchant'
  return 'accept'
}
</script>

<template>
  <section ref="viewRoot" class="view-stack">
    <p v-if="transactions.error" class="error-message" aria-live="polite">
      {{ transactions.error }}
    </p>
    <p v-if="classification.error" class="error-message" aria-live="polite">
      {{ classification.error }}
    </p>
    <p v-if="classification.message" class="status-message" aria-live="polite">
      {{ classification.message }}
    </p>
    <p v-if="ai.error" class="error-message" aria-live="polite">{{ ai.error }}</p>
    <p v-if="ai.message" class="status-message" aria-live="polite">{{ ai.message }}</p>
    <p v-if="recurring.error" class="error-message" aria-live="polite">{{ recurring.error }}</p>
    <p v-if="recurring.message" class="status-message" aria-live="polite">
      {{ recurring.message }}
    </p>

    <div class="panel">
      <h3>Filters</h3>
      <form class="form-grid" @submit.prevent="applyFilters">
        <div class="form-field form-field-wide">
          <label for="filter-search">Search transactions or merchants</label>
          <input
            id="filter-search"
            v-model="filters.search"
            type="search"
            placeholder="Search transactions or merchants..."
          />
        </div>
        <div class="form-field confirmation-filter">
          <span>Confirmation</span>
          <div class="segmented-control" role="group" aria-label="Confirmation filter">
            <button
              type="button"
              :class="{ active: filters.confirmationFilter === 'all' }"
              @click="filters.confirmationFilter = 'all'"
            >
              All
            </button>
            <button
              type="button"
              :class="{ active: filters.confirmationFilter === 'needs_confirmation' }"
              @click="filters.confirmationFilter = 'needs_confirmation'"
            >
              Needs confirmation
            </button>
            <button
              type="button"
              :class="{ active: filters.confirmationFilter === 'confirmed' }"
              @click="filters.confirmationFilter = 'confirmed'"
            >
              Confirmed
            </button>
          </div>
        </div>
        <div class="form-field">
          <label for="filter-account">Account</label>
          <select id="filter-account" v-model="filters.accountId">
            <option value="">All accounts</option>
            <option v-for="account in accounts.accounts" :key="account.id" :value="account.id">
              {{ account.name }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-from">Date from</label>
          <input id="filter-from" v-model="filters.dateFrom" type="date" />
        </div>
        <div class="form-field">
          <label for="filter-to">Date to</label>
          <input id="filter-to" v-model="filters.dateTo" type="date" />
        </div>
        <div class="form-field">
          <label for="filter-type">Type</label>
          <select id="filter-type" v-model="filters.transactionType">
            <option value="">All types</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="refund">Refund</option>
            <option value="card_settlement">Card settlement</option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-pending">Pending</label>
          <select id="filter-pending" v-model="filters.pending">
            <option value="">All</option>
            <option value="false">Completed</option>
            <option value="true">Pending</option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-excluded">Spending</label>
          <select id="filter-excluded" v-model="filters.excludedFromSpending">
            <option value="">All</option>
            <option value="false">Included</option>
            <option value="true">Excluded</option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-sort">Sort</label>
          <select id="filter-sort" v-model="filters.sortBy">
            <option value="transactionDate">Transaction date</option>
            <option value="amount">Amount</option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-direction">Direction</label>
          <select id="filter-direction" v-model="filters.sortDirection">
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-category">Category</label>
          <select id="filter-category" v-model="filters.categoryId">
            <option value="">All categories</option>
            <option
              v-for="category in classification.categories"
              :key="category.id"
              :value="category.id"
            >
              {{ category.name }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-merchant">Merchant</label>
          <select id="filter-merchant" v-model="filters.merchantId">
            <option value="">All merchants</option>
            <option
              v-for="merchant in classification.merchants"
              :key="merchant.id"
              :value="merchant.id"
            >
              {{ merchant.name }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-usage">Usage</label>
          <select id="filter-usage" v-model="filters.usageType">
            <option value="">All</option>
            <option value="personal">Personal</option>
            <option value="business">Business</option>
            <option value="mixed">Mixed</option>
            <option value="unspecified">Unspecified</option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-classification">Classification</label>
          <select id="filter-classification" v-model="filters.classificationStatus">
            <option value="">All</option>
            <option value="confirmed">Confirmed</option>
            <option value="needs_review">Needs review</option>
            <option value="ambiguous">Ambiguous</option>
          </select>
        </div>
        <label class="checkbox-label" for="filter-unclassified">
          <input id="filter-unclassified" v-model="filters.unclassifiedOnly" type="checkbox" />
          <span>Unclassified only</span>
        </label>
        <div class="button-row form-field-wide">
          <button type="submit" :disabled="transactions.loading">Apply filters</button>
          <button type="button" :disabled="transactions.loading" @click="resetFilters">
            Reset
          </button>
        </div>
      </form>
    </div>

    <div v-if="selectedTransactionIds.length" class="panel">
      <h3>Bulk classification</h3>
      <p>{{ selectedTransactionIds.length }} visible transactions selected.</p>
      <form class="form-grid" @submit.prevent="bulkUpdate">
        <div class="form-field">
          <label for="bulk-category">Category</label>
          <select id="bulk-category" v-model="bulkForm.categoryId">
            <option value="">Leave unchanged</option>
            <option
              v-for="category in classification.categories.filter((item) => item.isActive)"
              :key="category.id"
              :value="category.id"
            >
              {{ category.name }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label for="bulk-usage">Usage</label>
          <select id="bulk-usage" v-model="bulkForm.usageType">
            <option value="">Leave unchanged</option>
            <option value="personal">Personal</option>
            <option value="business">Business</option>
            <option value="mixed">Mixed</option>
            <option value="unspecified">Unspecified</option>
          </select>
        </div>
        <div class="form-field">
          <label for="bulk-cost">Cost</label>
          <select id="bulk-cost" v-model="bulkForm.costBehaviour">
            <option value="">Leave unchanged</option>
            <option value="fixed">Fixed</option>
            <option value="variable">Variable</option>
            <option value="unspecified">Unspecified</option>
          </select>
        </div>
        <div class="form-field">
          <label for="bulk-necessity">Necessity</label>
          <select id="bulk-necessity" v-model="bulkForm.necessity">
            <option value="">Leave unchanged</option>
            <option value="essential">Essential</option>
            <option value="discretionary">Discretionary</option>
            <option value="unspecified">Unspecified</option>
          </select>
        </div>
        <button type="submit" :disabled="classification.submitting">Apply to selected</button>
      </form>
      <div class="button-row">
        <button type="button" :disabled="ai.submitting" @click="classifySelectedWithAi">
          {{ ai.submitting ? 'Classifying...' : 'Classify' }}
        </button>
      </div>
    </div>

    <div class="panel">
      <div class="section-header ai-panel-header">
        <h3>
          AI suggestions
          <span class="badge" aria-live="polite">{{ ai.suggestions.length }} unresolved</span>
        </h3>
        <button
          type="button"
          class="secondary-button"
          :aria-expanded="!ui.aiPanelCollapsed"
          aria-controls="ai-suggestions-content"
          @click="ui.toggleAiPanel"
        >
          {{ ui.aiPanelCollapsed ? 'Show' : 'Hide' }}
          <span class="sr-only">AI suggestions</span>
        </button>
      </div>
      <div v-show="!ui.aiPanelCollapsed" id="ai-suggestions-content">
        <div class="button-row">
          <button type="button" :disabled="ai.loading" @click="loadAiSuggestions">Refresh</button>
          <button
            type="button"
            :disabled="ai.submitting || ai.highConfidenceSuggestions.length === 0"
            @click="acceptHighConfidenceCategories"
          >
            Accept high-confidence categories
          </button>
        </div>
        <p v-if="ai.suggestions.length === 0">No pending AI suggestions.</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Difference</th>
                <th>Current</th>
                <th>AI suggests</th>
                <th>Confidence</th>
                <th>Lookup</th>
                <th>Reason</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="suggestion in ai.suggestions" :key="suggestion.id">
                <td>{{ suggestionChangeLabels(suggestion) }}</td>
                <td>{{ suggestionCurrentValue(suggestion) }}</td>
                <td>{{ suggestionAiValue(suggestion) }}</td>
                <td>{{ suggestionConfidence(suggestion) }}</td>
                <td>{{ suggestion.usedWebSearch ? 'Web' : 'Local' }}</td>
                <td>{{ suggestion.reasonCode }}</td>
                <td>
                  <div class="button-row">
                    <button
                      type="button"
                      :disabled="ai.submitting || !suggestion.canAcceptCategory"
                      @click="
                        acceptAiSuggestion(suggestion.id, {
                          acceptCategory: true,
                          acceptMerchant: false
                        })
                      "
                    >
                      Use AI category
                    </button>
                    <button
                      type="button"
                      :disabled="ai.submitting || !suggestion.canAcceptMerchant"
                      @click="
                        acceptAiSuggestion(suggestion.id, {
                          acceptCategory: false,
                          acceptMerchant: true
                        })
                      "
                    >
                      Use AI merchant
                    </button>
                    <button
                      v-if="suggestion.canAcceptCategory && suggestion.canAcceptMerchant"
                      type="button"
                      :disabled="ai.submitting"
                      @click="
                        acceptAiSuggestion(suggestion.id, {
                          acceptCategory: true,
                          acceptMerchant: true
                        })
                      "
                    >
                      Use both
                    </button>
                    <button
                      class="danger-button"
                      type="button"
                      :disabled="ai.submitting"
                      @click="rejectAiSuggestion(suggestion.id)"
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>Transactions</h3>
      <div class="button-row">
        <button type="button" :disabled="ai.submitting" @click="classifySelectedWithAi">
          {{ ai.submitting ? 'Classifying...' : 'Classify' }}
        </button>
        <span>{{ selectedTransactionIds.length }} selected</span>
        <TransactionColumns />
      </div>
      <p v-if="transactions.page.items.length === 0">No transactions match the selected filters.</p>
      <div
        v-else
        class="table-wrap transactions-table-wrap"
        tabindex="0"
        role="region"
        aria-label="Transactions table"
      >
        <table class="transactions-table">
          <thead>
            <tr>
              <th>Select</th>
              <th v-if="ui.isColumnVisible('date')" class="column-date">Date</th>
              <th v-if="ui.isColumnVisible('valueDate')" class="column-valueDate">Value date</th>
              <th v-if="ui.isColumnVisible('description')" class="column-description">
                Description
              </th>
              <th v-if="ui.isColumnVisible('account')" class="column-account">Account</th>
              <th v-if="ui.isColumnVisible('amount')" class="numeric">Amount</th>
              <th v-if="ui.isColumnVisible('balance')" class="numeric">Balance</th>
              <th v-if="ui.isColumnVisible('type')" class="column-type">Type</th>
              <th v-if="ui.isColumnVisible('pending')" class="column-pending">Pending</th>
              <th v-if="ui.isColumnVisible('spending')" class="column-spending">Spending</th>
              <th v-if="ui.isColumnVisible('review')" class="column-review">Review</th>
              <th v-if="ui.isColumnVisible('merchant')" class="column-merchant">Merchant</th>
              <th v-if="ui.isColumnVisible('category')" class="column-category">Category</th>
              <th v-if="ui.isColumnVisible('classStatus')" class="column-classStatus">
                Class status
              </th>
              <th v-if="ui.isColumnVisible('usage')" class="column-usage">Usage</th>
              <th v-if="ui.isColumnVisible('cost')" class="column-cost">Cost</th>
              <th v-if="ui.isColumnVisible('necessity')" class="column-necessity">Necessity</th>
              <th v-if="ui.isColumnVisible('recurring')" class="column-recurring">Recurring</th>
              <th v-if="ui.isColumnVisible('actions')" class="column-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="transaction in transactions.page.items"
              :key="transaction.id"
              :data-transaction-row="transaction.id"
              :class="[
                `transaction-${transactionReviewState(transaction)}`,
                { 'transaction-selected': selectedTransactionIds.includes(transaction.id) }
              ]"
            >
              <td>
                <div class="transaction-selection">
                  <span
                    class="review-indicator"
                    role="img"
                    :title="transactionReviewLabels[transactionReviewState(transaction)]"
                    :aria-label="transactionReviewLabels[transactionReviewState(transaction)]"
                  >
                    {{ transactionReviewIcons[transactionReviewState(transaction)] }}
                  </span>
                  <input
                    v-model="selectedTransactionIds"
                    type="checkbox"
                    :value="transaction.id"
                    aria-label="Select transaction"
                  />
                </div>
              </td>
              <td v-if="ui.isColumnVisible('date')" class="column-date">
                {{ formatDate(transaction.transactionDate) }}
              </td>
              <td v-if="ui.isColumnVisible('valueDate')" class="column-valueDate">
                {{ formatDate(transaction.valueDate) }}
              </td>
              <td v-if="ui.isColumnVisible('description')" class="column-description">
                {{ transaction.description }}
              </td>
              <td v-if="ui.isColumnVisible('account')" class="column-account">
                {{ transaction.accountName }}
              </td>
              <td v-if="ui.isColumnVisible('amount')" class="numeric">
                {{ formatCents(transaction.amountCents, transaction.currency) }}
              </td>
              <td v-if="ui.isColumnVisible('balance')" class="numeric">
                {{
                  transaction.balanceCents === undefined
                    ? ''
                    : formatCents(transaction.balanceCents, transaction.currency)
                }}
              </td>
              <td v-if="ui.isColumnVisible('type')" class="column-type">
                {{ transaction.transactionType }}
              </td>
              <td v-if="ui.isColumnVisible('pending')" class="column-pending">
                {{ transaction.isPending ? 'Pending' : 'Completed' }}
              </td>
              <td v-if="ui.isColumnVisible('spending')" class="column-spending">
                {{ transaction.excludedFromSpending ? 'Excluded' : 'Included' }}
              </td>
              <td v-if="ui.isColumnVisible('review')" class="column-review">
                {{ transaction.reviewStatus }}
              </td>
              <td v-if="ui.isColumnVisible('merchant')" class="column-merchant">
                {{ transaction.classification?.merchantDisplay?.displayName ?? 'Not assigned' }}
                <span
                  v-if="transaction.classification?.merchantDisplay?.source === 'detected'"
                  class="classification-note"
                >
                  Detected
                </span>
                <span
                  v-if="
                    !transaction.classification?.merchantDisplay?.displayName &&
                    aiSuggestionFor(transaction.id)?.suggestedMerchantName
                  "
                  class="classification-note"
                >
                  Suggested: {{ aiSuggestionFor(transaction.id)?.suggestedMerchantName }}
                </span>
              </td>
              <td v-if="ui.isColumnVisible('category')" class="column-category">
                {{
                  transaction.classification?.categoryDisplay?.displayPath?.join(' / ') ??
                  'Unclassified'
                }}
                <span
                  v-if="transaction.classification?.categoryDisplay?.source === 'detected'"
                  class="classification-note"
                >
                  Detected
                </span>
                <span
                  v-if="
                    !transaction.classification?.categoryDisplay?.displayPath &&
                    aiSuggestionFor(transaction.id)?.suggestedCategoryPath
                  "
                  class="classification-note"
                >
                  Suggested:
                  {{ aiSuggestionFor(transaction.id)?.suggestedCategoryPath?.join(' / ') }}
                </span>
              </td>
              <td v-if="ui.isColumnVisible('classStatus')" class="column-classStatus">
                {{ transaction.classification?.classificationStatus ?? 'needs_review' }}
              </td>
              <td v-if="ui.isColumnVisible('usage')" class="column-usage">
                {{ transaction.classification?.usageType ?? 'unspecified' }}
              </td>
              <td v-if="ui.isColumnVisible('cost')" class="column-cost">
                {{ transaction.classification?.costBehaviour ?? 'unspecified' }}
              </td>
              <td v-if="ui.isColumnVisible('necessity')" class="column-necessity">
                {{ transaction.classification?.necessity ?? 'unspecified' }}
              </td>
              <td v-if="ui.isColumnVisible('recurring')" class="column-recurring">
                <span
                  class="recurring-indicator"
                  :title="
                    transaction.recurring
                      ? `${transaction.recurring.displayName} · ${transaction.recurring.cadence} · ${transaction.recurring.source}`
                      : 'Not recurring'
                  "
                  :aria-label="
                    transaction.recurring
                      ? `Recurring: ${transaction.recurring.displayName}, ${transaction.recurring.cadence}, ${transaction.recurring.source}`
                      : 'Not recurring'
                  "
                >
                  <span aria-hidden="true">{{ transaction.recurring ? '✓' : '○' }}</span>
                  <span class="sr-only">{{
                    transaction.recurring ? 'Recurring' : 'Not recurring'
                  }}</span>
                </span>
              </td>
              <td v-if="ui.isColumnVisible('actions')" class="column-actions">
                <div class="button-row">
                  <button type="button" @click="openEditor(transaction.id)">Edit</button>
                  <button type="button" @click="openRecurringCreator(transaction.id)">
                    {{ transaction.recurring ? 'Edit recurring' : 'Mark as recurring' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="button-row">
        <button type="button" :disabled="filters.offset === 0" @click="previousPage">
          Previous
        </button>
        <span
          >Page {{ currentPage }} of {{ totalPages }} ·
          {{ transactions.page.total }} transactions</span
        >
        <button
          type="button"
          :disabled="filters.offset + transactions.page.limit >= transactions.page.total"
          @click="nextPage"
        >
          Next
        </button>
      </div>
    </div>

    <div v-if="recurringTransactionId" ref="recurringPanel" class="panel">
      <h3>Mark as recurring</h3>
      <ManualRecurringForm
        :transaction-id="recurringTransactionId"
        @close="closeRecurringCreator"
        @saved="handleRecurringSaved"
      />
    </div>

    <div v-if="editorTransactionId" ref="editorPanel" class="panel">
      <h3>Classification editor</h3>
      <p v-if="editorTransaction">
        <strong>Transaction description:</strong> {{ editorTransaction.description }}
      </p>
      <p v-if="classification.current">
        Source {{ classification.current.source }}, status {{ classification.current.status }}.
      </p>

      <div v-if="editorSuggestion" class="panel">
        <h4>AI review</h4>
        <p v-if="editorSuggestion.suggestedMerchantName">
          Merchant:
          <strong>{{ editorSuggestion.currentMerchantName ?? 'Unassigned' }}</strong>
          ->
          <strong>{{ editorSuggestion.suggestedMerchantName }}</strong>
          <span class="classification-note">
            {{ editorSuggestion.usedWebSearch ? 'Web lookup' : 'AI' }} ·
            {{ editorSuggestion.merchantConfidenceBand }} confidence
          </span>
        </p>
        <p v-if="editorSuggestion.suggestedCategoryPath">
          Category:
          <strong>{{ editorSuggestion.currentCategoryPath?.join(' / ') ?? 'Unclassified' }}</strong>
          ->
          <strong>{{ editorSuggestion.suggestedCategoryPath.join(' / ') }}</strong>
          <span class="classification-note">
            {{ editorSuggestion.categoryConfidenceBand }} confidence
          </span>
        </p>
        <div class="button-row">
          <button
            v-if="editorSuggestion.suggestedMerchantName"
            type="button"
            @click="useAiMerchantSuggestion"
          >
            Use AI merchant
          </button>
          <button
            v-if="editorSuggestion.suggestedCategoryId"
            type="button"
            @click="useAiCategorySuggestion"
          >
            Use AI category
          </button>
        </div>
      </div>

      <form class="form-grid" @submit.prevent="saveManual">
        <div class="form-field">
          <label for="manual-merchant">Existing merchant</label>
          <select
            id="manual-merchant"
            v-model="manualForm.merchantId"
            @change="handleMerchantChange"
          >
            <option value="">No existing merchant selected</option>
            <option
              v-for="merchant in editorMerchantOptions"
              :key="merchant.id"
              :value="merchant.id"
            >
              {{ merchant.name }}
            </option>
          </select>
          <p
            v-if="
              classification.current?.merchantDisplay?.source === 'detected' &&
              classification.current.merchantDisplay.displayName
            "
            class="classification-note"
          >
            Detected: {{ classification.current.merchantDisplay.displayName }}
          </p>
        </div>

        <div class="form-field">
          <label for="manual-new-merchant">Or create a merchant</label>
          <input
            id="manual-new-merchant"
            v-model="newMerchantName"
            type="text"
            placeholder="Merchant name"
            @input="manualForm.merchantId = ''"
            @change="refreshMatchingSummary"
          />
          <div class="button-row">
            <button type="button" @click="useTransactionDescriptionAsMerchant">
              Use transaction description
            </button>
            <button
              v-if="editorSuggestion?.suggestedMerchantName"
              type="button"
              @click="useAiMerchantSuggestion"
            >
              Use AI merchant
            </button>
          </div>
          <p v-if="newMerchantName.trim()" class="classification-note">
            This merchant will be created or reused when you save.
          </p>
        </div>

        <div class="form-field">
          <label for="manual-category">Category</label>
          <select
            id="manual-category"
            v-model="manualForm.categoryId"
            @change="refreshMatchingSummary"
          >
            <option value="">Unclassified</option>
            <option
              v-for="category in classification.categories.filter((item) => item.isActive)"
              :key="category.id"
              :value="category.id"
            >
              {{ category.name }}
            </option>
          </select>
          <button
            v-if="editorSuggestion?.suggestedCategoryId"
            type="button"
            @click="useAiCategorySuggestion"
          >
            Use AI category
          </button>
          <p
            v-if="
              editorSuggestion?.suggestedCategoryId &&
              manualForm.categoryId === editorSuggestion.suggestedCategoryId &&
              classification.current?.categoryDisplay?.authoritativeId !== manualForm.categoryId
            "
            class="classification-note"
          >
            AI suggestion selected as a draft. Save classification to confirm it.
          </p>
          <p
            v-if="
              classification.current?.categoryDisplay?.source === 'detected' &&
              classification.current.categoryDisplay.displayPath
            "
            class="classification-note"
          >
            Detected: {{ classification.current.categoryDisplay.displayPath.join(' / ') }}
          </p>
        </div>
        <div class="form-field">
          <label for="manual-usage">Usage</label>
          <select id="manual-usage" v-model="manualForm.usageType">
            <option value="unspecified">Unspecified</option>
            <option value="personal">Personal</option>
            <option value="business">Business</option>
            <option value="mixed">Mixed</option>
          </select>
        </div>
        <div class="form-field">
          <label for="manual-cost">Cost</label>
          <select id="manual-cost" v-model="manualForm.costBehaviour">
            <option value="unspecified">Unspecified</option>
            <option value="fixed">Fixed</option>
            <option value="variable">Variable</option>
          </select>
        </div>
        <div class="form-field">
          <label for="manual-necessity">Necessity</label>
          <select id="manual-necessity" v-model="manualForm.necessity">
            <option value="unspecified">Unspecified</option>
            <option value="essential">Essential</option>
            <option value="discretionary">Discretionary</option>
          </select>
        </div>
        <div
          v-if="
            classification.matchingSummary &&
            classification.matchingSummary.otherMatchingTransactionCount > 0
          "
          class="form-field form-field-wide"
        >
          <p>
            {{ classification.matchingSummary.otherMatchingTransactionCount }} other transactions
            have this exact description.
          </p>
          <p>Choose whether to save only this transaction or also confirm similar transactions.</p>
        </div>
        <button type="submit" :disabled="classification.submitting">Save 1 transaction</button>
        <button
          v-if="classification.matchingSummary && classification.matchingSummary.eligibleCount > 0"
          type="button"
          :disabled="classification.submitting"
          @click="saveManualAndConfirmMatches"
        >
          Save {{ classification.matchingSummary.eligibleCount }} similar
          {{ classification.matchingSummary.eligibleCount === 1 ? 'transaction' : 'transactions' }}
        </button>
        <button class="secondary-button" type="button" @click="closeEditor">Close</button>
      </form>
    </div>
  </section>
</template>
