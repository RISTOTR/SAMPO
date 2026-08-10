<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { formatCents, formatDate } from '../formatters'
import { useAccountsStore } from '../stores/accounts'
import { useAiStore } from '../stores/ai'
import { useClassificationStore } from '../stores/classification'
import { useTransactionsStore } from '../stores/transactions'
import type { TransactionListQueryDto } from '../../../shared/dtos'

const accounts = useAccountsStore()
const ai = useAiStore()
const classification = useClassificationStore()
const transactions = useTransactionsStore()
const filters = reactive({
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

const currentPage = computed(
  () => Math.floor(transactions.page.offset / transactions.page.limit) + 1
)
const totalPages = computed(() =>
  Math.max(1, Math.ceil(transactions.page.total / transactions.page.limit))
)

onMounted(async () => {
  await Promise.all([
    accounts.load(),
    classification.loadReference(),
    ai.loadSettings(),
    ai.loadSuggestions(),
    loadTransactions()
  ])
})

async function loadTransactions(): Promise<void> {
  const transactionType = filters.transactionType
    ? (filters.transactionType as NonNullable<TransactionListQueryDto['transactionType']>)
    : undefined

  await transactions.load({
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
  })
}

async function applyFilters(): Promise<void> {
  filters.offset = 0
  selectedTransactionIds.value = []
  await loadTransactions()
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
  editorTransactionId.value = transactionId
  await classification.loadClassification(transactionId)
  manualForm.merchantId = classification.current?.merchantId ?? ''
  manualForm.categoryId = classification.current?.categoryId ?? ''
  manualForm.usageType = classification.current?.usageType ?? 'unspecified'
  manualForm.costBehaviour = classification.current?.costBehaviour ?? 'unspecified'
  manualForm.necessity = classification.current?.necessity ?? 'unspecified'
}

async function saveManual(): Promise<void> {
  if (!editorTransactionId.value) return
  await classification.saveManual({
    transactionId: editorTransactionId.value,
    merchantId: manualForm.merchantId || undefined,
    categoryId: manualForm.categoryId || undefined,
    usageType: manualForm.usageType as never,
    costBehaviour: manualForm.costBehaviour as never,
    necessity: manualForm.necessity as never
  })
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
  selectedTransactionIds.value = []
  await loadTransactions()
}

async function classifySelectedWithAi(): Promise<void> {
  await ai.classifyTransactions(selectedTransactionIds.value)
  await loadTransactions()
}

async function acceptAiSuggestion(
  suggestionId: string,
  options: { acceptCategory: boolean; acceptMerchant: boolean }
): Promise<void> {
  await ai.acceptSuggestion(suggestionId, options)
  await Promise.all([classification.loadReference(), loadTransactions()])
}

async function rejectAiSuggestion(suggestionId: string): Promise<void> {
  await ai.rejectSuggestion(suggestionId)
  await loadTransactions()
}

async function acceptHighConfidenceCategories(): Promise<void> {
  await ai.acceptHighConfidenceCategories()
  await loadTransactions()
}
</script>

<template>
  <section class="view-stack">
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

    <div class="panel">
      <h3>Filters</h3>
      <form class="form-grid" @submit.prevent="applyFilters">
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
        <label class="form-field">
          <span>Unclassified only</span>
          <input v-model="filters.unclassifiedOnly" type="checkbox" />
        </label>
        <button type="submit" :disabled="transactions.loading">Apply filters</button>
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
        <button
          type="button"
          :disabled="ai.submitting || !ai.settings?.aiEnabled || !selectedTransactionIds.length"
          @click="classifySelectedWithAi"
        >
          Smart classify selected
        </button>
      </div>
    </div>

    <div class="panel">
      <h3>AI suggestions</h3>
      <div class="button-row">
        <button type="button" :disabled="ai.loading" @click="ai.loadSuggestions">Refresh</button>
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
              <th>Merchant</th>
              <th>Category</th>
              <th>Merchant confidence</th>
              <th>Category confidence</th>
              <th>Lookup</th>
              <th>Reason</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="suggestion in ai.suggestions" :key="suggestion.id">
              <td>{{ suggestion.suggestedMerchantName ?? '' }}</td>
              <td>{{ suggestion.suggestedCategoryPath?.join(' / ') ?? '' }}</td>
              <td>{{ suggestion.merchantConfidenceBand }}</td>
              <td>{{ suggestion.categoryConfidenceBand }}</td>
              <td>{{ suggestion.usedWebSearch ? 'Web' : 'Local' }}</td>
              <td>{{ suggestion.reasonCode }}</td>
              <td>
                <div class="button-row">
                  <button
                    type="button"
                    :disabled="ai.submitting || !suggestion.suggestedCategoryId"
                    @click="
                      acceptAiSuggestion(suggestion.id, {
                        acceptCategory: true,
                        acceptMerchant: false
                      })
                    "
                  >
                    Accept category
                  </button>
                  <button
                    type="button"
                    :disabled="ai.submitting || !suggestion.suggestedMerchantName"
                    @click="
                      acceptAiSuggestion(suggestion.id, {
                        acceptCategory: false,
                        acceptMerchant: true
                      })
                    "
                  >
                    Accept merchant
                  </button>
                  <button
                    type="button"
                    :disabled="
                      ai.submitting ||
                      (!suggestion.suggestedCategoryId && !suggestion.suggestedMerchantName)
                    "
                    @click="
                      acceptAiSuggestion(suggestion.id, {
                        acceptCategory: true,
                        acceptMerchant: true
                      })
                    "
                  >
                    Accept both
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

    <div class="panel">
      <h3>Transactions</h3>
      <p v-if="transactions.page.items.length === 0">No transactions match the selected filters.</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Select</th>
              <th>Date</th>
              <th>Value date</th>
              <th>Description</th>
              <th>Account</th>
              <th class="numeric">Amount</th>
              <th class="numeric">Balance</th>
              <th>Type</th>
              <th>Pending</th>
              <th>Spending</th>
              <th>Review</th>
              <th>Merchant</th>
              <th>Category</th>
              <th>Class status</th>
              <th>Usage</th>
              <th>Cost</th>
              <th>Necessity</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="transaction in transactions.page.items" :key="transaction.id">
              <td>
                <input
                  v-model="selectedTransactionIds"
                  type="checkbox"
                  :value="transaction.id"
                  aria-label="Select transaction"
                />
              </td>
              <td>{{ formatDate(transaction.transactionDate) }}</td>
              <td>{{ formatDate(transaction.valueDate) }}</td>
              <td>{{ transaction.description }}</td>
              <td>{{ transaction.accountName }}</td>
              <td class="numeric">
                {{ formatCents(transaction.amountCents, transaction.currency) }}
              </td>
              <td class="numeric">
                {{
                  transaction.balanceCents === undefined
                    ? ''
                    : formatCents(transaction.balanceCents, transaction.currency)
                }}
              </td>
              <td>{{ transaction.transactionType }}</td>
              <td>{{ transaction.isPending ? 'Pending' : 'Completed' }}</td>
              <td>{{ transaction.excludedFromSpending ? 'Excluded' : 'Included' }}</td>
              <td>{{ transaction.reviewStatus }}</td>
              <td>{{ transaction.classification?.merchantName ?? '' }}</td>
              <td>{{ transaction.classification?.categoryPath?.join(' / ') ?? '' }}</td>
              <td>{{ transaction.classification?.classificationStatus ?? 'needs_review' }}</td>
              <td>{{ transaction.classification?.usageType ?? 'unspecified' }}</td>
              <td>{{ transaction.classification?.costBehaviour ?? 'unspecified' }}</td>
              <td>{{ transaction.classification?.necessity ?? 'unspecified' }}</td>
              <td>
                <button type="button" @click="openEditor(transaction.id)">Classify</button>
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

    <div v-if="editorTransactionId" class="panel">
      <h3>Classification editor</h3>
      <p v-if="classification.current">
        Source {{ classification.current.source }}, status {{ classification.current.status }}.
      </p>
      <form class="form-grid" @submit.prevent="saveManual">
        <div class="form-field">
          <label for="manual-merchant">Merchant</label>
          <select id="manual-merchant" v-model="manualForm.merchantId">
            <option value="">Unspecified</option>
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
          <label for="manual-category">Category</label>
          <select id="manual-category" v-model="manualForm.categoryId">
            <option value="">Unspecified</option>
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
        <button type="submit" :disabled="classification.submitting">Save classification</button>
        <button class="secondary-button" type="button" @click="editorTransactionId = null">
          Close
        </button>
      </form>
    </div>
  </section>
</template>
