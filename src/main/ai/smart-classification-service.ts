import type { Database } from 'better-sqlite3'
import { aiModelConfig, confidenceBand } from './config'
import { isDevelopmentRuntime } from './diagnostics'
import {
  AiDisabledError,
  AiPartialResponseError,
  InvalidAiSuggestionAcceptanceError
} from './errors'
import type {
  AiClassificationInput,
  AiClassificationProvider,
  AiClassificationResult
} from './provider'
import { normaliseMatchText } from '../categorisation/normalisation'
import { ClassificationService } from '../categorisation/classification-service'
import { AiSettingsRepository, AiSuggestionRepository } from '../storage/ai'
import {
  CategoryRepository,
  MerchantRepository,
  TransactionClassificationRepository
} from '../storage/categorisation'
import { TransactionRepository } from '../storage/transactions'
import type {
  AiClassificationSuggestion,
  Transaction,
  TransactionClassification
} from '../domain/schemas'

export type SmartClassifySummary = {
  eligibleTransactionCount: number
  uniqueDescriptionCount: number
  suggestionsCreated: number
  highConfidenceCategories: number
  mediumConfidenceCategories: number
  lowConfidenceCategories: number
  unknownCategories: number
  canonicalMerchantsSuggested: number
  webLookupsPerformed: number
  skippedDeterministicOrManual: number
}

export type AiSuggestionReviewComponentStatus = 'accepted' | 'preserved_manual' | 'not_suggested'

export type AiSuggestionReviewResult = {
  suggestion: AiClassificationSuggestion
  category: AiSuggestionReviewComponentStatus
  merchant: AiSuggestionReviewComponentStatus
}

export class SmartClassificationService {
  private readonly transactions: TransactionRepository
  private readonly classifications: TransactionClassificationRepository
  private readonly categories: CategoryRepository
  private readonly merchants: MerchantRepository
  private readonly settings: AiSettingsRepository
  private readonly suggestions: AiSuggestionRepository
  private readonly deterministic: ClassificationService
  private readonly activeTransactions = new Set<string>()

  constructor(
    private readonly database: Database,
    private readonly provider: AiClassificationProvider
  ) {
    this.transactions = new TransactionRepository(database)
    this.classifications = new TransactionClassificationRepository(database)
    this.categories = new CategoryRepository(database)
    this.merchants = new MerchantRepository(database)
    this.settings = new AiSettingsRepository(database)
    this.suggestions = new AiSuggestionRepository(database)
    this.deterministic = new ClassificationService(database)
  }

