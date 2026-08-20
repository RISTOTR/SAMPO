import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DashboardDataDto, DashboardQueryDto } from '../../../shared/dtos'
import { errorMessage, unwrapResult } from './api-result'

export const useDashboardStore = defineStore('dashboard', () => {
  const data = ref<DashboardDataDto | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(query: DashboardQueryDto = {}): Promise<void> {
    loading.value = true
    error.value = null
    try {
      data.value = unwrapResult(await window.sampo.dashboard.get(query))
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      loading.value = false
    }
  }

  return { data, loading, error, load }
})
