import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  RecurringScanSummaryDto,
  RecurringSeriesDetailDto,
  RecurringSeriesDto,
  RecurringSeriesTypeDto
} from '../../../shared/dtos'
import { errorMessage, unwrapResult } from './api-result'

export const useRecurringStore = defineStore('recurring', () => {
  const series = ref<RecurringSeriesDto[]>([])
  const selected = ref<RecurringSeriesDetailDto | null>(null)
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
    lastScan,
    loading,
    submitting,
    error,
    message,
    load,
    scan,
    open,
    confirm,
    reject
  }
})
