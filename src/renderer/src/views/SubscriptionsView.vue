<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { formatCents, formatDate } from '../formatters'
import { useRecurringStore } from '../stores/recurring'
import type { RecurringSeriesDto } from '../../../shared/dtos'
import ManualRecurringForm from '../components/ManualRecurringForm.vue'

const recurring = useRecurringStore()
const addingManual = ref(false)
const editingSeriesId = ref<string | null>(null)
const editPanel = ref<HTMLElement | null>(null)
const editForm = reactive({
  displayName: '',
  recurrenceType: 'recurring_payment' as Exclude<
    RecurringSeriesDto['recurrenceType'],
    'unknown' | 'not_recurring'
  >,
  cadence: 'monthly' as RecurringSeriesDto['cadence']
})

const candidates = computed(() =>
  recurring.series.filter((series) => series.status === 'candidate')
)
const confirmed = computed(() => recurring.series.filter((series) => series.status === 'confirmed'))

onMounted(async () => {
  await recurring.load()
})

function title(series: RecurringSeriesDto): string {
  return series.canonicalDescription
}

function typeLabel(type: RecurringSeriesDto['recurrenceType']): string {
  if (type === 'subscription') return 'Subscription'
  if (type === 'recurring_bill') return 'Recurring bill'
  if (type === 'recurring_payment') return 'Recurring payment'
  if (type === 'not_recurring') return 'Not recurring'
  return 'Candidate'
}

function cadenceLabel(series: RecurringSeriesDto): string {
  if (series.cadence === 'monthly') return 'Monthly pattern'
  if (series.cadence === 'quarterly') return 'Quarterly pattern'
  if (series.cadence === 'yearly') return 'Yearly pattern'
  return 'Irregular pattern'
}

function amountLabel(series: RecurringSeriesDto): string {
  if (series.amountVariabilityBasisPoints <= 1000) {
    return `${formatCents(series.typicalAmountCents, 'EUR')} / ${series.cadence}`
  }
  return `Typical ~${formatCents(series.typicalAmountCents, 'EUR')}`
}

function rangeLabel(series: RecurringSeriesDto): string {
  if (series.minAmountCents === series.maxAmountCents) return 'Fixed amount'
  return `Range ${formatCents(series.minAmountCents, 'EUR')} to ${formatCents(
    series.maxAmountCents,
    'EUR'
  )}`
}

