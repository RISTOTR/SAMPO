<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import type {
  DashboardCategorySpendDto,
  DashboardMerchantSpendDto,
  DashboardPeriodPresetDto
} from '../../../shared/dtos'
import { formatCents } from '../formatters'
import { useDashboardStore } from '../stores/dashboard'

const dashboard = useDashboardStore()
const router = useRouter()
const form = reactive({
  preset: 'latest_month' as DashboardPeriodPresetDto,
  dateFrom: '',
  dateTo: ''
})

const data = computed(() => dashboard.data)
const maxTrendSpending = computed(() =>
  Math.max(1, ...(data.value?.monthlyTrend.map((month) => month.spendingCents) ?? [1]))
)
const maxCategorySpending = computed(() =>
  Math.max(1, ...(data.value?.categories.map((category) => category.amountCents) ?? [1]))
)

onMounted(async () => {
  await loadDashboard()
})

async function loadDashboard(): Promise<void> {
  await dashboard.load({
    preset: form.preset,
    dateFrom: form.preset === 'custom' ? form.dateFrom || undefined : undefined,
    dateTo: form.preset === 'custom' ? form.dateTo || undefined : undefined
  })
}

function comparisonLabel(amountCents: number, percent?: number): string {
  const amount = formatCents(Math.abs(amountCents))
  const sign = amountCents > 0 ? '+' : amountCents < 0 ? '-' : ''
  return `${sign}${amount}${percent === undefined ? '' : ` (${percent > 0 ? '+' : ''}${percent}% )`}`
}

function trendWidth(amountCents: number): string {
  return `${Math.max(2, Math.round((amountCents / maxTrendSpending.value) * 100))}%`
}

function categoryWidth(amountCents: number): string {
  return `${Math.max(2, Math.round((amountCents / maxCategorySpending.value) * 100))}%`
}

function transactionQueryBase(): Record<string, string> {
  const period = data.value?.period
  return {
    dateFrom: period?.dateFrom ?? '',
    dateTo: period?.dateTo ?? ''
  }
}

async function openCategory(category: DashboardCategorySpendDto): Promise<void> {
  const query: Record<string, string> = transactionQueryBase()
  if (category.categoryId) {
    query.categoryId = category.categoryId
  } else {
    query.unclassifiedOnly = 'true'
    query.confirmationFilter = 'needs_confirmation'
  }
  await router.push({ path: '/transactions', query })
}

async function openMerchant(merchant: DashboardMerchantSpendDto): Promise<void> {
  const query: Record<string, string> = transactionQueryBase()
  if (merchant.merchantId) query.merchantId = merchant.merchantId
  else query.search = merchant.label
  await router.push({ path: '/transactions', query })
}

async function openNeedsConfirmation(): Promise<void> {
  await router.push({
    path: '/transactions',
    query: { ...transactionQueryBase(), confirmationFilter: 'needs_confirmation' }
  })
}
</script>

