<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import FeedbackAlert from './FeedbackAlert.vue'
import { useTransactionsStore } from '../stores/transactions'
import { useClassificationStore } from '../stores/classification'
import { useAiStore } from '../stores/ai'
import { useRecurringStore } from '../stores/recurring'
const transactions = useTransactionsStore()
const classification = useClassificationStore()
const ai = useAiStore()
const recurring = useRecurringStore()
const sources = { classification, ai, recurring }
type Source = keyof typeof sources
const activeStatus = ref<Source | null>(null)
for (const id of Object.keys(sources) as Source[]) {
  watch(
    () => sources[id].message,
    (message) => {
      if (message) {
        const previous = activeStatus.value
        if (previous && previous !== id && !sources[previous].submitting)
          sources[previous].message = null
        activeStatus.value = id
      } else if (activeStatus.value === id) activeStatus.value = null
    },
    { immediate: true, flush: 'sync' }
  )
}
const status = computed(() => (activeStatus.value ? sources[activeStatus.value] : null))
const errors = computed(() =>
  Object.entries({ transactions, ...sources })
    .filter(([, store]) => store.error)
    .map(([id, store]) => ({ id, store }))
)
function dismissStatus(): void {
  if (status.value) status.value.message = null
}
</script>

<template>
  <div v-if="errors.length || status?.message" class="feedback-stack">
    <FeedbackAlert
      v-for="entry in errors"
      :key="entry.id"
      :message="entry.store.error!"
      error
      @dismiss="entry.store.error = null"
    />
    <FeedbackAlert
      v-if="status?.message"
      :key="activeStatus!"
      :message="status.message"
      :busy="status.submitting"
      @dismiss="dismissStatus"
    />
  </div>
</template>
