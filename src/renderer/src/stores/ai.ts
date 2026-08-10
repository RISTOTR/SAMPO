import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  AiConnectionTestDto,
  AiSettingsDto,
  AiSuggestionDto,
  SmartClassifySummaryDto,
  UpdateAiSettingsInputDto
} from '../../../shared/dtos'
import { errorMessage, unwrapResult } from './api-result'

export const useAiStore = defineStore('ai', () => {
  const settings = ref<AiSettingsDto | null>(null)
  const suggestions = ref<AiSuggestionDto[]>([])
  const lastConnectionTest = ref<AiConnectionTestDto | null>(null)
  const lastSummary = ref<SmartClassifySummaryDto | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const message = ref<string | null>(null)

  const highConfidenceSuggestions = computed(() =>
    suggestions.value.filter(
      (suggestion) =>
        suggestion.categoryConfidenceBand === 'high' && Boolean(suggestion.suggestedCategoryId)
    )
  )

  async function loadSettings(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      settings.value = unwrapResult(await window.sampo.ai.getSettings())
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      loading.value = false
    }
  }

  async function loadSuggestions(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      suggestions.value = unwrapResult(await window.sampo.ai.listSuggestions())
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      loading.value = false
    }
  }

  async function saveApiKey(apiKey: string): Promise<void> {
    await submit(async () => {
      settings.value = unwrapResult(await window.sampo.ai.saveOpenAiApiKey({ apiKey }))
      message.value = 'API key saved locally.'
    })
  }

  async function deleteApiKey(): Promise<void> {
    await submit(async () => {
      settings.value = unwrapResult(await window.sampo.ai.deleteOpenAiApiKey())
      message.value = 'API key removed.'
    })
  }

  async function updateSettings(input: UpdateAiSettingsInputDto): Promise<void> {
    await submit(async () => {
      settings.value = unwrapResult(await window.sampo.ai.updateSettings(input))
      message.value = 'AI settings saved.'
    })
  }

  async function testConnection(): Promise<void> {
    await submit(async () => {
      lastConnectionTest.value = unwrapResult(await window.sampo.ai.testConnection())
      message.value = `Connection status: ${lastConnectionTest.value.status}.`
    })
  }

  async function classifyTransactions(transactionIds: string[]): Promise<void> {
    await submit(async () => {
      lastSummary.value = unwrapResult(await window.sampo.ai.smartClassify({ transactionIds }))
      await loadSuggestions()
      message.value = `${lastSummary.value.suggestionsCreated} AI suggestions created.`
    })
  }

  async function classifyImportBatch(importBatchId: string): Promise<void> {
    await submit(async () => {
      lastSummary.value = unwrapResult(
        await window.sampo.ai.smartClassifyImportBatch({ importBatchId })
      )
      await loadSuggestions()
      message.value = `${lastSummary.value.suggestionsCreated} AI suggestions created.`
    })
  }

  async function acceptSuggestion(
    suggestionId: string,
    options: { acceptCategory: boolean; acceptMerchant: boolean }
  ): Promise<void> {
    await submit(async () => {
      unwrapResult(await window.sampo.ai.acceptSuggestion({ suggestionId, ...options }))
      await loadSuggestions()
      message.value = 'AI suggestion accepted.'
    })
  }

  async function rejectSuggestion(suggestionId: string): Promise<void> {
    await submit(async () => {
      unwrapResult(await window.sampo.ai.rejectSuggestion({ suggestionId }))
      await loadSuggestions()
      message.value = 'AI suggestion rejected.'
    })
  }

  async function acceptHighConfidenceCategories(): Promise<void> {
    for (const suggestion of highConfidenceSuggestions.value) {
      await acceptSuggestion(suggestion.id, { acceptCategory: true, acceptMerchant: false })
    }
  }

  async function submit(action: () => Promise<void>): Promise<void> {
    if (submitting.value) return
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
    settings,
    suggestions,
    highConfidenceSuggestions,
    lastConnectionTest,
    lastSummary,
    loading,
    submitting,
    error,
    message,
    loadSettings,
    loadSuggestions,
    saveApiKey,
    deleteApiKey,
    updateSettings,
    testConnection,
    classifyTransactions,
    classifyImportBatch,
    acceptSuggestion,
    rejectSuggestion,
    acceptHighConfidenceCategories
  }
})
