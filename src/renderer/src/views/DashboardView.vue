<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import type {
  DashboardCategorySpendDto,
  DashboardMerchantSpendDto,
  DashboardPeriodPresetDto
} from '../../../shared/dtos'
import { formatCents } from '../formatters'
import { comparisonLabel, periodQuery } from '../presentation/dashboard'
import { useDashboardStore } from '../stores/dashboard'
import MonthlyTrend from '../components/dashboard/MonthlyTrend.vue'
import CategorySpending from '../components/dashboard/CategorySpending.vue'

const dashboard = useDashboardStore()
const router = useRouter()
const form = reactive({
  preset: 'latest_month' as DashboardPeriodPresetDto,
  dateFrom: '',
  dateTo: ''
})
const data = computed(() => dashboard.data)
const hasComparison = computed(() => (data.value?.period.previousTransactionCount ?? 0) > 0)
const metrics = computed(() =>
  data.value
    ? [
        { label: 'Spending', metric: data.value.totalSpending, context: 'Expenses less refunds' },
        { label: 'Income', metric: data.value.totalIncome, context: 'Income received' },
        { label: 'Net cash flow', metric: data.value.netCashFlow, context: 'Income less spending' },
        {
          label: 'Recurring spend',
          metric: data.value.recurringSpending,
          context: 'Confirmed series · selected period'
        }
      ]
    : []
)
const recurringRows = computed(() =>
  data.value
    ? [
        { label: 'Subscriptions', amount: data.value.recurring.subscriptionCents },
        { label: 'Recurring bills', amount: data.value.recurring.recurringBillCents },
        { label: 'Other recurring', amount: data.value.recurring.recurringPaymentCents }
      ]
    : []
)
onMounted(loadDashboard)
async function loadDashboard(): Promise<void> {
  if (form.preset === 'custom' && (!form.dateFrom || !form.dateTo || form.dateFrom > form.dateTo))
    return
  await dashboard.load({
    preset: form.preset,
    dateFrom: form.preset === 'custom' ? form.dateFrom : undefined,
    dateTo: form.preset === 'custom' ? form.dateTo : undefined
  })
}
function transactionQueryBase(): Record<string, string> {
  return data.value ? periodQuery(data.value.period) : {}
}
async function openCategory(category: DashboardCategorySpendDto): Promise<void> {
  await router.push({
    path: '/transactions',
    query: {
      ...transactionQueryBase(),
      ...(category.categoryId
        ? { categoryId: category.categoryId }
        : { unclassifiedOnly: 'true', confirmationFilter: 'needs_confirmation' })
    }
  })
}
async function openMerchant(merchant: DashboardMerchantSpendDto): Promise<void> {
  await router.push({
    path: '/transactions',
    query: {
      ...transactionQueryBase(),
      ...(merchant.merchantId ? { merchantId: merchant.merchantId } : { search: merchant.label })
    }
  })
}
async function openNeedsConfirmation(): Promise<void> {
  await router.push({
    path: '/transactions',
    query: { ...transactionQueryBase(), confirmationFilter: 'needs_confirmation' }
  })
}
async function openUnclassified(): Promise<void> {
  await router.push({
    path: '/transactions',
    query: { ...transactionQueryBase(), unclassifiedOnly: 'true' }
  })
}
async function openMonth(month: string): Promise<void> {
  const [year, number] = month.split('-').map(Number)
  const end = new Date(Date.UTC(year!, number!, 0)).toISOString().slice(0, 10)
  await router.push({
    path: '/transactions',
    query: {
      dateFrom: [data.value?.period.dateFrom ?? '', `${month}-01`].sort().at(-1)!,
      dateTo: [data.value?.period.dateTo ?? end, end].sort()[0]!
    }
  })
}
</script>

