<script setup lang="ts">
import type { ReconciliationPreviewDto } from '../../../shared/dtos'
defineProps<{ warnings: ReconciliationPreviewDto['warnings'] }>()
const guidance: Record<string, string> = {
  amount_mismatch:
    'Import the complete Visa statement for this settlement period. The signed totals must match exactly; partial or approximate matches cannot be confirmed.',
  visa_batch_incomplete:
    'This import is missing statement movements, possibly because an overlapping import already contains them. Inspect import history and the overlapping batches before rolling back and reimporting a complete statement. Active reconciliations must be reversed before rollback.',
  visa_transaction_already_reconciled:
    'These movements are already linked to another settlement. Keep the existing link if correct; otherwise reverse it before reconciling here.',
  no_completed_visa_transactions:
    'Import a statement with completed Visa movements. Pending movements cannot be reconciled.',
  settlement_before_visa_movements:
    'Choose the statement paid by this settlement; this batch contains later movements.',
  currency_mismatch: 'Choose a Visa account in the same currency as the settlement.',
  ambiguous_candidate: 'Compare the statement periods and accounts before selecting a batch.'
}
</script>

<template>
  <ul v-if="warnings.length" class="reconciliation-warnings" aria-live="polite">
    <li v-for="warning in warnings" :key="warning.code">
      <strong>{{ warning.blocking ? 'Blocked: ' : 'Note: ' }}</strong
      >{{ warning.message }}
      <span v-if="guidance[warning.code]"> {{ guidance[warning.code] }}</span>
    </li>
  </ul>
</template>