  async classifyTransactions(transactionIds: string[]): Promise<SmartClassifySummary> {
    const settings = this.settings.get()
    if (!settings.aiEnabled) throw new AiDisabledError()
    const transactions = this.transactions.listByIds([...new Set(transactionIds)])
    const eligible = transactions.filter((transaction) => this.isEligible(transaction))
    let skippedDeterministicOrManual = transactions.length - eligible.length
    const grouped = new Map<string, { input: AiClassificationInput; transactions: Transaction[] }>()

    for (const transaction of eligible) {
      if (this.activeTransactions.has(transaction.id)) {
        skippedDeterministicOrManual += 1
        continue
      }
      const proposal = this.deterministic.evaluateTransaction(transaction.id)
      if (proposal.status === 'confirmed' && proposal.source !== 'unclassified') {
        skippedDeterministicOrManual += 1
        continue
      }
      const descriptor = normaliseMatchText(transaction.originalDescription)
      grouped.set(
        descriptor,
        grouped.get(descriptor) ?? {
          input: {
            inputId: `item-${grouped.size + 1}`,
            descriptor,
            sourceContext:
              transaction.transactionType === 'expense' ? 'card_purchase' : 'account_movement'
          },
          transactions: []
        }
      )
      grouped.get(descriptor)!.transactions.push(transaction)
      this.activeTransactions.add(transaction.id)
    }

    const groups = [...grouped.values()]
    const summary: SmartClassifySummary = {
      eligibleTransactionCount: eligible.length,
      uniqueDescriptionCount: groups.length,
      suggestionsCreated: 0,
      highConfidenceCategories: 0,
      mediumConfidenceCategories: 0,
      lowConfidenceCategories: 0,
      unknownCategories: 0,
      canonicalMerchantsSuggested: 0,
      webLookupsPerformed: 0,
      skippedDeterministicOrManual
    }

    try {
      for (let index = 0; index < groups.length; index += aiModelConfig.batchSize) {
        const batch = groups.slice(index, index + aiModelConfig.batchSize)
        logProviderDiagnostic('classify request started', { uniqueCount: batch.length })
        const results = await this.provider.classify(
          batch.map((group) => group.input),
          {
            categories: this.activeCategoryChoices(),
            country: settings.country,
            city: settings.city,
            allowWebLookup: false
          }
        )
        const resultMap = this.validateProviderResults(
          batch.map((group) => group.input),
          results
        )

        for (const group of batch) {
          const initialResult = resultMap.get(group.input.inputId)
          if (!initialResult) throw new AiPartialResponseError()
          if (initialResult.category.categoryId)
            this.categories.assertAssignable(initialResult.category.categoryId)

          let result = initialResult
          let model = aiModelConfig.bulkClassificationModel
          let usedWebSearch = false
          let webLookupFailed = false

          if (settings.allowWebLookup && !initialResult.merchant?.canonicalName) {
            logProviderDiagnostic('targeted web lookup started', {
              inputId: group.input.inputId
            })
            try {
              const webResults = await this.provider.classify([group.input], {
                categories: this.activeCategoryChoices(),
                country: settings.country,
                city: settings.city,
                allowWebLookup: true,
                requireWebLookup: true
              })
              const webResult = this.validateProviderResults([group.input], webResults).get(
                group.input.inputId
              )
              if (!webResult) throw new AiPartialResponseError()
              if (webResult.category.categoryId)
                this.categories.assertAssignable(webResult.category.categoryId)

              result = mergeTargetedWebResult(initialResult, webResult)
              model = aiModelConfig.webLookupModel
              usedWebSearch = true
            } catch (error) {
              webLookupFailed = true
              logProviderDiagnostic('targeted web lookup failed; keeping initial result', {
                inputId: group.input.inputId,
                errorName: errorName(error),
                message: safeErrorMessage(error)
              })
            }
          }

          for (const transaction of group.transactions) {
            const suggestion = this.suggestions.create({
              transactionId: transaction.id,
              provider: 'openai',
              model,
              suggestedMerchantName: result.merchant?.canonicalName,
              suggestedCategoryId: result.category.categoryId,
              merchantConfidence: Math.round((result.merchant?.confidence ?? 0) * 1000),
              categoryConfidence: Math.round(result.category.confidence * 1000),
              needsWebLookup: webLookupFailed
                ? true
                : usedWebSearch
                  ? false
                  : result.needsWebLookup,
              usedWebSearch,
              reasonCode: result.reasonCode
            })
            for (const source of result.sources ?? [])
              this.suggestions.addSource(suggestion.id, source)
            this.countSuggestion(summary, suggestion)
          }
        }
      }
    } finally {
      for (const group of groups) {
        for (const transaction of group.transactions) this.activeTransactions.delete(transaction.id)
      }
    }

    return summary
  }

  listPendingSuggestions(): AiClassificationSuggestion[] {
    return this.suggestions.listPending()
  }

