import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ImportBatchSummaryDto, ImportPreviewSessionDto } from '../../../shared/dtos'
import { errorMessage, unwrapResult } from './api-result'

export const useImportsStore = defineStore('imports', () => {
  const preview = ref<ImportPreviewSessionDto | null>(null)
  const history = ref<ImportBatchSummaryDto[]>([])
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const message = ref<string | null>(null)

  async function loadHistory(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      history.value = unwrapResult(await window.sampo.imports.list())
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      loading.value = false
    }
  }

  async function selectAndInspect(accountId: string): Promise<void> {
    if (submitting.value) return
    submitting.value = true
    error.value = null
    message.value = null

    try {
      const result = unwrapResult(await window.sampo.imports.selectAndInspect(accountId))
      preview.value = result
      if (!result) {
        message.value = 'File selection cancelled.'
      }
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      submitting.value = false
    }
  }

  async function commitPreview(): Promise<boolean> {
    if (!preview.value || submitting.value) return false
    submitting.value = true
    error.value = null

    try {
      const committed = unwrapResult(await window.sampo.imports.commitPreview(preview.value.id))
      message.value = `Imported ${committed.transactionCount} transactions.`
      preview.value = null
      await loadHistory()
      return true
    } catch (caught) {
      error.value = errorMessage(caught)
      return false
    } finally {
      submitting.value = false
    }
  }

  async function discardPreview(): Promise<void> {
    if (preview.value) {
      await window.sampo.imports.discardPreview(preview.value.id)
    }

    preview.value = null
  }

  async function rollback(importBatchId: string): Promise<boolean> {
    if (submitting.value) return false
    submitting.value = true
    error.value = null

    try {
      await window.sampo.imports.rollback(importBatchId).then(unwrapResult)
      message.value = 'Import rolled back.'
      await loadHistory()
      return true
    } catch (caught) {
      error.value = errorMessage(caught)
      return false
    } finally {
      submitting.value = false
    }
  }

  return {
    preview,
    history,
    loading,
    submitting,
    error,
    message,
    loadHistory,
    selectAndInspect,
    commitPreview,
    discardPreview,
    rollback
  }
})
