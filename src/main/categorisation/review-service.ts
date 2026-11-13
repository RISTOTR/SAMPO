import type { Database } from 'better-sqlite3'
import {
  reviewAcceptInputDtoSchema,
  reviewListInputDtoSchema,
  reviewPageDtoSchema,
  reviewRejectInputDtoSchema,
  type ReviewItemDto,
  type ReviewPageDto
} from '../../shared/dtos'
import { aiConfidenceThresholds } from '../ai/config'
import type { AiClassificationSuggestion, TransactionClassification } from '../domain/schemas'
import { ClassificationService, type ClassificationProposal } from './classification-service'
import { TransactionRepository } from '../storage/transactions'
import {
  CategoryRepository,
  MerchantRepository,
  TransactionClassificationRepository
} from '../storage/categorisation'
import { AiSuggestionRepository } from '../storage/ai'

/** A projection over existing classifications, never a second classification model. */
export class ReviewService {
  private readonly classifier: ClassificationService
  private readonly transactions: TransactionRepository
  private readonly classifications: TransactionClassificationRepository
  private readonly suggestions: AiSuggestionRepository
  private readonly merchants: MerchantRepository
  private readonly categories: CategoryRepository

  constructor(private readonly database: Database) {
    this.classifier = new ClassificationService(database)
    this.transactions = new TransactionRepository(database)
    this.classifications = new TransactionClassificationRepository(database)
    this.suggestions = new AiSuggestionRepository(database)
    this.merchants = new MerchantRepository(database)
    this.categories = new CategoryRepository(database)
  }

  list(input: unknown): ReviewPageDto {
    const query = reviewListInputDtoSchema.parse(input ?? {})
    const ids = this.transactions.listFilteredIds({
      sortBy: 'transactionDate',
      sortDirection: 'desc',
      ...query.transactionQuery
    })
    const items: ReviewItemDto[] = []
    let total = 0
    for (const id of ids) {
      const stored = this.classifications.findByTransactionId(id)
      if (stored?.classificationStatus === 'confirmed' && stored.merchantId && stored.categoryId)
        continue
      const { item, complete } = this.resolve(id)
      if (complete) continue
      const sources = [
        item.canAcceptMerchant ? item.merchantSource : undefined,
        item.canAcceptCategory ? item.categorySource : undefined
      ]
      if (
        query.source === 'Local' &&
        !sources.some((source) => ['Learned', 'Historical match', 'Rule'].includes(source ?? ''))
      )
        continue
      if (query.source === 'AI' && !sources.some((source) => source?.startsWith('AI'))) continue
      if (query.source === 'Unclassified' && (item.canAcceptCategory || item.canAcceptMerchant))
        continue
      if (total >= query.offset && items.length < query.limit) items.push(item)
      total++
    }
    return reviewPageDtoSchema.parse({ items, total })
  }

  accept(input: unknown): number {
    const parsed = reviewAcceptInputDtoSchema.parse(input)
    return this.database.transaction(() => {
      let count = 0
      for (const id of new Set(parsed.transactionIds)) {
        const { item, proposal, existing, suggestion, complete } = this.resolve(id)
        if (complete) continue
        if (parsed.transactionIds.length > 1 && !item.canBulkAccept) continue
        const merchant = parsed.acceptMerchant && item.canAcceptMerchant
        const category = parsed.acceptCategory && item.canAcceptCategory
        if (!merchant && !category) continue
        const confirmed = existing?.classificationStatus === 'confirmed' ? existing : undefined
        const merchantId = merchant
          ? (proposal.merchantId ?? this.findOrCreateMerchant(item.merchantName!))
          : confirmed?.merchantId
        const categoryId = category
          ? (proposal.categoryId ?? suggestion?.suggestedCategoryId)
          : confirmed?.categoryId
        if (category) this.categories.assertAssignable(categoryId)
        this.classifications.save({
          transactionId: id,
          merchantId,
          categoryId,
          merchantSource: merchant
            ? item.merchantSource.startsWith('AI')
              ? 'ai'
              : 'manual'
            : confirmed?.merchantSource,
          categorySource: category
            ? item.categorySource.startsWith('AI')
              ? 'ai'
              : 'manual'
            : confirmed?.categorySource,
          usageType: proposal.usageType,
          costBehaviour: proposal.costBehaviour,
          necessity: proposal.necessity,
          classificationSource: 'manual',
          classificationStatus: 'confirmed'
        })
        if (
          suggestion &&
          ((merchant && item.merchantSource.startsWith('AI')) ||
            (category && item.categorySource.startsWith('AI'))) &&
          (!suggestion.suggestedCategoryId || suggestion.suggestedCategoryId === categoryId) &&
          (!suggestion.suggestedMerchantName ||
            (merchantId &&
              this.merchants.findById(merchantId).name.toLowerCase() ===
                suggestion.suggestedMerchantName.toLowerCase()))
        ) {
          this.suggestions.mark(suggestion.id, 'accepted')
        }
        count++
      }
      return count
    })()
  }

