import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  AiConnectionTestDto,
  AiSettingsDto,
  AiSuggestionDto,
  AiSuggestionReviewDto,
  ListAiSuggestionsInputDto,
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

  async function loadSuggestions(input?: ListAiSuggestionsInputDto): Promise<void> {
    loading.value = true
    error.value = null
    try {
      suggestions.value = unwrapResult(await window.sampo.ai.listSuggestions(input))
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
    logTransactionsDiagnostic('classify clicked', { selectedCount: transactionIds.length })
    if (transactionIds.length === 0) {
      message.value = 'No eligible transactions selected.'
      error.value = null
      return
    }
    if (settings.value && !settings.value.aiEnabled) {
      message.value = null
      error.value = 'Enable AI categorisation in Settings first.'
      return
    }
    if (settings.value && !settings.value.keyConfigured) {
      message.value = null
      error.value = 'Configure an OpenAI API key in Settings first.'
      return
    }
    logTransactionsDiagnostic('selected ids prepared', { count: transactionIds.length })
    await submit(async () => {
      message.value = `Classifying ${transactionIds.length} transactions...`
      lastSummary.value = unwrapResult(await window.sampo.ai.smartClassify({ transactionIds }))
      await loadSuggestions()
      message.value = classifySummaryMessage(lastSummary.value)
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
    options: { acceptCategory: boolean; acceptMerchant: boolean },
    listInput?: ListAiSuggestionsInputDto
  ): Promise<void> {
    logAiStoreDiagnostic('review action started', {
      suggestionIdPresent: Boolean(suggestionId),
      action: acceptAction(options)
    })
    await submit(async () => {
      const review = unwrapResult(
        await window.sampo.ai.acceptSuggestion({ suggestionId, ...options })
      )
      await loadSuggestions(listInput)
      message.value = suggestionReviewMessage(review)
    })
  }

  async function rejectSuggestion(
    suggestionId: string,
    listInput?: ListAiSuggestionsInputDto
  ): Promise<void> {
    logAiStoreDiagnostic('review action started', {
      suggestionIdPresent: Boolean(suggestionId),
      action: 'reject'
    })
    await submit(async () => {
      const review = unwrapResult(await window.sampo.ai.rejectSuggestion({ suggestionId }))
      await loadSuggestions(listInput)
      message.value =
        review.suggestionStatus === 'rejected'
          ? 'AI suggestion rejected.'
          : 'AI suggestion unchanged.'
    })
  }

  async function acceptHighConfidenceCategories(
    listInput?: ListAiSuggestionsInputDto
  ): Promise<void> {
    for (const suggestion of highConfidenceSuggestions.value) {
      await acceptSuggestion(
        suggestion.id,
        { acceptCategory: true, acceptMerchant: false },
        listInput
      )
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

function suggestionReviewMessage(review: AiSuggestionReviewDto): string {
  const parts: string[] = []
  if (review.category === 'accepted') parts.push('Category accepted')
  if (review.category === 'preserved_manual') parts.push('Manual category preserved')
  if (review.merchant === 'accepted') parts.push('Merchant accepted')
  if (review.merchant === 'preserved_manual') parts.push('Manual merchant preserved')
  return parts.length > 0 ? parts.join(' - ') : 'AI suggestion unchanged.'
}

function classifySummaryMessage(summary: SmartClassifySummaryDto): string {
  if (summary.eligibleTransactionCount === 0) return 'No eligible transactions selected.'
  if (summary.suggestionsCreated === 0) {
    return `${summary.eligibleTransactionCount} transactions processed - no new AI suggestions.`
  }
  if (summary.suggestionsCreated === summary.eligibleTransactionCount) {
    return `${summary.suggestionsCreated} AI suggestions ready for review.`
  }
  return `${summary.eligibleTransactionCount} transactions processed - ${summary.suggestionsCreated} suggestions created - ${summary.skippedDeterministicOrManual} skipped.`
}

function logTransactionsDiagnostic(label: string, metadata: Record<string, unknown>): void {
  if (import.meta.env.PROD) return
  console.warn(`[sampo-transactions] ${label}`, metadata)
}

function logAiStoreDiagnostic(label: string, metadata: Record<string, unknown>): void {
  if (import.meta.env.PROD) return
  console.warn(`[sampo-ai-store] ${label}`, metadata)
}

function acceptAction(options: { acceptCategory: boolean; acceptMerchant: boolean }): string {
  if (options.acceptCategory && options.acceptMerchant) return 'accept_both'
  if (options.acceptCategory) return 'accept_category'
  if (options.acceptMerchant) return 'accept_merchant'
  return 'accept'
}