<template>
  <section class="view-stack">
    <div class="panel">
      <div class="section-header">
        <div>
          <h3>Dashboard</h3>
          <p>Deterministic analysis from imported transactions and confirmed classifications.</p>
        </div>
      </div>
      <form class="form-grid" @submit.prevent="loadDashboard">
        <div class="form-field">
          <label for="dashboard-period">Period</label>
          <select id="dashboard-period" v-model="form.preset" @change="loadDashboard">
            <option value="latest_month">Latest imported month</option>
            <option value="this_month">This month</option>
            <option value="previous_month">Previous month</option>
            <option value="last_3_months">Last 3 months</option>
            <option value="last_6_months">Last 6 months</option>
            <option value="this_year">This year</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div class="form-field">
          <label for="dashboard-from">From</label>
          <input id="dashboard-from" v-model="form.dateFrom" type="date" />
        </div>
        <div class="form-field">
          <label for="dashboard-to">To</label>
          <input id="dashboard-to" v-model="form.dateTo" type="date" />
        </div>
        <button type="submit" :disabled="dashboard.loading">Update</button>
      </form>
      <p v-if="dashboard.error" class="error-message" aria-live="polite">{{ dashboard.error }}</p>
      <p v-if="dashboard.loading">Loading dashboard...</p>
    </div>

    <div v-if="data && !data.hasData" class="panel">
      <h3>No dashboard data</h3>
      <p>
        Import transactions to see spending, income, category, merchant, and recurring analysis.
      </p>
    </div>

    <template v-if="data && data.hasData">
      <div class="summary-grid dashboard-summary">
        <div>
          <dt>Spending</dt>
          <dd>{{ formatCents(data.totalSpending.amountCents) }}</dd>
          <p v-if="data.totalSpending.comparison">
            {{
              comparisonLabel(
                data.totalSpending.comparison.amountCents,
                data.totalSpending.comparison.percent
              )
            }}
            vs {{ data.totalSpending.comparison.previousPeriodLabel }}
          </p>
        </div>
        <div>
          <dt>Income</dt>
          <dd>{{ formatCents(data.totalIncome.amountCents) }}</dd>
          <p v-if="data.totalIncome.comparison">
            {{
              comparisonLabel(
                data.totalIncome.comparison.amountCents,
                data.totalIncome.comparison.percent
              )
            }}
            vs {{ data.totalIncome.comparison.previousPeriodLabel }}
          </p>
        </div>
        <div>
          <dt>Net cash flow</dt>
          <dd>{{ formatCents(data.netCashFlow.amountCents) }}</dd>
        </div>
        <div>
          <dt>Recurring spend</dt>
          <dd>{{ formatCents(data.recurringSpending.amountCents) }}</dd>
          <p>{{ formatCents(data.recurring.monthlyBaselineCents) }} monthly baseline</p>
        </div>
      </div>

      <div class="split-grid">
        <div class="panel">
          <h3>Spending by category</h3>
          <p v-if="data.categories.length === 0">No spending categories in this period.</p>
          <div v-else class="analysis-list">
            <button
              v-for="category in data.categories"
              :key="category.categoryId ?? 'unclassified'"
              type="button"
              class="analysis-row"
              @click="openCategory(category)"
            >
              <span>
                <strong>{{ category.label }}</strong>
                <small>
                  {{ category.percentOfSpending }}% · {{ category.transactionCount }} transactions ·
                  {{ comparisonLabel(category.differenceCents) }}
                </small>
              </span>
              <span>{{ formatCents(category.amountCents) }}</span>
              <i :style="{ width: categoryWidth(category.amountCents) }"></i>
            </button>
          </div>
        </div>

        <div class="panel">
          <h3>Top merchants</h3>
          <p v-if="data.merchants.length === 0">No merchant spending in this period.</p>
          <div v-else class="analysis-list">
            <button
              v-for="merchant in data.merchants"
              :key="merchant.merchantId ?? merchant.label"
              type="button"
              class="analysis-row"
              @click="openMerchant(merchant)"
            >
              <span>
                <strong>{{ merchant.label }}</strong>
                <small
                  >{{ merchant.transactionCount }} transactions · avg
                  {{ formatCents(merchant.averageAmountCents) }}</small
                >
              </span>
              <span>{{ formatCents(merchant.amountCents) }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="split-grid">
        <div class="panel">
          <h3>Monthly trend</h3>
          <div class="analysis-list">
            <div v-for="month in data.monthlyTrend" :key="month.month" class="trend-row">
              <span>{{ month.month }}</span>
              <span>{{ formatCents(month.spendingCents) }}</span>
              <i :style="{ width: trendWidth(month.spendingCents) }"></i>
              <small
                >Income {{ formatCents(month.incomeCents) }} · Net
                {{ formatCents(month.netCashFlowCents) }}</small
              >
            </div>
          </div>
        </div>

        <div class="panel">
          <h3>Biggest changes</h3>
          <p v-if="data.biggestChanges.length === 0">No meaningful previous-period changes.</p>
          <div v-else class="analysis-list">
            <button
              v-for="category in data.biggestChanges"
              :key="`change-${category.categoryId ?? 'unclassified'}`"
              type="button"
              class="analysis-row"
              @click="openCategory(category)"
            >
              <span>
                <strong>{{ category.label }}</strong>
                <small>Previous {{ formatCents(category.previousAmountCents) }}</small>
              </span>
              <span>{{ comparisonLabel(category.differenceCents) }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="split-grid">
        <div class="panel">
          <h3>Recurring spending</h3>
          <div class="summary-grid">
            <p>
              <strong>Subscriptions:</strong> {{ formatCents(data.recurring.subscriptionCents) }}
            </p>
            <p><strong>Bills:</strong> {{ formatCents(data.recurring.recurringBillCents) }}</p>
            <p>
              <strong>Payments:</strong> {{ formatCents(data.recurring.recurringPaymentCents) }}
            </p>
            <p><strong>Series:</strong> {{ data.recurring.confirmedSeriesCount }}</p>
          </div>
        </div>

        <div class="panel">
          <h3>Data quality</h3>
          <button type="button" class="analysis-row" @click="openNeedsConfirmation">
            <span>
              <strong
                >{{ data.dataQuality.classifiedSpendingPercent }}% of spending classified</strong
              >
              <small
                >{{ data.dataQuality.needsConfirmationCount }} transactions need confirmation</small
              >
            </span>
            <span>{{ formatCents(data.dataQuality.unclassifiedSpendingCents) }} unclassified</span>
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
