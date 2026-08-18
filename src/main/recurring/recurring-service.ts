import type { Database } from 'better-sqlite3'
import { normaliseMatchText } from '../categorisation/normalisation'
import {
  RecurringSeriesRepository,
  type RecurringCadence,
  type RecurringConfidence,
  type RecurringMatchingBasis,
  type RecurringSeries,
  type RecurringSeriesOccurrence,
  type RecurringSeriesType
} from '../storage/recurring'

type CandidateTransaction = {
  id: string
  transactionDate: string
  originalDescription: string
  amountCents: number
  merchantId?: string
  merchantName?: string
}

type CandidateGroup = {
  seriesKey: string
  matchingBasis: RecurringMatchingBasis
  merchantId?: string
  canonicalDescription: string
  transactions: CandidateTransaction[]
}

export type RecurringScanSummary = {
  candidateCount: number
  confirmedCount: number
  rejectedCount: number
  scannedGroupCount: number
  linkedTransactionCount: number
}

const cadenceRanges: Record<
  Exclude<RecurringCadence, 'irregular'>,
  { min: number; max: number }
> = {
  monthly: { min: 25, max: 35 },
  quarterly: { min: 75, max: 105 },
  yearly: { min: 330, max: 400 }
}

export class RecurringDetectionService {
  private readonly series: RecurringSeriesRepository

  constructor(private readonly database: Database) {
    this.series = new RecurringSeriesRepository(database)
  }

  scan(): RecurringScanSummary {
    const scan = this.database.transaction(() => {
      const groups = this.candidateGroups()
      let linkedTransactionCount = 0

      for (const group of groups) {
        const candidate = buildCandidate(group)
        if (!candidate) continue
        this.series.upsertCandidate(candidate)
        linkedTransactionCount += candidate.transactionIds.length
      }

      return {
        ...this.series.countByStatus(),
        scannedGroupCount: groups.length,
        linkedTransactionCount
      }
    })

    return scan()
  }

  list(): RecurringSeries[] {
    return this.series.list()
  }

  get(id: string): RecurringSeries & { occurrences: RecurringSeriesOccurrence[] } {
    return {
      ...this.series.findById(id),
      occurrences: this.series.listOccurrences(id)
    }
  }

  confirm(
    id: string,
    recurrenceType: Exclude<RecurringSeriesType, 'unknown' | 'not_recurring'>
  ): RecurringSeries {
    return this.series.confirm(id, recurrenceType)
  }

  reject(id: string): RecurringSeries {
    return this.series.reject(id)
  }

