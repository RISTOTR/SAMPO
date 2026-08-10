import type { Database } from 'better-sqlite3'
import { aiModelConfig, confidenceBand } from './config'
import { isDevelopmentRuntime } from './diagnostics'
import {
  AiDisabledError,
  AiPartialResponseError,
  InvalidAiSuggestionAcceptanceError
} from './errors'
import type { AiClassificationInput, AiClassificationProvider } from './provider'
import { normaliseMatchText } from '../categorisation/normalisation'
import { ClassificationService } from '../categorisation/classification-service'
import { AiSettingsRepository, AiSuggestionRepository } from '../storage/ai'
import {
  CategoryRepository,
  MerchantAliasRepository,
  MerchantRepository,
  TransactionClassificationRepository
} from '../storage/categorisation'
import { TransactionRepository } from '../storage/transactions'
import type { AiClassificationSuggestion, Transaction } from '../domain/schemas'
import { ManualClassificationPreservedError } from '../categorisation/errors'

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

export class SmartClassificationService {
  private readonly transactions: TransactionRepository
  private readonly classifications: TransactionClassificationRepository
  private readonly categories: CategoryRepository
  private readonly merchants: MerchantRepository
  private readonly aliases: MerchantAliasRepository
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
    this.aliases = new MerchantAliasRepository(database)
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
      if (
        proposal.source === 'manual' ||
        (proposal.source === 'rule' && proposal.status === 'confirmed')
      ) {
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
        const results = await this.provider.classify(
          batch.map((group) => group.input),
          {
            categories: this.activeCategoryChoices(),
            country: settings.country,
            city: settings.city,
            allowWebLookup: settings.allowWebLookup
          }
        )
        const expectedInputIds = new Set(batch.map((group) => group.input.inputId))
        const resultMap = new Map(results.map((result) => [result.inputId, result]))
        if (
          resultMap.size !== results.length ||
          resultMap.size !== batch.length ||
          results.some((result) => !expectedInputIds.has(result.inputId))
        ) {
          throw new AiPartialResponseError()
        }

        for (const group of batch) {
          const result = resultMap.get(group.input.inputId)
          if (!result) throw new AiPartialResponseError()
          if (result.category.categoryId)
            this.categories.assertAssignable(result.category.categoryId)

          for (const transaction of group.transactions) {
            const suggestion = this.suggestions.create({
              transactionId: transaction.id,
              provider: 'openai',
              model: settings.allowWebLookup
                ? aiModelConfig.webLookupModel
                : aiModelConfig.bulkClassificationModel,
              suggestedMerchantName: result.merchant?.canonicalName,
              suggestedCategoryId: result.category.categoryId,
              merchantConfidence: Math.round((result.merchant?.confidence ?? 0) * 1000),
              categoryConfidence: Math.round(result.category.confidence * 1000),
              needsWebLookup: result.needsWebLookup,
              usedWebSearch: Boolean(result.sources?.length),
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
  }): AiClassificationSuggestion {
    const mode = acceptanceMode(input)
    logReviewDiagnostic('workflow started', {
      mode,
      suggestionIdPresent: Boolean(input.suggestionId)
    })
    const accept = this.database.transaction(() => {
      logReviewDiagnostic('transaction started', { mode })
      const suggestion = this.suggestions.findById(input.suggestionId)
      if (suggestion.status === 'accepted') {
        logReviewDiagnostic('suggestion already accepted', { mode })
        return suggestion
      }
      if (suggestion.status !== 'pending') {
        throw new InvalidAiSuggestionAcceptanceError('AI suggestion is not pending')
      }

      const existing = this.classifications.findByTransactionId(suggestion.transactionId)
      if (existing?.classificationSource === 'manual') {
        throw new ManualClassificationPreservedError()
      }

      const shouldApplyCategory = input.acceptCategory && Boolean(suggestion.suggestedCategoryId)
      const shouldApplyMerchant = input.acceptMerchant && Boolean(suggestion.suggestedMerchantName)
      if (!shouldApplyCategory && !shouldApplyMerchant) {
        throw new InvalidAiSuggestionAcceptanceError()
      }

      if (shouldApplyCategory) this.categories.assertAssignable(suggestion.suggestedCategoryId)
      const merchantId = shouldApplyMerchant
        ? this.findOrCreateMerchant(suggestion.suggestedMerchantName!)
        : existing?.merchantId

      this.classifications.save({
        transactionId: suggestion.transactionId,
        merchantId,
        categoryId: shouldApplyCategory ? suggestion.suggestedCategoryId : existing?.categoryId,
        usageType: existing?.usageType ?? 'unspecified',
        costBehaviour: existing?.costBehaviour ?? 'unspecified',
        necessity: existing?.necessity ?? 'unspecified',
        classificationSource: 'ai',
        classificationStatus: 'confirmed',
        appliedRuleId: undefined
      })
      logReviewDiagnostic('classification persisted', { mode })

      if (shouldApplyMerchant && merchantId) {
        const transaction = this.transactions.findById(suggestion.transactionId)
        this.aliases.create({
          merchantId,
          matchKind: 'exact',
          pattern: transaction.originalDescription,
          priority: 0
        })
        logReviewDiagnostic('merchant alias persisted', { mode })
      }
      const accepted = this.suggestions.mark(suggestion.id, 'accepted')
      logReviewDiagnostic('suggestion status updated', { mode })
      return accepted
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
    return this.suggestions.mark(id, 'rejected')
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

function acceptanceMode(input: { acceptCategory: boolean; acceptMerchant: boolean }): string {
  if (input.acceptCategory && input.acceptMerchant) return 'both'
  if (input.acceptCategory) return 'category'
  if (input.acceptMerchant) return 'merchant'
  return 'none'
}

function logReviewDiagnostic(label: string, metadata: Record<string, unknown>): void {
  if (!isDevelopmentRuntime()) return
  console.warn(`[sampo-ai-review] ${label}`, metadata)
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
