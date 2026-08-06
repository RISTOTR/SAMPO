<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { OverviewStatsDto } from '../../../shared/dtos'
import { errorMessage, unwrapResult } from '../stores/api-result'

const stats = ref<OverviewStatsDto | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    stats.value = unwrapResult(await window.sampo.overview.getStats())
  } catch (caught) {
    error.value = errorMessage(caught)
  }
})
</script>

<template>
  <section class="view-stack">
    <p v-if="error" class="error-message" aria-live="polite">{{ error }}</p>
    <div class="panel">
      <h3>Overview</h3>
      <p>Deterministic local counts only. Spending summaries and charts are not implemented yet.</p>
      <dl v-if="stats" class="summary-grid">
        <div>
          <dt>Accounts</dt>
          <dd>{{ stats.accountCount }}</dd>
        </div>
        <div>
          <dt>Committed imports</dt>
          <dd>{{ stats.committedImportCount }}</dd>
        </div>
        <div>
          <dt>Imported transactions</dt>
          <dd>{{ stats.transactionCount }}</dd>
        </div>
        <div>
          <dt>Unreconciled settlements</dt>
          <dd>{{ stats.unreconciledCardSettlementCount }}</dd>
        </div>
        <div>
          <dt>Classified</dt>
          <dd>{{ stats.classifiedTransactionCount ?? 0 }}</dd>
        </div>
        <div>
          <dt>Unclassified</dt>
          <dd>{{ stats.unclassifiedTransactionCount ?? 0 }}</dd>
        </div>
        <div>
          <dt>Needs classification review</dt>
          <dd>{{ stats.classificationNeedsReviewCount ?? 0 }}</dd>
        </div>
        <div>
          <dt>Active rules</dt>
          <dd>{{ stats.activeCategorisationRuleCount ?? 0 }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
