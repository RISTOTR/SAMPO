import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DashboardDataDto, DashboardQueryDto } from '../../../shared/dtos'
import { errorMessage, unwrapResult } from './api-result'

export const useDashboardStore = defineStore('dashboard', () => {
  const data = ref<DashboardDataDto | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  let requestId = 0

  async function load(query: DashboardQueryDto = {}): Promise<void> {
    const id = ++requestId
    loading.value = true
    error.value = null
    try {
      const result = unwrapResult(await window.sampo.dashboard.get(query))
      if (id === requestId) data.value = result
    } catch (caught) {
      if (id === requestId) {
        data.value = null
        error.value = errorMessage(caught)
      }
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  return { data, loading, error, load }
})