<template>
  <section class="view-stack dashboard-view" :aria-busy="dashboard.loading">
    <header class="dashboard-header">
      <div>
        <h3>{{ data?.period.label ?? 'Your financial overview' }}</h3>
        <p class="dashboard-muted">
          {{ data?.period.dateFrom
          }}<template v-if="data?.period.dateTo"> — {{ data.period.dateTo }}</template>
        </p>
      </div>
      <form class="dashboard-period-form" @submit.prevent="loadDashboard">
        <div class="form-field">
          <label for="dashboard-period">Period</label
          ><select id="dashboard-period" v-model="form.preset" @change="loadDashboard">
            <option value="latest_month">Latest imported month</option>
            <option value="this_month">This month</option>
            <option value="previous_month">Previous month</option>
            <option value="last_3_months">Last 3 months</option>
            <option value="last_6_months">Last 6 months</option>
            <option value="this_year">This year</option>
            <option value="custom">Custom dates</option>
          </select>
        </div>
        <template v-if="form.preset === 'custom'"
          ><div class="form-field">
            <label for="dashboard-from">From</label
            ><input
              id="dashboard-from"
              v-model="form.dateFrom"
              type="date"
              required
              :max="form.dateTo || undefined"
            />
          </div>
          <div class="form-field">
            <label for="dashboard-to">To</label
            ><input
              id="dashboard-to"
              v-model="form.dateTo"
              type="date"
              required
              :min="form.dateFrom || undefined"
            />
          </div>
          <button type="submit" :disabled="dashboard.loading">Apply</button></template
        >
      </form>
    </header>
    <p v-if="dashboard.error" class="error-message" role="alert">{{ dashboard.error }}</p>
    <p v-if="dashboard.loading" class="dashboard-muted" role="status">Updating overview…</p>
    <div v-if="data && !data.hasData" class="panel dashboard-empty">
      <h3>No transactions in this period</h3>
      <p>Import a statement or choose another period to see your financial overview.</p>
      <button type="button" @click="router.push('/imports')">Go to imports</button>
    </div>
    <template v-if="data && data.hasData">
      <div class="dashboard-period-context">
        <span
          >Compared with <strong>{{ data.period.previousLabel }}</strong
          ><template v-if="!hasComparison"> · No imported comparison data</template></span
        >
        <span v-if="data.period.latestTransactionDate"
          >Latest transaction in this period: {{ data.period.latestTransactionDate }}. Full date
          ranges are compared; partial imports are not adjusted to matching days.</span
        >
      </div>
      <dl class="dashboard-metrics">
        <div v-for="item in metrics" :key="item.label" class="dashboard-metric">
          <dt>{{ item.label }}</dt>
          <dd>{{ formatCents(item.metric.amountCents) }}</dd>
          <p
            v-if="hasComparison && item.label !== 'Recurring spend' && item.metric.comparison"
            class="metric-comparison"
          >
            {{
              comparisonLabel(item.metric.comparison.amountCents, item.metric.comparison.percent)
            }}
            <span>vs prior period</span>
          </p>
          <p v-else class="metric-comparison">
            {{
              item.label === 'Recurring spend'
                ? `${data.recurring.confirmedSeriesCount} confirmed series overall`
                : 'No comparison data'
            }}
          </p>
          <small>{{ item.context }}</small>
        </div>
      </dl>
      <section class="dashboard-attention" aria-labelledby="quality-heading">
        <div>
          <h3 id="quality-heading">Needs attention</h3>
          <p>
            Data quality · {{ data.dataQuality.classifiedSpendingPercent }}% of net spending
            classified
          </p>
        </div>
        <button type="button" @click="openNeedsConfirmation">
          <strong>{{ data.dataQuality.needsConfirmationCount }}</strong
          ><span>Needs confirmation →</span>
        </button>
        <button type="button" @click="openUnclassified">
          <strong>{{ formatCents(data.dataQuality.unclassifiedSpendingCents) }}</strong
          ><span>Unclassified spending →</span>
        </button>
        <button
          type="button"
          :class="{ 'attention-warning': data.dataQuality.unreconciledSettlementCount > 0 }"
          @click="router.push({ path: '/imports', hash: '#reconciliation-review' })"
        >
          <strong>{{ data.dataQuality.unreconciledSettlementCount }}</strong
          ><span>Unreconciled settlements →</span>
        </button>
        <p v-if="data.dataQuality.unreconciledSettlementCount > 0" class="settlement-note">
          Unreconciled settlements are included in spending and may overlap imported card purchases.
          Review them in Imports.
        </p>
      </section>
      <div class="dashboard-main-grid">
        <MonthlyTrend
          :months="data.monthlyTrend"
          :period="data.period"
          @open-month="openMonth"
        /><CategorySpending
          :categories="data.categories"
          :has-comparison="hasComparison"
          @select="openCategory"
        />
      </div>
      <div class="dashboard-secondary-grid">
        <section class="panel">
          <div class="dashboard-section-heading">
            <h3>Biggest changes</h3>
            <small>vs prior period</small>
          </div>
          <p v-if="!hasComparison || data.biggestChanges.length === 0" class="dashboard-muted">
            {{
              hasComparison
                ? 'No category changes of €1 or more.'
                : 'Import the previous period to compare categories.'
            }}
          </p>
          <button
            v-for="category in hasComparison ? data.biggestChanges : []"
            :key="category.categoryId ?? 'unclassified'"
            type="button"
            class="dashboard-list-row"
            @click="openCategory(category)"
          >
            <span
              ><strong>{{ category.label }}</strong
              ><small
                >{{ formatCents(category.amountCents) }} · Previously
                {{ formatCents(category.previousAmountCents) }}</small
              ></span
            ><span>{{ comparisonLabel(category.differenceCents) }}</span>
          </button>
        </section>
        <section class="panel">
          <div class="dashboard-section-heading">
            <h3>Top merchants</h3>
            <small>By net spend</small>
          </div>
          <p v-if="data.merchants.length === 0" class="dashboard-muted">
            No merchant spending in this period.
          </p>
          <button
            v-for="(merchant, index) in data.merchants.slice(0, 5)"
            :key="merchant.merchantId ?? merchant.label"
            type="button"
            class="dashboard-list-row merchant-row"
            @click="openMerchant(merchant)"
          >
            <span class="merchant-rank">{{ index + 1 }}</span
            ><span
              ><strong>{{ merchant.label }}</strong
              ><small>{{ merchant.transactionCount }} transactions</small></span
            ><span>{{ formatCents(merchant.amountCents) }}</span>
          </button>
        </section>
        <section class="panel">
          <div class="dashboard-section-heading"><h3>Recurring spending</h3></div>
          <p class="dashboard-muted">Confirmed series only · selected period</p>
          <p v-if="data.recurring.confirmedSeriesCount === 0" class="dashboard-muted">
            No confirmed recurring payments yet. Review candidates to include them here.
          </p>
          <dl v-else class="recurring-breakdown">
            <div v-for="row in recurringRows" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ formatCents(row.amount) }}</dd>
            </div>
          </dl>
          <div class="recurring-baseline">
            <strong
              >{{ formatCents(data.recurring.monthlyBaselineCents) }} <small>/ month</small></strong
            >
            <p>
              Approximate baseline across all confirmed series, independent of the selected period.
            </p>
          </div>
          <button type="button" class="dashboard-text-button" @click="router.push('/recurring')">
            Review recurring series →
          </button>
        </section>
      </div>
      <p class="dashboard-muted dashboard-footnote">
        Refunds reduce spending. Reconciled card settlements are excluded. Own-account transfer
        detection remains unavailable.
      </p>
    </template>
  </section>
</template>