  reject(input: unknown): void {
    const { transactionId } = reviewRejectInputDtoSchema.parse(input)
    this.database.transaction(() => {
      const { item, proposal, suggestion } = this.resolve(transactionId)
      for (const field of ['merchant', 'category'] as const) {
        const value = field === 'merchant' ? proposal.merchantId : proposal.categoryId
        const actionable = field === 'merchant' ? item.canAcceptMerchant : item.canAcceptCategory
        if (value && actionable)
          this.database
            .prepare(
              'INSERT OR IGNORE INTO classification_review_rejections (transaction_id, field, value) VALUES (?, ?, ?)'
            )
            .run(transactionId, field, value)
      }
      if (suggestion) this.suggestions.mark(suggestion.id, 'rejected')
    })()
  }

  private resolve(id: string): {
    item: ReviewItemDto
    proposal: ClassificationProposal
    existing: TransactionClassification | undefined
    suggestion: AiClassificationSuggestion | undefined
    complete: boolean
  } {
    const transaction = this.transactions.findById(id)
    const existing = this.classifications.findByTransactionId(id)
    const confirmed = existing?.classificationStatus === 'confirmed' ? existing : undefined
    const proposal = this.classifier.evaluateTransaction(id)
    const suggestion = this.suggestions.listPendingForTransactions([id])[0]
    const conflict = proposal.conflicts.length > 0
    const merchantName =
      proposal.merchantName ?? (!conflict ? suggestion?.suggestedMerchantName : undefined)
    const categoryId =
      proposal.categoryId ?? (!conflict ? suggestion?.suggestedCategoryId : undefined)
    const category = categoryId ? this.categories.findById(categoryId) : undefined
    const categoryPath = category
      ? category.parentId
        ? [this.categories.findById(category.parentId).name, category.name]
        : [category.name]
      : undefined
    const aiSource = suggestion?.usedWebSearch ? 'AI + Web' : 'AI'
    const canAcceptMerchant = !confirmed?.merchantId && Boolean(merchantName) && !conflict
    const canAcceptCategory = !confirmed?.categoryId && Boolean(categoryId) && !conflict
    const merchantSource = proposal.merchantId
      ? (proposal.merchantBasis ?? 'Learned')
      : merchantName
        ? aiSource
        : 'Unclassified'
    const categorySource = proposal.categoryId
      ? (proposal.categoryBasis ?? 'Learned')
      : categoryId
        ? aiSource
        : 'Unclassified'
    const item: ReviewItemDto = {
      transactionId: id,
      description: transaction.originalDescription,
      date: transaction.transactionDate,
      amountCents: transaction.amountCents,
      currency: transaction.currency,
      merchantName,
      categoryPath,
      merchantSource,
      categorySource,
      conflict,
      merchantConfidence: merchantSource.startsWith('AI')
        ? suggestion?.merchantConfidence
        : undefined,
      categoryConfidence: categorySource.startsWith('AI')
        ? suggestion?.categoryConfidence
        : undefined,
      canAcceptMerchant,
      canAcceptCategory,
      canBulkAccept:
        (canAcceptMerchant || canAcceptCategory) &&
        !(
          canAcceptMerchant &&
          merchantSource.startsWith('AI') &&
          (suggestion?.merchantConfidence ?? 0) < aiConfidenceThresholds.high
        ) &&
        !(
          canAcceptCategory &&
          categorySource.startsWith('AI') &&
          (suggestion?.categoryConfidence ?? 0) < aiConfidenceThresholds.high
        )
    }
    return {
      item,
      proposal,
      existing,
      suggestion,
      complete: Boolean(confirmed?.merchantId && confirmed.categoryId)
    }
  }

  private findOrCreateMerchant(name: string): string {
    return (
      this.merchants
        .list({ search: name })
        .find((merchant) => merchant.name.toLowerCase() === name.toLowerCase())?.id ??
      this.merchants.create({ name }).id
    )
  }
}