async function openEdit(series: RecurringSeriesDto): Promise<void> {
  editingSeriesId.value = series.id
  editForm.displayName = title(series)
  editForm.recurrenceType =
    series.recurrenceType === 'unknown' || series.recurrenceType === 'not_recurring'
      ? 'recurring_payment'
      : series.recurrenceType
  editForm.cadence = series.cadence
  await nextTick()
  editPanel.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function closeEdit(): void {
  editingSeriesId.value = null
}

async function saveEdit(): Promise<void> {
  if (!editingSeriesId.value) return
  await recurring.update({
    seriesId: editingSeriesId.value,
    displayName: editForm.displayName,
    recurrenceType: editForm.recurrenceType,
    cadence: editForm.cadence
  })
  if (!recurring.error) closeEdit()
}

async function deleteSeries(seriesId: string): Promise<void> {
  if (!window.confirm('Delete this recurring series?')) return
  await recurring.deleteSeries(seriesId)
  if (editingSeriesId.value === seriesId) closeEdit()
}
</script>

<template>
  <section class="view-stack">
    <div class="panel">
      <div class="section-header">
        <div>
          <h3>Recurring payments</h3>
          <p>Deterministic candidates from transaction cadence, merchant identity, and amounts.</p>
        </div>
        <div class="button-row">
          <button type="button" @click="addingManual = true">+ Add recurring payment</button>
          <button type="button" :disabled="recurring.submitting" @click="recurring.scan">
            {{ recurring.submitting ? 'Scanning...' : 'Scan for recurring payments' }}
          </button>
        </div>
      </div>
      <p v-if="recurring.error" class="error-message" aria-live="polite">
        {{ recurring.error }}
      </p>
      <p v-if="recurring.message" class="status-message" aria-live="polite">
        {{ recurring.message }}
      </p>
    </div>

    <div v-if="addingManual" class="panel">
      <h3>Add recurring payment</h3>
      <ManualRecurringForm
        allow-search
        @close="addingManual = false"
        @saved="addingManual = false"
      />
    </div>

    <div class="panel">
      <h3>Confirmed</h3>
      <p v-if="confirmed.length === 0">No recurring series confirmed yet.</p>
      <div v-else class="series-list">
        <article v-for="series in confirmed" :key="series.id" class="series-row">
          <button type="button" class="series-main" @click="recurring.open(series.id)">
            <strong>{{ title(series) }}</strong>
            <span>{{ typeLabel(series.recurrenceType) }} · {{ amountLabel(series) }}</span>
            <span>
              Last payment {{ formatDate(series.lastSeen) }} · {{ series.occurrenceCount }} marked
              transactions · {{ series.source }}
            </span>
          </button>
          <div class="series-actions">
            <button type="button" @click.stop="openEdit(series)">Edit</button>
            <button class="danger-button" type="button" @click.stop="deleteSeries(series.id)">
              Delete
            </button>
          </div>
        </article>
      </div>
    </div>

    <div v-if="editingSeriesId" ref="editPanel" class="panel">
      <h3>Edit recurring series</h3>
      <form class="form-grid" @submit.prevent="saveEdit">
        <div class="form-field form-field-wide">
          <label for="recurring-edit-name">Display name</label>
          <input id="recurring-edit-name" v-model="editForm.displayName" type="text" />
        </div>
        <div class="form-field">
          <label for="recurring-edit-type">Type</label>
          <select id="recurring-edit-type" v-model="editForm.recurrenceType">
            <option value="subscription">Subscription</option>
            <option value="recurring_bill">Recurring bill</option>
            <option value="recurring_payment">Recurring payment</option>
          </select>
        </div>
        <div class="form-field">
          <label for="recurring-edit-cadence">Cadence</label>
          <select id="recurring-edit-cadence" v-model="editForm.cadence">
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
            <option value="irregular">Other / irregular</option>
          </select>
        </div>
        <button type="submit" :disabled="recurring.submitting">Save recurring series</button>
        <button type="button" class="secondary-button" @click="closeEdit">Close</button>
      </form>
    </div>

    <div class="panel">
      <h3>Candidates</h3>
      <p v-if="!recurring.loading && candidates.length === 0">
        No recurring candidates. Run a scan after importing several months of transactions.
      </p>
      <p v-if="recurring.loading">Loading recurring series...</p>
      <div v-else class="series-list">
        <article v-for="series in candidates" :key="series.id" class="series-row">
          <button type="button" class="series-main" @click="recurring.open(series.id)">
            <strong>{{ title(series) }}</strong>
            <span>
              {{ cadenceLabel(series) }} · {{ series.occurrenceCount }} occurrences ·
              {{ series.confidence }} confidence
            </span>
            <span>{{ amountLabel(series) }} · {{ rangeLabel(series) }}</span>
          </button>
          <div class="series-actions">
            <button type="button" @click="recurring.confirm(series.id, 'subscription')">
              Subscription
            </button>
            <button type="button" @click="recurring.confirm(series.id, 'recurring_bill')">
              Recurring bill
            </button>
            <button type="button" @click="recurring.confirm(series.id, 'recurring_payment')">
              Recurring payment
            </button>
            <button class="danger-button" type="button" @click="recurring.reject(series.id)">
              Not recurring
            </button>
            <button class="danger-button" type="button" @click="deleteSeries(series.id)">
              Delete
            </button>
          </div>
        </article>
      </div>
    </div>

    <div v-if="recurring.selected" class="panel">
      <h3>{{ title(recurring.selected) }}</h3>
      <div class="summary-grid">
        <p><strong>Cadence:</strong> {{ recurring.selected.cadence }}</p>
        <p><strong>Confidence:</strong> {{ recurring.selected.confidence }}</p>
        <p><strong>First seen:</strong> {{ formatDate(recurring.selected.firstSeen) }}</p>
        <p><strong>Latest:</strong> {{ formatDate(recurring.selected.lastSeen) }}</p>
        <p><strong>Typical:</strong> {{ amountLabel(recurring.selected) }}</p>
        <p><strong>Variability:</strong> {{ rangeLabel(recurring.selected) }}</p>
        <p><strong>Source:</strong> {{ recurring.selected.source }}</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Merchant</th>
              <th>Category</th>
              <th class="numeric">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="occurrence in recurring.selected.occurrences"
              :key="occurrence.transactionId"
            >
              <td>{{ formatDate(occurrence.transactionDate) }}</td>
              <td>{{ occurrence.description }}</td>
              <td>{{ occurrence.merchantName ?? 'Not assigned' }}</td>
              <td>{{ occurrence.categoryPath?.join(' / ') ?? 'Unclassified' }}</td>
              <td class="numeric">
                {{ formatCents(occurrence.amountCents, occurrence.currency) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
