import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { EntityNotFoundError } from '../domain/errors'

export type RecurringSeriesStatus = 'candidate' | 'confirmed' | 'rejected'
export type RecurringSeriesType =
  'subscription' | 'recurring_bill' | 'recurring_payment' | 'unknown' | 'not_recurring'
export type RecurringCadence = 'monthly' | 'quarterly' | 'yearly' | 'irregular'
export type RecurringConfidence = 'low' | 'medium' | 'high'
export type RecurringMatchingBasis = 'merchant' | 'description'

export type RecurringSeries = {
  id: string
  seriesKey: string
  matchingBasis: RecurringMatchingBasis
  merchantId?: string
  merchantName?: string
  canonicalDescription: string
  recurrenceType: RecurringSeriesType
  cadence: RecurringCadence
  status: RecurringSeriesStatus
  typicalAmountCents: number
  minAmountCents: number
  maxAmountCents: number
  amountVariabilityBasisPoints: number
  firstSeen: string
  lastSeen: string
  occurrenceCount: number
  confidence: RecurringConfidence
  confidenceScore: number
  createdAt: string
  updatedAt: string
}

export type RecurringSeriesOccurrence = {
  transactionId: string
  transactionDate: string
  description: string
  amountCents: number
  currency: string
  merchantName?: string
  categoryPath?: string[]
}

export type RecurringSeriesInput = Omit<
  RecurringSeries,
  'id' | 'merchantName' | 'createdAt' | 'updatedAt'
> & {
  transactionIds: string[]
}

type Row = Record<string, unknown>

export class RecurringSeriesRepository {
  constructor(private readonly database: Database) {}

  list(): RecurringSeries[] {
    return this.database
      .prepare(
        `
          SELECT series.*, merchants.name AS merchant_name
          FROM recurring_series series
          LEFT JOIN merchants ON merchants.id = series.merchant_id
          ORDER BY
            CASE series.status WHEN 'candidate' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END,
            series.confidence_score DESC,
            series.last_seen DESC,
            lower(series.canonical_description)
        `
      )
      .all()
      .map((row) => mapSeries(row as Row))
  }

  findById(id: string): RecurringSeries {
    const row = this.database
      .prepare(
        `
          SELECT series.*, merchants.name AS merchant_name
          FROM recurring_series series
          LEFT JOIN merchants ON merchants.id = series.merchant_id
          WHERE series.id = ?
        `
      )
      .get(id)

    if (!row) {
      throw new EntityNotFoundError('RecurringSeries', id)
    }

    return mapSeries(row as Row)
  }

  findBySeriesKey(seriesKey: string): RecurringSeries | undefined {
    const row = this.database
      .prepare(
        `
          SELECT series.*, merchants.name AS merchant_name
          FROM recurring_series series
          LEFT JOIN merchants ON merchants.id = series.merchant_id
          WHERE series.series_key = ?
        `
      )
      .get(seriesKey)

    return row ? mapSeries(row as Row) : undefined
  }

  upsertCandidate(input: RecurringSeriesInput): RecurringSeries {
    const existing = this.findBySeriesKey(input.seriesKey)
    const now = new Date().toISOString()
    const id = existing?.id ?? randomUUID()
    const status = existing?.status ?? input.status
    const recurrenceType =
      existing?.status === 'confirmed' || existing?.status === 'rejected'
        ? existing.recurrenceType
        : input.recurrenceType

    if (existing) {
      this.database
        .prepare(
          `
            UPDATE recurring_series
            SET matching_basis = @matchingBasis,
                merchant_id = @merchantId,
                canonical_description = @canonicalDescription,
                recurrence_type = @recurrenceType,
                cadence = @cadence,
                status = @status,
                typical_amount_cents = @typicalAmountCents,
                min_amount_cents = @minAmountCents,
                max_amount_cents = @maxAmountCents,
                amount_variability_basis_points = @amountVariabilityBasisPoints,
                first_seen = @firstSeen,
                last_seen = @lastSeen,
                occurrence_count = @occurrenceCount,
                confidence = @confidence,
                confidence_score = @confidenceScore,
                updated_at = @updatedAt
            WHERE id = @id
          `
        )
        .run({
          ...input,
          id,
          status,
          recurrenceType,
          merchantId: input.merchantId ?? null,
          updatedAt: now
        })
    } else {
      this.database
        .prepare(
          `
            INSERT INTO recurring_series (
              id, series_key, matching_basis, merchant_id, canonical_description,
              recurrence_type, cadence, status, typical_amount_cents, min_amount_cents,
              max_amount_cents, amount_variability_basis_points, first_seen, last_seen,
              occurrence_count, confidence, confidence_score, created_at, updated_at
            )
            VALUES (
              @id, @seriesKey, @matchingBasis, @merchantId, @canonicalDescription,
              @recurrenceType, @cadence, @status, @typicalAmountCents, @minAmountCents,
              @maxAmountCents, @amountVariabilityBasisPoints, @firstSeen, @lastSeen,
              @occurrenceCount, @confidence, @confidenceScore, @createdAt, @updatedAt
            )
          `
        )
        .run({
          ...input,
          id,
          status,
          recurrenceType,
          merchantId: input.merchantId ?? null,
          createdAt: now,
          updatedAt: now
        })
    }

    this.replaceTransactions(id, input.transactionIds)
    return this.findById(id)
  }

