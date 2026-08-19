import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  CreateManualRecurringInputDto,
  RecurringManualPreviewDto,
  RecurringManualPreviewInputDto,
  RecurringScanSummaryDto,
  RecurringSeriesDetailDto,
  RecurringSeriesDto,
  RecurringSeriesTypeDto,
  RecurringUpdateInputDto
} from '../../../shared/dtos'
import { errorMessage, unwrapResult } from './api-result'

export const useRecurringStore = defineStore('recurring', () => {
  const series = ref<RecurringSeriesDto[]>([])
  const selected = ref<RecurringSeriesDetailDto | null>(null)
  const manualPreview = ref<RecurringManualPreviewDto | null>(null)
  const lastScan = ref<RecurringScanSummaryDto | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const message = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      series.value = unwrapResult(await window.sampo.recurring.list())
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      loading.value = false
    }
  }

  async function scan(): Promise<void> {
    submitting.value = true
    error.value = null
    message.value = null
    try {
      lastScan.value = unwrapResult(await window.sampo.recurring.scan())
      message.value = `Scan complete: ${lastScan.value.candidateCount} candidates.`
      await load()
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      submitting.value = false
    }
  }

  async function open(seriesId: string): Promise<void> {
    error.value = null
    try {
      selected.value = unwrapResult(await window.sampo.recurring.get(seriesId))
    } catch (caught) {
      error.value = errorMessage(caught)
    }
  }

  async function confirm(
    seriesId: string,
    recurrenceType: Exclude<RecurringSeriesTypeDto, 'unknown' | 'not_recurring'>
  ): Promise<void> {
    await submit(async () => {
      await window.sampo.recurring.confirm({ seriesId, recurrenceType })
      message.value = 'Recurring series confirmed.'
      await load()
      if (selected.value?.id === seriesId) await open(seriesId)
    })
  }

  async function reject(seriesId: string): Promise<void> {
    await submit(async () => {
      await window.sampo.recurring.reject({ seriesId })
      message.value = 'Recurring candidate rejected.'
      selected.value = selected.value?.id === seriesId ? null : selected.value
      await load()
    })
  }

  async function update(input: RecurringUpdateInputDto): Promise<void> {
    await submit(async () => {
      const updated = unwrapResult(await window.sampo.recurring.update(input))
      selected.value = updated
      message.value = 'Recurring series updated.'
      await load()
    })
  }

  async function deleteSeries(seriesId: string): Promise<void> {
    await submit(async () => {
      await window.sampo.recurring.delete({ seriesId })
      selected.value = selected.value?.id === seriesId ? null : selected.value
      message.value = 'Recurring series deleted.'
      await load()
    })
  }

  async function previewManual(input: RecurringManualPreviewInputDto): Promise<void> {
    submitting.value = true
    error.value = null
    message.value = null
    try {
      manualPreview.value = unwrapResult(await window.sampo.recurring.previewManual(input))
    } catch (caught) {
      manualPreview.value = null
      error.value = errorMessage(caught)
    } finally {
      submitting.value = false
    }
  }

  async function createManual(
    input: CreateManualRecurringInputDto
  ): Promise<RecurringSeriesDetailDto | null> {
    submitting.value = true
    error.value = null
    message.value = null
    try {
      const created = unwrapResult(await window.sampo.recurring.createManual(input))
      selected.value = created
      manualPreview.value = null
      message.value = `Recurring series saved with ${created.occurrenceCount} linked ${
        created.occurrenceCount === 1 ? 'transaction' : 'transactions'
      }.`
      await load()
      return created
    } catch (caught) {
      error.value = errorMessage(caught)
      return null
    } finally {
      submitting.value = false
    }
  }

  function clearManualPreview(): void {
    manualPreview.value = null
  }

  async function submit(action: () => Promise<void>): Promise<void> {
    submitting.value = true
    error.value = null
    message.value = null
    try {
      await action()
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      submitting.value = false
    }
  }

  return {
    series,
    selected,
    manualPreview,
    lastScan,
    loading,
    submitting,
    error,
    message,
    load,
    scan,
    open,
    confirm,
    reject,
    update,
    deleteSeries,
    previewManual,
    createManual,
    clearManualPreview
  }
})
