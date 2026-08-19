import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TransactionListQueryDto, TransactionPageDto } from '../../../shared/dtos'
import { errorMessage, unwrapResult } from './api-result'

export const useTransactionsStore = defineStore('transactions', () => {
  const page = ref<TransactionPageDto>({ items: [], total: 0, limit: 50, offset: 0 })
  const loading = ref(false)
  const error = ref<string | null>(null)
  let latestLoadId = 0

  async function load(query: TransactionListQueryDto = {}): Promise<void> {
    const loadId = ++latestLoadId
    loading.value = true
    error.value = null

    try {
      const nextPage = unwrapResult(
        await window.sampo.transactions.list({
          sortBy: 'transactionDate',
          sortDirection: 'desc',
          limit: 50,
          offset: 0,
          ...query
        })
      )
      if (loadId !== latestLoadId) return
      page.value = nextPage
    } catch (caught) {
      if (loadId !== latestLoadId) return
      error.value = errorMessage(caught)
    } finally {
      if (loadId === latestLoadId) loading.value = false
    }
  }

  return { page, loading, error, load }
})
