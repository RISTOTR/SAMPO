<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DashboardCategorySpendDto } from '../../../../shared/dtos'
import { formatCents } from '../../formatters'
import { comparisonLabel, visibleCategories } from '../../presentation/dashboard'
const props = defineProps<{ categories: DashboardCategorySpendDto[]; hasComparison: boolean }>()
defineEmits<{ select: [category: DashboardCategorySpendDto] }>()
const expanded = ref(false)
const rows = computed(() => visibleCategories(props.categories, expanded.value))
const maximum = computed(() =>
  Math.max(1, ...props.categories.map((row) => Math.abs(row.amountCents)))
)
const activeCount = computed(
  () => props.categories.filter((row) => row.transactionCount > 0).length
)
</script>
<template>
  <section class="panel dashboard-categories">
    <div class="dashboard-section-heading">
      <h3>Spending by category</h3>
      <small>Net of refunds</small>
    </div>
    <p v-if="rows.length === 0" class="dashboard-muted">No spending in this period.</p>
    <div v-else class="category-bars">
      <button
        v-for="category in rows"
        :key="category.categoryId ?? 'unclassified'"
        type="button"
        class="category-bar-row"
        @click="$emit('select', category)"
      >
        <span class="category-bar-heading"
          ><strong>{{ category.label }}</strong
          ><strong>{{ formatCents(category.amountCents) }}</strong></span
        >
        <span class="category-bar-track" aria-hidden="true"
          ><i
            :class="{
              'refund-bar': category.amountCents < 0,
              'unclassified-bar': !category.categoryId
            }"
            :style="{ width: `${(Math.abs(category.amountCents) / maximum) * 100}%` }"
          ></i
        ></span>
        <span class="category-bar-context"
          ><span>{{ category.percentOfSpending }}% of net spend</span
          ><span v-if="hasComparison"
            >{{ comparisonLabel(category.differenceCents) }} vs prior</span
          ></span
        >
      </button>
    </div>
    <button
      v-if="activeCount > rows.length || expanded"
      type="button"
      class="dashboard-text-button"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? 'Show fewer' : `Show all ${activeCount} categories` }}
    </button>
  </section>
</template>
