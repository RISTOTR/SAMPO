import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  CommittedReconciliationDto,
  ReconciliationCandidateDto,
  ReconciliationPreviewDto,
  ReversedReconciliationDto,
  SettlementSummaryDto
} from '../../../shared/dtos'
import { errorMessage, unwrapResult } from './api-result'

export const useReconciliationStore = defineStore('reconciliation', () => {
  const settlements = ref<SettlementSummaryDto[]>([])
  const candidates = ref<ReconciliationCandidateDto[]>([])
  const preview = ref<ReconciliationPreviewDto | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const message = ref<string | null>(null)

  async function loadSettlements(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      settlements.value = unwrapResult(
        await window.sampo.reconciliation.listUnreconciledSettlements()
      )
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      loading.value = false
    }
  }

  async function findCandidates(settlementTransactionId: string): Promise<void> {
    error.value = null
    preview.value = null
    candidates.value = unwrapResult(
      await window.sampo.reconciliation.findCandidates(settlementTransactionId)
    )
  }

  async function loadPreview(
    settlementTransactionId: string,
    visaImportBatchId: string
  ): Promise<void> {
    error.value = null
    preview.value = unwrapResult(
      await window.sampo.reconciliation.preview(settlementTransactionId, visaImportBatchId)
    )
  }

  async function commit(
    settlementTransactionId: string,
    visaImportBatchId: string
  ): Promise<CommittedReconciliationDto | null> {
    if (submitting.value) return null
    submitting.value = true
    error.value = null

    try {
      const result = unwrapResult(
        await window.sampo.reconciliation.commit(settlementTransactionId, visaImportBatchId)
      )
      message.value = `Reconciled ${result.linkedTransactionCount} movements.`
      await loadSettlements()
      return result
    } catch (caught) {
      error.value = errorMessage(caught)
      return null
    } finally {
      submitting.value = false
    }
  }

  async function reverse(
    settlementTransactionId: string
  ): Promise<ReversedReconciliationDto | null> {
    if (submitting.value) return null
    submitting.value = true
    error.value = null

    try {
      const result = unwrapResult(
        await window.sampo.reconciliation.reverse(settlementTransactionId)
      )
      message.value = 'Reconciliation reversed.'
      await loadSettlements()
      return result
    } catch (caught) {
      error.value = errorMessage(caught)
      return null
    } finally {
      submitting.value = false
    }
  }

  return {
    settlements,
    candidates,
    preview,
    loading,
    submitting,
    error,
    message,
    loadSettlements,
    findCandidates,
    loadPreview,
    commit,
    reverse
  }
})
