<script setup lang="ts">
import { ref } from 'vue'
import { errorMessage, unwrapResult } from '../stores/api-result'
const props = defineProps<{ transactionIds: string[]; disabled?: boolean }>()
const exporting = ref(false)
const message = ref('')
const error = ref('')
async function exportSelected(): Promise<void> {
  if (!props.transactionIds.length || props.disabled || exporting.value) return
  exporting.value = true
  message.value = ''
  error.value = ''
  try {
    const result = unwrapResult(
      await window.sampo.transactions.exportForTapio({ transactionIds: [...props.transactionIds] })
    )
    if (!result.cancelled)
      message.value = `Exported ${result.exportedCount} transactions. ${result.skippedCount} selected rows skipped (HSL, accommodation or unsupported travel evidence).`
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    exporting.value = false
  }
}
</script>
<template>
  <div>
    <button
      type="button"
      :disabled="disabled || exporting || !transactionIds.length"
      @click="exportSelected"
    >
      {{ exporting ? 'Exporting…' : `Export ${transactionIds.length} selected for Tapio` }}
    </button>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
