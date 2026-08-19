<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import type {
  RecurringSeriesDto,
  RecurringSeriesTypeDto,
  TransactionRowDto
} from '../../../shared/dtos'
import { formatCents, formatDate } from '../formatters'
import { errorMessage, unwrapResult } from '../stores/api-result'
import { useRecurringStore } from '../stores/recurring'

const props = defineProps<{
  transactionId?: string
  allowSearch?: boolean
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const recurring = useRecurringStore()
const search = ref('')
const searchResults = ref<TransactionRowDto[]>([])
const searchError = ref<string | null>(null)
const searching = ref(false)
const selectedTransactionId = ref(props.transactionId ?? '')
const form = reactive({
  displayName: '',
  recurrenceType: 'recurring_payment' as Exclude<
    RecurringSeriesTypeDto,
    'unknown' | 'not_recurring'
  >,
  cadence: 'monthly' as RecurringSeriesDto['cadence']
})

watch(
  () => props.transactionId,
  async (transactionId) => {
    selectedTransactionId.value = transactionId ?? ''
    if (transactionId) await loadPreview(transactionId)
  }
)

onMounted(async () => {
  if (selectedTransactionId.value) await loadPreview(selectedTransactionId.value)
})

async function findTransactions(): Promise<void> {
  const trimmed = search.value.trim()
  if (!trimmed) return
  searching.value = true
  searchError.value = null
  try {
    const page = unwrapResult(
      await window.sampo.transactions.list({
        search: trimmed,
        pending: false,
        transactionType: 'expense',
        sortBy: 'transactionDate',
        sortDirection: 'desc',
        limit: 10,
        offset: 0
      })
    )
    searchResults.value = page.items
  } catch (caught) {
    searchError.value = errorMessage(caught)
  } finally {
    searching.value = false
  }
}

async function chooseTransaction(transactionId: string): Promise<void> {
  selectedTransactionId.value = transactionId
  await loadPreview(transactionId)
}

async function loadPreview(transactionId: string): Promise<void> {
  await recurring.previewManual({ transactionId })
  const preview = recurring.manualPreview
  if (!preview) return
  form.displayName = suggestedName(preview.suggestedDisplayName)
}

async function save(): Promise<void> {
  if (!selectedTransactionId.value) return
  const created = await recurring.createManual({
    transactionId: selectedTransactionId.value,
    displayName: form.displayName,
    recurrenceType: form.recurrenceType,
    cadence: form.cadence
  })
  if (!created) return
  emit('saved')
}

function close(): void {
  recurring.clearManualPreview()
  emit('close')
}

function suggestedName(fallback: string): string {
  const match = recurring.manualPreview?.matches[0]
  const category = match?.categoryPath?.at(-1)
  const merchant = recurring.manualPreview?.merchantName ?? fallback
  if (category && category.toLocaleLowerCase('en-US') !== merchant.toLocaleLowerCase('en-US')) {
    return `${category} - ${merchant}`
  }
  return fallback
}
</script>

<template>
  <div class="manual-recurring-form">
    <div v-if="allowSearch" class="manual-recurring-search">
      <form class="form-grid" @submit.prevent="findTransactions">
        <div class="form-field form-field-wide">
          <label for="manual-recurring-search">Find starting transaction</label>
          <input
            id="manual-recurring-search"
            v-model="search"
            type="search"
            placeholder="Search transactions or merchants..."
          />
        </div>
        <button type="submit" :disabled="searching">
          {{ searching ? 'Searching...' : 'Search' }}
        </button>
      </form>
      <p v-if="searchError" class="error-message" aria-live="polite">{{ searchError }}</p>
      <div v-if="searchResults.length" class="series-list">
        <article v-for="transaction in searchResults" :key="transaction.id" class="series-row">
          <button type="button" class="series-main" @click="chooseTransaction(transaction.id)">
            <strong>{{ transaction.description }}</strong>
            <span>
              {{ formatDate(transaction.transactionDate) }} ·
              {{ formatCents(transaction.amountCents, transaction.currency) }}
            </span>
          </button>
        </article>
      </div>
    </div>

    <p v-if="recurring.error" class="error-message" aria-live="polite">{{ recurring.error }}</p>

    <form v-if="recurring.manualPreview" class="form-grid" @submit.prevent="save">
      <div class="form-field form-field-wide">
        <label for="manual-recurring-name">Display name</label>
        <input id="manual-recurring-name" v-model="form.displayName" type="text" />
      </div>
      <div class="form-field">
        <label for="manual-recurring-type">Type</label>
        <select id="manual-recurring-type" v-model="form.recurrenceType">
          <option value="subscription">Subscription</option>
          <option value="recurring_bill">Recurring bill</option>
          <option value="recurring_payment">Recurring payment</option>
        </select>
      </div>
      <div class="form-field">
        <label for="manual-recurring-cadence">Cadence</label>
        <select id="manual-recurring-cadence" v-model="form.cadence">
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
          <option value="irregular">Other / irregular</option>
        </select>
      </div>
      <div class="form-field form-field-wide">
        <p>
          {{ recurring.manualPreview.matchingTransactionCount }} matching historical transactions
          found.
        </p>
      </div>
      <div class="form-field form-field-wide">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Included</th>
                <th>Date</th>
                <th>Description</th>
                <th>Merchant</th>
                <th>Category</th>
                <th class="numeric">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="match in recurring.manualPreview.matches" :key="match.transactionId">
                <td><input type="checkbox" checked disabled aria-label="Included in series" /></td>
                <td>{{ formatDate(match.transactionDate) }}</td>
                <td>{{ match.description }}</td>
                <td>{{ match.merchantName ?? 'Not assigned' }}</td>
                <td>{{ match.categoryPath?.join(' / ') ?? 'Unclassified' }}</td>
                <td class="numeric">{{ formatCents(match.amountCents, match.currency) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <button type="submit" :disabled="recurring.submitting">Save recurring series</button>
      <button type="button" class="secondary-button" @click="close">Close</button>
    </form>
  </div>
</template>
