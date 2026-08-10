import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import {
  aiClassificationSuggestionSchema,
  type AiClassificationSuggestion
} from '../domain/schemas'
import { AiSuggestionNotFoundError } from '../ai/errors'

type Row = Record<string, unknown>

export type AiSettings = {
  aiEnabled: boolean
  classifyNewImports: boolean
  allowWebLookup: boolean
  autoAcceptHighConfidence: boolean
  country?: string
  city?: string
}

export type NewAiSuggestion = {
  transactionId: string
  provider: string
  model: string
  suggestedMerchantName?: string
  suggestedCategoryId?: string
  merchantConfidence: number
  categoryConfidence: number
  needsWebLookup: boolean
  usedWebSearch: boolean
  reasonCode: AiClassificationSuggestion['reasonCode']
}

export class AiSettingsRepository {
  constructor(private readonly database: Database) {}

  get(): AiSettings {
    const row = this.database.prepare('SELECT * FROM ai_settings WHERE id = 1').get() as Row
    return {
      aiEnabled: Boolean(row['ai_enabled']),
      classifyNewImports: Boolean(row['classify_new_imports']),
      allowWebLookup: Boolean(row['allow_web_lookup']),
      autoAcceptHighConfidence: Boolean(row['auto_accept_high_confidence']),
      country: (row['country'] as string | null) ?? undefined,
      city: (row['city'] as string | null) ?? undefined
    }
  }

  update(input: Partial<AiSettings>): AiSettings {
    const existing = this.get()
    const next = { ...existing, ...input }
    this.database
      .prepare(
        `
          UPDATE ai_settings
          SET ai_enabled = @aiEnabled,
              classify_new_imports = @classifyNewImports,
              allow_web_lookup = @allowWebLookup,
              auto_accept_high_confidence = @autoAcceptHighConfidence,
              country = @country,
              city = @city,
              updated_at = @updatedAt
          WHERE id = 1
        `
      )
      .run({
        aiEnabled: next.aiEnabled ? 1 : 0,
        classifyNewImports: next.classifyNewImports ? 1 : 0,
        allowWebLookup: next.allowWebLookup ? 1 : 0,
        autoAcceptHighConfidence: next.autoAcceptHighConfidence ? 1 : 0,
        country: next.country ?? null,
        city: next.city ?? null,
        updatedAt: new Date().toISOString()
      })
    return this.get()
  }
}

export class AiSuggestionRepository {
  constructor(private readonly database: Database) {}

  listPending(): AiClassificationSuggestion[] {
    return this.database
      .prepare(
        `
          SELECT * FROM ai_classification_suggestions
          WHERE status = 'pending'
          ORDER BY category_confidence DESC, merchant_confidence DESC, created_at DESC
        `
      )
      .all()
      .map((row) => mapSuggestion(row as Row))
  }

  listForTransactions(transactionIds: string[]): AiClassificationSuggestion[] {
    if (transactionIds.length === 0) return []
    const placeholders = transactionIds.map(() => '?').join(', ')
    return this.database
      .prepare(
        `
          SELECT * FROM ai_classification_suggestions
          WHERE transaction_id IN (${placeholders})
          ORDER BY created_at DESC
        `
      )
      .all(...transactionIds)
      .map((row) => mapSuggestion(row as Row))
  }

  findById(id: string): AiClassificationSuggestion {
    const row = this.database
      .prepare('SELECT * FROM ai_classification_suggestions WHERE id = ?')
      .get(id)
    if (!row) throw new AiSuggestionNotFoundError()
    return mapSuggestion(row as Row)
  }

  create(input: NewAiSuggestion): AiClassificationSuggestion {
    this.supersedePendingForTransaction(input.transactionId)
    const id = randomUUID()
    const now = new Date().toISOString()
    this.database
      .prepare(
        `
          INSERT INTO ai_classification_suggestions (
            id, transaction_id, provider, model, suggested_merchant_name, suggested_category_id,
            merchant_confidence, category_confidence, needs_web_lookup, status, used_web_search,
            reason_code, created_at
          )
          VALUES (
            @id, @transactionId, @provider, @model, @suggestedMerchantName, @suggestedCategoryId,
            @merchantConfidence, @categoryConfidence, @needsWebLookup, 'pending', @usedWebSearch,
            @reasonCode, @createdAt
          )
        `
      )
      .run({
        id,
        transactionId: input.transactionId,
        provider: input.provider,
        model: input.model,
        suggestedMerchantName: input.suggestedMerchantName ?? null,
        suggestedCategoryId: input.suggestedCategoryId ?? null,
        merchantConfidence: input.merchantConfidence,
        categoryConfidence: input.categoryConfidence,
        needsWebLookup: input.needsWebLookup ? 1 : 0,
        usedWebSearch: input.usedWebSearch ? 1 : 0,
        reasonCode: input.reasonCode,
        createdAt: now
      })
    return this.findById(id)
  }

  mark(
    id: string,
    status: 'accepted' | 'rejected' | 'failed' | 'superseded'
  ): AiClassificationSuggestion {
    this.database
      .prepare(
        `
          UPDATE ai_classification_suggestions
          SET status = @status, reviewed_at = @reviewedAt
          WHERE id = @id
        `
      )
      .run({ id, status, reviewedAt: new Date().toISOString() })
    return this.findById(id)
  }

  addSource(suggestionId: string, input: { title: string; url: string }): void {
    const url = new URL(input.url)
    if (url.protocol !== 'https:') {
      throw new Error('Only HTTPS suggestion sources are allowed')
    }
    this.database
      .prepare(
        `
          INSERT INTO ai_suggestion_sources (id, suggestion_id, title, url, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(randomUUID(), suggestionId, input.title, url.toString(), new Date().toISOString())
  }

  private supersedePendingForTransaction(transactionId: string): void {
    this.database
      .prepare(
        `
          UPDATE ai_classification_suggestions
          SET status = 'superseded', reviewed_at = ?
          WHERE transaction_id = ? AND status = 'pending'
        `
      )
      .run(new Date().toISOString(), transactionId)
  }
}

function mapSuggestion(row: Row): AiClassificationSuggestion {
  return aiClassificationSuggestionSchema.parse({
    id: row['id'],
    transactionId: row['transaction_id'],
    provider: row['provider'],
    model: row['model'],
    suggestedMerchantName: row['suggested_merchant_name'] ?? undefined,
    suggestedCategoryId: row['suggested_category_id'] ?? undefined,
    merchantConfidence: row['merchant_confidence'],
    categoryConfidence: row['category_confidence'],
    needsWebLookup: Boolean(row['needs_web_lookup']),
    status: row['status'],
    usedWebSearch: Boolean(row['used_web_search']),
    reasonCode: row['reason_code'],
    createdAt: row['created_at'],
    reviewedAt: row['reviewed_at'] ?? undefined
  })
}
