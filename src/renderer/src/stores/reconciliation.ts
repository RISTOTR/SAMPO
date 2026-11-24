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
  const findingCandidates = ref(false)
  const loadingPreview = ref(false)
  let candidateRequest = 0
  let previewRequest = 0
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
    const request = ++candidateRequest
    ++previewRequest
    error.value = null
    preview.value = null
    candidates.value = []
    findingCandidates.value = true
    loadingPreview.value = false
    try {
      const result = unwrapResult(
        await window.sampo.reconciliation.findCandidates(settlementTransactionId)
      )
      if (request === candidateRequest) candidates.value = result
    } catch (caught) {
      if (request === candidateRequest) error.value = errorMessage(caught)
    } finally {
      if (request === candidateRequest) findingCandidates.value = false
    }
  }

  async function loadPreview(
    settlementTransactionId: string,
    visaImportBatchId: string
  ): Promise<void> {
    const request = ++previewRequest
    error.value = null
    preview.value = null
    loadingPreview.value = true
    try {
      const result = unwrapResult(
        await window.sampo.reconciliation.preview(settlementTransactionId, visaImportBatchId)
      )
      if (request === previewRequest) preview.value = result
    } catch (caught) {
      if (request === previewRequest) error.value = errorMessage(caught)
    } finally {
      if (request === previewRequest) loadingPreview.value = false
    }
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
    findingCandidates,
    loadingPreview,
    error,
    message,
    loadSettlements,
    findCandidates,
    loadPreview,
    commit,
    reverse
  }
})
