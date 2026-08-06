import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  AccountSummaryDto,
  CreateAccountInputDto,
  UpdateAccountInputDto
} from '../../../shared/dtos'
import { errorMessage, unwrapResult } from './api-result'

export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<AccountSummaryDto[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      accounts.value = unwrapResult(await window.sampo.accounts.list())
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      loading.value = false
    }
  }

  async function create(input: CreateAccountInputDto): Promise<boolean> {
    error.value = null

    try {
      await window.sampo.accounts.create(input).then(unwrapResult)
      await load()
      return true
    } catch (caught) {
      error.value = errorMessage(caught)
      return false
    }
  }

  async function update(input: UpdateAccountInputDto): Promise<boolean> {
    error.value = null

    try {
      await window.sampo.accounts.update(input).then(unwrapResult)
      await load()
      return true
    } catch (caught) {
      error.value = errorMessage(caught)
      return false
    }
  }

  async function deleteUnused(accountId: string): Promise<boolean> {
    error.value = null

    try {
      await window.sampo.accounts.deleteUnused(accountId).then(unwrapResult)
      await load()
      return true
    } catch (caught) {
      error.value = errorMessage(caught)
      return false
    }
  }

  return { accounts, loading, error, load, create, update, deleteUnused }
})