  confirm(
    id: string,
    recurrenceType: Exclude<RecurringSeriesType, 'unknown' | 'not_recurring'>
  ): RecurringSeries {
    this.findById(id)
    this.database
      .prepare(
        `
          UPDATE recurring_series
          SET recurrence_type = @recurrenceType,
              status = 'confirmed',
              updated_at = @updatedAt
          WHERE id = @id
        `
      )
      .run({ id, recurrenceType, updatedAt: new Date().toISOString() })
    return this.findById(id)
  }

  reject(id: string): RecurringSeries {
    this.findById(id)
    this.database
      .prepare(
        `
          UPDATE recurring_series
          SET recurrence_type = 'not_recurring',
              status = 'rejected',
              updated_at = @updatedAt
          WHERE id = @id
        `
      )
      .run({ id, updatedAt: new Date().toISOString() })
    return this.findById(id)
  }

  listOccurrences(seriesId: string): RecurringSeriesOccurrence[] {
    return this.database
      .prepare(
        `
          SELECT
            transactions.id AS transaction_id,
            transactions.transaction_date,
            transactions.original_description,
            transactions.amount_cents,
            transactions.currency,
            merchants.name AS merchant_name,
            category.name AS category_name,
            parent.name AS parent_category_name
          FROM recurring_series_transactions links
          JOIN transactions ON transactions.id = links.transaction_id
          LEFT JOIN transaction_classifications classification
            ON classification.transaction_id = transactions.id
          LEFT JOIN merchants ON merchants.id = classification.merchant_id
          LEFT JOIN categories category ON category.id = classification.category_id
          LEFT JOIN categories parent ON parent.id = category.parent_id
          WHERE links.recurring_series_id = ?
          ORDER BY transactions.transaction_date ASC, transactions.created_at ASC
        `
      )
      .all(seriesId)
      .map((row) => {
        const value = row as Row
        const parent = optionalString(value['parent_category_name'])
        const category = optionalString(value['category_name'])
        return {
          transactionId: String(value['transaction_id']),
          transactionDate: String(value['transaction_date']),
          description: String(value['original_description']),
          amountCents: Number(value['amount_cents']),
          currency: String(value['currency']),
          merchantName: optionalString(value['merchant_name']),
          categoryPath: category ? (parent ? [parent, category] : [category]) : undefined
        }
      })
  }

  countByStatus(): { candidateCount: number; confirmedCount: number; rejectedCount: number } {
    const row = this.database
      .prepare(
        `
          SELECT
            SUM(CASE WHEN status = 'candidate' THEN 1 ELSE 0 END) AS candidateCount,
            SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmedCount,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejectedCount
          FROM recurring_series
        `
      )
      .get() as {
      candidateCount: number | null
      confirmedCount: number | null
      rejectedCount: number | null
    }

    return {
      candidateCount: row.candidateCount ?? 0,
      confirmedCount: row.confirmedCount ?? 0,
      rejectedCount: row.rejectedCount ?? 0
    }
  }

  private replaceTransactions(seriesId: string, transactionIds: string[]): void {
    this.database
      .prepare('DELETE FROM recurring_series_transactions WHERE recurring_series_id = ?')
      .run(seriesId)
    const insert = this.database.prepare(
      `
        INSERT INTO recurring_series_transactions (recurring_series_id, transaction_id)
        VALUES (?, ?)
      `
    )
    for (const transactionId of transactionIds) {
      insert.run(seriesId, transactionId)
    }
  }
}

function mapSeries(row: Row): RecurringSeries {
  return {
    id: String(row['id']),
    seriesKey: String(row['series_key']),
    matchingBasis: row['matching_basis'] as RecurringMatchingBasis,
    merchantId: optionalString(row['merchant_id']),
    merchantName: optionalString(row['merchant_name']),
    canonicalDescription: String(row['canonical_description']),
    recurrenceType: row['recurrence_type'] as RecurringSeriesType,
    cadence: row['cadence'] as RecurringCadence,
    status: row['status'] as RecurringSeriesStatus,
    typicalAmountCents: Number(row['typical_amount_cents']),
    minAmountCents: Number(row['min_amount_cents']),
    maxAmountCents: Number(row['max_amount_cents']),
    amountVariabilityBasisPoints: Number(row['amount_variability_basis_points']),
    firstSeen: String(row['first_seen']),
    lastSeen: String(row['last_seen']),
    occurrenceCount: Number(row['occurrence_count']),
    confidence: row['confidence'] as RecurringConfidence,
    confidenceScore: Number(row['confidence_score']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at'])
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