  acceptSuggestion(input: {
    suggestionId: string
    acceptCategory: boolean
    acceptMerchant: boolean
  }): AiSuggestionReviewResult {
    const mode = acceptanceMode(input)
    logReviewDiagnostic('workflow started', {
      mode,
      suggestionIdPresent: Boolean(input.suggestionId)
    })
    const accept = this.database.transaction((): AiSuggestionReviewResult => {
      logReviewDiagnostic('transaction started', { mode })
      const suggestion = this.suggestions.findById(input.suggestionId)
      if (suggestion.status === 'accepted') {
        logReviewDiagnostic('suggestion already accepted', { mode })
        return { suggestion, category: 'not_suggested', merchant: 'not_suggested' }
      }
      if (suggestion.status !== 'pending') {
        throw new InvalidAiSuggestionAcceptanceError('AI suggestion is not pending')
      }

      const existing = this.classifications.findByTransactionId(suggestion.transactionId)
      const category = reviewCategoryStatus(input, suggestion, existing)
      const merchant = reviewMerchantStatus(input, suggestion, existing)
      const shouldApplyCategory = category === 'accepted'
      const shouldApplyMerchant = merchant === 'accepted'
      if (
        category === 'not_suggested' &&
        merchant === 'not_suggested' &&
        (input.acceptCategory || input.acceptMerchant)
      ) {
        throw new InvalidAiSuggestionAcceptanceError()
      }

      if (shouldApplyCategory) this.categories.assertAssignable(suggestion.suggestedCategoryId)
      const merchantId = shouldApplyMerchant
        ? this.findOrCreateMerchant(suggestion.suggestedMerchantName!)
        : existing?.merchantId
      const categoryId = shouldApplyCategory ? suggestion.suggestedCategoryId : existing?.categoryId
      const merchantSource = shouldApplyMerchant ? 'ai' : existing?.merchantSource
      const categorySource = shouldApplyCategory ? 'ai' : existing?.categorySource

      if (shouldApplyCategory || shouldApplyMerchant) {
        this.classifications.save({
          transactionId: suggestion.transactionId,
          merchantId,
          merchantSource,
          categoryId,
          categorySource,
          usageType: existing?.usageType ?? 'unspecified',
          costBehaviour: existing?.costBehaviour ?? 'unspecified',
          necessity: existing?.necessity ?? 'unspecified',
          classificationSource: mergedClassificationSource({ merchantSource, categorySource }),
          classificationStatus: 'confirmed',
          appliedRuleId: undefined
        })
        logReviewDiagnostic('classification persisted', { mode })
      }

      const reviewedSuggestion =
        shouldApplyCategory || shouldApplyMerchant
          ? this.suggestions.mark(suggestion.id, 'accepted')
          : suggestion
      if (shouldApplyCategory || shouldApplyMerchant) {
        logReviewDiagnostic('suggestion status updated', { mode })
      }
      return { suggestion: reviewedSuggestion, category, merchant }
    })
    try {
      return accept()
    } catch (error) {
      logReviewDiagnostic('workflow failed', {
        mode,
        errorName: errorName(error),
        message: safeErrorMessage(error),
        sqliteCode: sqliteCode(error),
        sqliteConstraint: sqliteConstraint(error)
      })
      throw error
    }
  }

  rejectSuggestion(id: string): AiClassificationSuggestion {
    const reject = this.database.transaction(() => {
      const suggestion = this.suggestions.findById(id)
      if (suggestion.status !== 'pending') return suggestion
      return this.suggestions.mark(id, 'rejected')
    })
    return reject()
  }

  private validateProviderResults(
    inputs: AiClassificationInput[],
    results: AiClassificationResult[]
  ): Map<string, AiClassificationResult> {
    const expectedInputIds = new Set(inputs.map((input) => input.inputId))
    const resultMap = new Map(results.map((result) => [result.inputId, result]))
    if (
      resultMap.size !== results.length ||
      resultMap.size !== inputs.length ||
      results.some((result) => !expectedInputIds.has(result.inputId))
    ) {
      throw new AiPartialResponseError()
    }
    return resultMap
  }

  private isEligible(transaction: Transaction): boolean {
    return ['expense', 'refund', 'income', 'fee', 'tax'].includes(transaction.transactionType)
  }

  private activeCategoryChoices(): {
    id: string
    key?: string
    label: string
    parentLabel?: string
  }[] {
    const categories = this.categories.list()
    return categories
      .filter((category) => category.isActive)
      .map((category) => ({
        id: category.id,
        key: category.key,
        label: category.name,
        parentLabel: category.parentId
          ? categories.find((parent) => parent.id === category.parentId)?.name
          : undefined
      }))
  }

  private countSuggestion(
    summary: SmartClassifySummary,
    suggestion: AiClassificationSuggestion
  ): void {
    summary.suggestionsCreated += 1
    if (!suggestion.suggestedCategoryId) {
      summary.unknownCategories += 1
    } else if (confidenceBand(suggestion.categoryConfidence) === 'high') {
      summary.highConfidenceCategories += 1
    } else if (confidenceBand(suggestion.categoryConfidence) === 'medium') {
      summary.mediumConfidenceCategories += 1
    } else {
      summary.lowConfidenceCategories += 1
    }
    if (suggestion.suggestedMerchantName) summary.canonicalMerchantsSuggested += 1
    if (suggestion.usedWebSearch) summary.webLookupsPerformed += 1
  }

