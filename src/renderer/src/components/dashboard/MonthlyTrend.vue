<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardDataDto } from '../../../../shared/dtos'
import { formatCents } from '../../formatters'
import { trendMonths } from '../../presentation/dashboard'
const props = defineProps<{
  months: DashboardDataDto['monthlyTrend']
  period: DashboardDataDto['period']
}>()
const emit = defineEmits<{ openMonth: [month: string] }>()
const rows = computed(() => trendMonths(props.months, props.period.dateFrom, props.period.dateTo))
const hasMovement = computed(() =>
  props.months.some((row) => row.spendingCents !== 0 || row.incomeCents !== 0)
)
const bounds = computed(() => {
  const values = props.months.flatMap((row) => [row.spendingCents, row.incomeCents])
  return { min: Math.min(0, ...values), max: Math.max(100, ...values) }
})
const y = (value: number): number =>
  175 - ((value - bounds.value.min) / (bounds.value.max - bounds.value.min)) * 145
const step = computed(() => 540 / Math.max(1, rows.value.length))
const barWidth = computed(() => Math.min(22, step.value * 0.3))
function label(month: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`)
  )
}
function description(row: (typeof rows.value)[number]): string {
  return row.values
    ? `${label(row.month)}: spending ${formatCents(row.values.spendingCents)}, income ${formatCents(row.values.incomeCents)}, net ${formatCents(row.values.netCashFlowCents)}. Open transactions.`
    : `${label(row.month)}: no imported transactions.`
}
</script>
<template>
  <section class="panel dashboard-trend">
    <div class="dashboard-section-heading">
      <h3>Monthly trend</h3>
      <div class="chart-legend">
        <span><i class="spending-key"></i>Spending</span
        ><span><i class="income-key"></i>Income</span>
      </div>
    </div>
    <p v-if="months.length === 0" class="dashboard-muted">No monthly activity in this period.</p>
    <template v-else>
      <p v-if="!hasMovement" class="dashboard-muted">
        No spending or income in this period. Monthly values are available below.
      </p>
      <svg
        v-else
        class="monthly-chart"
        viewBox="0 0 640 210"
        role="group"
        aria-label="Monthly spending and income; values use a shared scale including zero"
      >
        <g v-for="value in [bounds.max, 0, ...(bounds.min < 0 ? [bounds.min] : [])]" :key="value">
          <line x1="80" x2="620" :y1="y(value)" :y2="y(value)" class="chart-grid" />
          <text x="73" :y="y(value) + 4" text-anchor="end" class="chart-axis">
            {{ formatCents(value) }}
          </text>
        </g>
        <g
          v-for="(row, index) in rows"
          :key="row.month"
          class="month-group"
          tabindex="0"
          role="button"
          :aria-label="description(row)"
          @click="emit('openMonth', row.month)"
          @keydown.enter.prevent="emit('openMonth', row.month)"
          @keydown.space.prevent="emit('openMonth', row.month)"
        >
          <title>{{ description(row) }}</title>
          <rect :x="80 + index * step" y="22" :width="step" height="175" class="month-hit" />
          <template v-if="row.values">
            <rect
              v-for="(value, kind) in [row.values.spendingCents, row.values.incomeCents]"
              :key="kind"
              :x="80 + index * step + step / 2 + (kind === 0 ? -barWidth - 2 : 2)"
              :y="Math.min(y(0), y(value))"
              :width="barWidth"
              :height="Math.abs(y(value) - y(0))"
              :class="kind === 0 ? 'spending-bar' : 'income-bar'"
              rx="2"
            />
          </template>
          <text
            v-if="index % Math.max(1, Math.ceil(rows.length / 8)) === 0"
            :x="80 + index * step + step / 2"
            y="202"
            text-anchor="middle"
            class="chart-axis"
          >
            {{ label(row.month) }}
          </text>
        </g>
      </svg>
      <p class="dashboard-muted chart-note">
        {{
          rows.length === 1
            ? 'One month selected. Choose 3 or 6 months to see a trend.'
            : 'Select a month to explore its transactions. Gaps mean no imported activity.'
        }}
      </p>
      <details class="chart-values">
        <summary>Monthly values</summary>
        <div class="dashboard-month-values">
          <button
            v-for="row in rows"
            :key="row.month"
            type="button"
            class="dashboard-list-row"
            @click="emit('openMonth', row.month)"
          >
            <strong>{{ label(row.month) }}</strong
            ><span v-if="row.values"
              >Spent {{ formatCents(row.values.spendingCents) }} · Income
              {{ formatCents(row.values.incomeCents) }} · Net
              {{ formatCents(row.values.netCashFlowCents) }}</span
            ><span v-else>No imported activity</span>
          </button>
        </div>
      </details>
    </template>
  </section>
</template>
