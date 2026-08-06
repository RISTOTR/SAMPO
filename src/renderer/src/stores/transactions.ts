import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TransactionListQueryDto, TransactionPageDto } from '../../../shared/dtos'
import { errorMessage, unwrapResult } from './api-result'

export const useTransactionsStore = defineStore('transactions', () => {
  const page = ref<TransactionPageDto>({ items: [], total: 0, limit: 50, offset: 0 })
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(query: TransactionListQueryDto = {}): Promise<void> {
    loading.value = true
    error.value = null

    try {
      page.value = unwrapResult(
        await window.sampo.transactions.list({
          sortBy: 'transactionDate',
          sortDirection: 'desc',
          limit: 50,
          offset: 0,
          ...query
        })
      )
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      loading.value = false
    }
  }

  return { page, loading, error, load }
})