  private findOrCreateMerchant(name: string): string {
    const existing = this.merchants
      .list({ search: name })
      .find(
        (merchant) => merchant.name.toLocaleLowerCase('es-ES') === name.toLocaleLowerCase('es-ES')
      )
    return existing?.id ?? this.merchants.create({ name }).id
  }
}

function mergeTargetedWebResult(
  initial: AiClassificationResult,
  web: AiClassificationResult
): AiClassificationResult {
  const webMerchant = web.merchant?.canonicalName ? web.merchant : undefined
  const webCategory = web.category.categoryId ? web.category : undefined
  return {
    inputId: initial.inputId,
    merchant: webMerchant ?? initial.merchant,
    category: webCategory ?? initial.category,
    merchantType: web.merchantType ?? initial.merchantType,
    needsWebLookup: false,
    reasonCode: web.reasonCode,
    sources: web.sources
  }
}

function acceptanceMode(input: { acceptCategory: boolean; acceptMerchant: boolean }): string {
  if (input.acceptCategory && input.acceptMerchant) return 'both'
  if (input.acceptCategory) return 'category'
  if (input.acceptMerchant) return 'merchant'
  return 'none'
}

function reviewCategoryStatus(
  input: { acceptCategory: boolean },
  suggestion: AiClassificationSuggestion,
  existing: TransactionClassification | undefined
): AiSuggestionReviewComponentStatus {
  if (!input.acceptCategory || !suggestion.suggestedCategoryId) return 'not_suggested'
  if (existing?.categoryId && existing.categorySource === 'manual') return 'preserved_manual'
  return 'accepted'
}

function reviewMerchantStatus(
  input: { acceptMerchant: boolean },
  suggestion: AiClassificationSuggestion,
  existing: TransactionClassification | undefined
): AiSuggestionReviewComponentStatus {
  if (!input.acceptMerchant || !suggestion.suggestedMerchantName) return 'not_suggested'
  if (existing?.merchantId && existing.merchantSource === 'manual') return 'preserved_manual'
  return 'accepted'
}

function mergedClassificationSource(input: {
  merchantSource?: 'manual' | 'rule' | 'ai'
  categorySource?: 'manual' | 'rule' | 'ai'
}): 'manual' | 'rule' | 'ai' | 'unclassified' {
  if (input.merchantSource === 'manual' || input.categorySource === 'manual') return 'manual'
  if (input.merchantSource === 'ai' || input.categorySource === 'ai') return 'ai'
  if (input.merchantSource === 'rule' || input.categorySource === 'rule') return 'rule'
  return 'unclassified'
}

function logReviewDiagnostic(label: string, metadata: Record<string, unknown>): void {
  if (!isDevelopmentRuntime()) return
  console.warn(`[sampo-ai-review] ${label}`, metadata)
}

function logProviderDiagnostic(label: string, metadata: Record<string, unknown>): void {
  if (!isDevelopmentRuntime()) return
  console.warn(`[sampo-ai-provider] ${label}`, metadata)
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined
}

function sqliteCode(error: unknown): string | undefined {
  return typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}

function sqliteConstraint(error: unknown): string | undefined {
  const code = sqliteCode(error)
  if (!code?.startsWith('SQLITE_CONSTRAINT')) return undefined
  const message = error instanceof Error ? error.message : ''
  if (message.includes('classification_source')) return 'classification_source_check'
  if (message.includes('FOREIGN KEY')) return 'foreign_key'
  if (message.includes('NOT NULL')) return 'not_null'
  if (message.includes('UNIQUE')) return 'unique'
  if (message.includes('CHECK')) return 'check'
  return 'constraint'
}

function safeErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  const code = sqliteCode(error)
  if (code?.startsWith('SQLITE_CONSTRAINT')) return error.message
  if (error.name.endsWith('Error')) return error.message
  return undefined
}