  private candidateGroups(): CandidateGroup[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            transactions.id,
            transactions.transaction_date AS transactionDate,
            transactions.original_description AS originalDescription,
            transactions.amount_cents AS amountCents,
            classification.merchant_id AS merchantId,
            merchants.name AS merchantName
          FROM transactions transactions
          JOIN import_batches batches ON batches.id = transactions.import_batch_id
          LEFT JOIN transaction_classifications classification
            ON classification.transaction_id = transactions.id
            AND classification.classification_status = 'confirmed'
            AND classification.merchant_id IS NOT NULL
          LEFT JOIN merchants ON merchants.id = classification.merchant_id
          WHERE batches.status = 'committed'
            AND transactions.is_pending = 0
            AND transactions.amount_cents < 0
            AND transactions.transaction_type NOT IN ('refund', 'card_settlement', 'income', 'cash_withdrawal')
          ORDER BY transactions.transaction_date ASC, transactions.created_at ASC
        `
      )
      .all() as CandidateTransaction[]
    const groups = new Map<string, CandidateGroup>()

    for (const row of rows) {
      const merchantId = optionalString(row.merchantId)
      const merchantName = optionalString(row.merchantName)
      const descriptor = normaliseMatchText(row.originalDescription)
      const seriesKey = merchantId ? `merchant:${merchantId}` : `description:${descriptor}`
      const group = groups.get(seriesKey) ?? {
        seriesKey,
        matchingBasis: merchantId ? 'merchant' : 'description',
        merchantId,
        canonicalDescription: merchantName ?? descriptor,
        transactions: []
      }
      group.transactions.push({
        ...row,
        merchantId,
        merchantName
      })
      groups.set(seriesKey, group)
    }

    return [...groups.values()].filter((group) => group.transactions.length >= 2)
  }
}

function buildCandidate(
  group: CandidateGroup
): Parameters<RecurringSeriesRepository['upsertCandidate']>[0] | undefined {
  const uniqueTransactions = uniqueByStableOccurrence(group.transactions)
  if (uniqueTransactions.length < 2) return undefined
  const intervals = dayIntervals(
    uniqueTransactions.map((transaction) => transaction.transactionDate)
  )
  const cadence = classifyCadence(intervals)
  if (cadence === 'irregular' && uniqueTransactions.length < 3) return undefined
  const amounts = uniqueTransactions
    .map((transaction) => Math.abs(transaction.amountCents))
    .sort((a, b) => a - b)
  const typicalAmountCents = median(amounts)
  const minAmountCents = amounts[0]!
  const maxAmountCents = amounts.at(-1)!
  const amountVariabilityBasisPoints =
    typicalAmountCents === 0
      ? 0
      : Math.round(((maxAmountCents - minAmountCents) / typicalAmountCents) * 10_000)
  const { confidence, confidenceScore } = scoreCandidate({
    occurrenceCount: uniqueTransactions.length,
    cadence,
    intervals,
    amountVariabilityBasisPoints
  })

  if (cadence === 'irregular' && confidence === 'low') return undefined

  return {
    seriesKey: group.seriesKey,
    matchingBasis: group.matchingBasis,
    merchantId: group.merchantId,
    canonicalDescription: group.canonicalDescription,
    recurrenceType: 'unknown',
    cadence,
    status: 'candidate',
    typicalAmountCents,
    minAmountCents,
    maxAmountCents,
    amountVariabilityBasisPoints,
    firstSeen: uniqueTransactions[0]!.transactionDate,
    lastSeen: uniqueTransactions.at(-1)!.transactionDate,
    occurrenceCount: uniqueTransactions.length,
    confidence,
    confidenceScore,
    transactionIds: uniqueTransactions.map((transaction) => transaction.id)
  }
}

function uniqueByStableOccurrence(transactions: CandidateTransaction[]): CandidateTransaction[] {
  const seen = new Set<string>()
  const unique: CandidateTransaction[] = []

  for (const transaction of transactions) {
    const key = [
      transaction.transactionDate,
      normaliseMatchText(transaction.originalDescription),
      String(transaction.amountCents)
    ].join('\u001f')
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(transaction)
  }

  return unique
}

function classifyCadence(intervals: number[]): RecurringCadence {
  if (intervals.length === 0) return 'irregular'
  for (const cadence of ['monthly', 'quarterly', 'yearly'] as const) {
    const range = cadenceRanges[cadence]
    if (intervals.every((interval) => interval >= range.min && interval <= range.max)) {
      return cadence
    }
  }
  return 'irregular'
}

function scoreCandidate(input: {
  occurrenceCount: number
  cadence: RecurringCadence
  intervals: number[]
  amountVariabilityBasisPoints: number
}): { confidence: RecurringConfidence; confidenceScore: number } {
  if (input.occurrenceCount === 2) {
    return { confidence: 'low', confidenceScore: input.cadence === 'irregular' ? 30 : 45 }
  }

  if (input.cadence === 'irregular') {
    return { confidence: 'low', confidenceScore: 35 }
  }

  const spread = input.intervals.length
    ? Math.max(...input.intervals) - Math.min(...input.intervals)
    : 0
  let score = 50
  score += Math.min(20, (input.occurrenceCount - 2) * 8)
  score += spread <= 4 ? 20 : spread <= 8 ? 12 : 6
  score +=
    input.amountVariabilityBasisPoints <= 1_000
      ? 15
      : input.amountVariabilityBasisPoints <= 5_000
        ? 8
        : 4
  const capped = Math.min(95, score)

  return {
    confidence: capped >= 75 ? 'high' : capped >= 55 ? 'medium' : 'low',
    confidenceScore: capped
  }
}

function dayIntervals(dates: string[]): number[] {
  return dates.slice(1).map((date, index) => daysBetween(dates[index]!, date))
}

function daysBetween(left: string, right: string): number {
  const leftTime = Date.parse(`${left}T00:00:00.000Z`)
  const rightTime = Date.parse(`${right}T00:00:00.000Z`)
  return Math.round((rightTime - leftTime) / 86_400_000)
}

function median(values: number[]): number {
  const midpoint = Math.floor(values.length / 2)
  if (values.length % 2 === 1) return values[midpoint]!
  return Math.round((values[midpoint - 1]! + values[midpoint]!) / 2)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
