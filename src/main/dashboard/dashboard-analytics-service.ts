import type { Database } from 'better-sqlite3'
import type { DashboardDataDto, DashboardPeriodPresetDto } from '../../shared/dtos'

type DashboardQuery = {
  preset?: DashboardPeriodPresetDto
  dateFrom?: string
  dateTo?: string
}

type Period = {
  preset: DashboardPeriodPresetDto
  dateFrom?: string
  dateTo?: string
  label: string
  previousDateFrom?: string
  previousDateTo?: string
  previousLabel?: string
}

type AmountRow = {
  spendingCents: number | null
  incomeCents: number | null
  netCashFlowCents: number | null
  transactionCount: number
}

type CategoryRow = {
  categoryId: string | null
  categoryName: string | null
  parentCategoryName: string | null
  amountCents: number
  transactionCount: number
}

type MerchantRow = {
  merchantId: string | null
  merchantName: string | null
  originalDescription: string | null
  amountCents: number
  transactionCount: number
}

type TrendRow = {
  month: string
  spendingCents: number | null
  incomeCents: number | null
  netCashFlowCents: number | null
  recurringSpendCents: number | null
}

const spendExpression = `
  CASE
    WHEN transactions.transaction_type = 'expense' THEN -transactions.amount_cents
    WHEN transactions.transaction_type = 'refund' THEN -transactions.amount_cents
    WHEN transactions.transaction_type = 'card_settlement'
      AND NOT EXISTS (
        SELECT 1 FROM transaction_links settlement_links
        WHERE settlement_links.from_transaction_id = transactions.id
          AND settlement_links.kind = 'card_settlement'
      )
      THEN -transactions.amount_cents
    ELSE 0
  END
`

const incomeExpression = `
  CASE
    WHEN transactions.transaction_type = 'income' THEN transactions.amount_cents
    ELSE 0
  END
`

const cashFlowExpression = `
  CASE
    WHEN transactions.transaction_type = 'income' THEN transactions.amount_cents
    WHEN transactions.transaction_type = 'expense' THEN transactions.amount_cents
    WHEN transactions.transaction_type = 'refund' THEN transactions.amount_cents
    WHEN transactions.transaction_type = 'card_settlement'
      AND NOT EXISTS (
        SELECT 1 FROM transaction_links settlement_links
        WHERE settlement_links.from_transaction_id = transactions.id
          AND settlement_links.kind = 'card_settlement'
      )
      THEN transactions.amount_cents
    ELSE 0
  END
`

export class DashboardAnalyticsService {
  constructor(private readonly database: Database) {}

  getDashboard(input: DashboardQuery = {}): DashboardDataDto {
    const period = this.resolvePeriod(input)
    const current =
      period.dateFrom && period.dateTo
        ? this.amounts(period.dateFrom, period.dateTo)
        : emptyAmounts()
    const previous =
      period.previousDateFrom && period.previousDateTo
        ? this.amounts(period.previousDateFrom, period.previousDateTo)
        : emptyAmounts()
    const categories =
      period.dateFrom && period.dateTo
        ? this.categories(
            period.dateFrom,
            period.dateTo,
            period.previousDateFrom,
            period.previousDateTo
          )
        : []
    const merchants =
      period.dateFrom && period.dateTo ? this.merchants(period.dateFrom, period.dateTo) : []
    const recurring =
      period.dateFrom && period.dateTo
        ? this.recurring(period.dateFrom, period.dateTo)
        : emptyRecurring()

    return {
      period,
      hasData: Boolean(period.dateFrom && period.dateTo && current.transactionCount > 0),
      totalSpending: metric(current.spendingCents ?? 0, previous.spendingCents ?? 0, period),
      totalIncome: metric(current.incomeCents ?? 0, previous.incomeCents ?? 0, period),
      netCashFlow: metric(current.netCashFlowCents ?? 0, previous.netCashFlowCents ?? 0, period),
      recurringSpending: metric(recurring.totalCents, 0, period),
      transactionCount: current.transactionCount,
      categories,
      merchants,
      monthlyTrend:
        period.dateFrom && period.dateTo ? this.monthlyTrend(period.dateFrom, period.dateTo) : [],
      biggestChanges: categories
        .filter((category) => Math.abs(category.differenceCents) >= 100)
        .sort((left, right) => Math.abs(right.differenceCents) - Math.abs(left.differenceCents))
        .slice(0, 6),
      recurring,
      dataQuality:
        period.dateFrom && period.dateTo
          ? this.dataQuality(period.dateFrom, period.dateTo, current.spendingCents ?? 0)
          : {
              classifiedSpendingPercent: 0,
              needsConfirmationCount: 0,
              unclassifiedSpendingCents: 0
            }
    }
  }

  private resolvePeriod(input: DashboardQuery): Period {
    const preset = input.preset ?? 'latest_month'
    if (preset === 'custom' && input.dateFrom && input.dateTo) {
      return {
        preset,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        label: `${input.dateFrom} to ${input.dateTo}`,
        ...previousSameLength(input.dateFrom, input.dateTo)
      }
    }

    const latestMonth = this.latestImportedMonth()
    if (!latestMonth) return { preset, label: 'No imported data' }
    const today = new Date()
    const currentMonth = monthKey(today)

    if (preset === 'this_month') return monthPeriod(preset, currentMonth)
    if (preset === 'previous_month') return monthPeriod(preset, addMonths(currentMonth, -1))
    if (preset === 'last_3_months') return multiMonthPeriod(preset, latestMonth, 3)
    if (preset === 'last_6_months') return multiMonthPeriod(preset, latestMonth, 6)
    if (preset === 'this_year') return yearPeriod(preset, String(today.getFullYear()))
    return monthPeriod('latest_month', latestMonth)
  }

  private latestImportedMonth(): string | undefined {
    const row = this.database
      .prepare(
        `
          SELECT max(transactions.transaction_date) AS latestDate
          FROM transactions transactions
          JOIN import_batches batches ON batches.id = transactions.import_batch_id
          WHERE batches.status = 'committed'
            AND transactions.is_pending = 0
        `
      )
      .get() as { latestDate: string | null }
    return row.latestDate ? row.latestDate.slice(0, 7) : undefined
  }

  private amounts(dateFrom: string, dateTo: string): AmountRow {
    return this.database
      .prepare(
        `
          SELECT
            SUM(${spendExpression}) AS spendingCents,
            SUM(${incomeExpression}) AS incomeCents,
            SUM(${cashFlowExpression}) AS netCashFlowCents,
            COUNT(*) AS transactionCount
          ${baseFrom()}
          ${baseWhere()}
        `
      )
      .get({ dateFrom, dateTo }) as AmountRow
  }

  private categories(
    dateFrom: string,
    dateTo: string,
    previousDateFrom?: string,
    previousDateTo?: string
  ): DashboardDataDto['categories'] {
    const currentRows = this.categoryRows(dateFrom, dateTo)
    const previousRows =
      previousDateFrom && previousDateTo ? this.categoryRows(previousDateFrom, previousDateTo) : []
    const previousByKey = new Map(previousRows.map((row) => [categoryKey(row), row.amountCents]))
    const total = currentRows.reduce((sum, row) => sum + row.amountCents, 0)
    return currentRows
      .map((row) => {
        const previousAmountCents = previousByKey.get(categoryKey(row)) ?? 0
        const categoryPath = categoryPathFor(row)
        return {
          categoryId: row.categoryId ?? undefined,
          categoryPath,
          label: categoryPath.join(' / '),
          amountCents: row.amountCents,
          percentOfSpending: total <= 0 ? 0 : Math.round((row.amountCents / total) * 1000) / 10,
          transactionCount: row.transactionCount,
          previousAmountCents,
          differenceCents: row.amountCents - previousAmountCents
        }
      })
      .sort((left, right) => right.amountCents - left.amountCents)
  }

  private categoryRows(dateFrom: string, dateTo: string): CategoryRow[] {
    return this.database
      .prepare(
        `
          SELECT
            category.id AS categoryId,
            category.name AS categoryName,
            parent.name AS parentCategoryName,
            SUM(${spendExpression}) AS amountCents,
            COUNT(*) AS transactionCount
          ${baseFrom()}
          LEFT JOIN transaction_classifications classification
            ON classification.transaction_id = transactions.id
            AND classification.classification_status = 'confirmed'
          LEFT JOIN categories category ON category.id = classification.category_id
          LEFT JOIN categories parent ON parent.id = category.parent_id
          ${baseWhere()}
            AND ${financialSpendPredicate()}
          GROUP BY category.id, category.name, parent.name
          ORDER BY amountCents DESC
        `
      )
      .all({ dateFrom, dateTo }) as CategoryRow[]
  }

  private merchants(dateFrom: string, dateTo: string): DashboardDataDto['merchants'] {
    return (
      this.database
        .prepare(
          `
          SELECT
            merchants.id AS merchantId,
            merchants.name AS merchantName,
            CASE WHEN merchants.id IS NULL THEN transactions.original_description ELSE NULL END AS originalDescription,
            SUM(${spendExpression}) AS amountCents,
            COUNT(*) AS transactionCount
          ${baseFrom()}
          LEFT JOIN transaction_classifications classification
            ON classification.transaction_id = transactions.id
            AND classification.classification_status = 'confirmed'
          LEFT JOIN merchants ON merchants.id = classification.merchant_id
          ${baseWhere()}
            AND ${financialSpendPredicate()}
          GROUP BY merchants.id, merchants.name, originalDescription
          HAVING amountCents != 0
          ORDER BY amountCents DESC
          LIMIT 10
        `
        )
        .all({ dateFrom, dateTo }) as MerchantRow[]
    ).map((row) => ({
      merchantId: row.merchantId ?? undefined,
      label: row.merchantName ?? row.originalDescription ?? 'Unresolved merchant',
      amountCents: row.amountCents,
      transactionCount: row.transactionCount,
      averageAmountCents:
        row.transactionCount === 0 ? 0 : Math.round(row.amountCents / row.transactionCount)
    }))
  }

  private recurring(dateFrom: string, dateTo: string): DashboardDataDto['recurring'] {
    const row = this.database
      .prepare(
        `
          SELECT
            SUM(${spendExpression}) AS totalCents,
            SUM(CASE WHEN series.recurrence_type = 'subscription' THEN ${spendExpression} ELSE 0 END) AS subscriptionCents,
            SUM(CASE WHEN series.recurrence_type = 'recurring_bill' THEN ${spendExpression} ELSE 0 END) AS recurringBillCents,
            SUM(CASE WHEN series.recurrence_type = 'recurring_payment' THEN ${spendExpression} ELSE 0 END) AS recurringPaymentCents
          ${baseFrom()}
          JOIN recurring_series_transactions recurring_links
            ON recurring_links.transaction_id = transactions.id
          JOIN recurring_series series
            ON series.id = recurring_links.recurring_series_id
            AND series.status = 'confirmed'
            AND series.recurrence_type NOT IN ('unknown', 'not_recurring')
          ${baseWhere()}
            AND ${financialSpendPredicate()}
        `
      )
      .get({ dateFrom, dateTo }) as {
      totalCents: number | null
      subscriptionCents: number | null
      recurringBillCents: number | null
      recurringPaymentCents: number | null
    }
    const baseline = this.database
      .prepare(
        `
          SELECT
            COUNT(*) AS confirmedSeriesCount,
            SUM(
              CASE
                WHEN cadence = 'monthly' THEN typical_amount_cents
                WHEN cadence = 'quarterly' THEN round(typical_amount_cents / 3.0)
                WHEN cadence = 'yearly' THEN round(typical_amount_cents / 12.0)
                ELSE 0
              END
            ) AS monthlyBaselineCents
          FROM recurring_series
          WHERE status = 'confirmed'
            AND recurrence_type NOT IN ('unknown', 'not_recurring')
        `
      )
      .get() as { confirmedSeriesCount: number; monthlyBaselineCents: number | null }

    return {
      totalCents: row.totalCents ?? 0,
      subscriptionCents: row.subscriptionCents ?? 0,
      recurringBillCents: row.recurringBillCents ?? 0,
      recurringPaymentCents: row.recurringPaymentCents ?? 0,
      monthlyBaselineCents: baseline.monthlyBaselineCents ?? 0,
      confirmedSeriesCount: baseline.confirmedSeriesCount
    }
  }

  private monthlyTrend(dateFrom: string, dateTo: string): DashboardDataDto['monthlyTrend'] {
    return (
      this.database
        .prepare(
          `
          SELECT
            substr(transactions.transaction_date, 1, 7) AS month,
            SUM(${spendExpression}) AS spendingCents,
            SUM(${incomeExpression}) AS incomeCents,
            SUM(${cashFlowExpression}) AS netCashFlowCents,
            SUM(
              CASE
                WHEN confirmed_recurring.recurring_series_id IS NULL THEN 0
                WHEN NOT (${financialSpendPredicate()}) THEN 0
                ELSE ${spendExpression}
              END
            ) AS recurringSpendCents
          ${baseFrom()}
          LEFT JOIN (
            SELECT links.transaction_id, links.recurring_series_id
            FROM recurring_series_transactions links
            JOIN recurring_series series ON series.id = links.recurring_series_id
            WHERE series.status = 'confirmed'
              AND series.recurrence_type NOT IN ('unknown', 'not_recurring')
          ) confirmed_recurring ON confirmed_recurring.transaction_id = transactions.id
          ${baseWhere()}
          GROUP BY month
          ORDER BY month ASC
        `
        )
        .all({ dateFrom, dateTo }) as TrendRow[]
    ).map((row) => ({
      month: row.month,
      spendingCents: row.spendingCents ?? 0,
      incomeCents: row.incomeCents ?? 0,
      netCashFlowCents: row.netCashFlowCents ?? 0,
      recurringSpendCents: row.recurringSpendCents ?? 0
    }))
  }

  private dataQuality(
    dateFrom: string,
    dateTo: string,
    totalSpendingCents: number
  ): DashboardDataDto['dataQuality'] {
    const row = this.database
      .prepare(
        `
          SELECT
            SUM(CASE WHEN classification.category_id IS NULL THEN ${spendExpression} ELSE 0 END) AS unclassifiedSpendingCents,
            SUM(CASE WHEN classification.category_id IS NOT NULL THEN ${spendExpression} ELSE 0 END) AS classifiedSpendingCents,
            SUM(
              CASE
                WHEN classification.transaction_id IS NULL
                  OR classification.classification_status != 'confirmed'
                  OR classification.category_id IS NULL
                  OR classification.merchant_id IS NULL
                THEN 1 ELSE 0
              END
            ) AS needsConfirmationCount
          ${baseFrom()}
          LEFT JOIN transaction_classifications classification
            ON classification.transaction_id = transactions.id
          ${baseWhere()}
            AND ${financialSpendPredicate()}
        `
      )
      .get({ dateFrom, dateTo }) as {
      unclassifiedSpendingCents: number | null
      classifiedSpendingCents: number | null
      needsConfirmationCount: number | null
    }
    const classified = row.classifiedSpendingCents ?? 0
    return {
      classifiedSpendingPercent:
        totalSpendingCents <= 0 ? 0 : Math.round((classified / totalSpendingCents) * 1000) / 10,
      needsConfirmationCount: row.needsConfirmationCount ?? 0,
      unclassifiedSpendingCents: row.unclassifiedSpendingCents ?? 0
    }
  }
}

function baseFrom(): string {
  return `
    FROM transactions transactions
    JOIN import_batches batches ON batches.id = transactions.import_batch_id
  `
}

function baseWhere(): string {
  return `
    WHERE batches.status = 'committed'
      AND transactions.is_pending = 0
      AND transactions.transaction_date >= @dateFrom
      AND transactions.transaction_date <= @dateTo
  `
}

function financialSpendPredicate(): string {
  return `(${spendExpression}) != 0`
}

function metric(
  amountCents: number,
  previousAmountCents: number,
  period: Period
): DashboardDataDto['totalSpending'] {
  return {
    amountCents,
    comparison: period.previousLabel
      ? {
          amountCents: amountCents - previousAmountCents,
          percent:
            previousAmountCents === 0
              ? undefined
              : Math.round(
                  ((amountCents - previousAmountCents) / Math.abs(previousAmountCents)) * 1000
                ) / 10,
          previousPeriodLabel: period.previousLabel
        }
      : undefined
  }
}

function emptyAmounts(): AmountRow {
  return { spendingCents: 0, incomeCents: 0, netCashFlowCents: 0, transactionCount: 0 }
}

function emptyRecurring(): DashboardDataDto['recurring'] {
  return {
    totalCents: 0,
    subscriptionCents: 0,
    recurringBillCents: 0,
    recurringPaymentCents: 0,
    monthlyBaselineCents: 0,
    confirmedSeriesCount: 0
  }
}

function categoryPathFor(row: CategoryRow): string[] {
  if (!row.categoryName) return ['Unclassified']
  return row.parentCategoryName ? [row.parentCategoryName, row.categoryName] : [row.categoryName]
}

function categoryKey(row: CategoryRow): string {
  return row.categoryId ?? 'unclassified'
}

function monthPeriod(preset: DashboardPeriodPresetDto, month: string): Period {
  const dateFrom = `${month}-01`
  const dateTo = monthEnd(month)
  const previousMonth = addMonths(month, -1)
  return {
    preset,
    dateFrom,
    dateTo,
    label: monthLabel(month),
    previousDateFrom: `${previousMonth}-01`,
    previousDateTo: monthEnd(previousMonth),
    previousLabel: monthLabel(previousMonth)
  }
}

function multiMonthPeriod(
  preset: DashboardPeriodPresetDto,
  latestMonth: string,
  monthCount: number
): Period {
  const firstMonth = addMonths(latestMonth, -(monthCount - 1))
  const previousEnd = addMonths(firstMonth, -1)
  const previousStart = addMonths(previousEnd, -(monthCount - 1))
  return {
    preset,
    dateFrom: `${firstMonth}-01`,
    dateTo: monthEnd(latestMonth),
    label: `${monthLabel(firstMonth)} to ${monthLabel(latestMonth)}`,
    previousDateFrom: `${previousStart}-01`,
    previousDateTo: monthEnd(previousEnd),
    previousLabel: `${monthLabel(previousStart)} to ${monthLabel(previousEnd)}`
  }
}

function yearPeriod(preset: DashboardPeriodPresetDto, year: string): Period {
  const previousYear = String(Number(year) - 1)
  return {
    preset,
    dateFrom: `${year}-01-01`,
    dateTo: `${year}-12-31`,
    label: year,
    previousDateFrom: `${previousYear}-01-01`,
    previousDateTo: `${previousYear}-12-31`,
    previousLabel: previousYear
  }
}

function previousSameLength(
  dateFrom: string,
  dateTo: string
): Pick<Period, 'previousDateFrom' | 'previousDateTo' | 'previousLabel'> {
  const start = Date.parse(`${dateFrom}T00:00:00.000Z`)
  const end = Date.parse(`${dateTo}T00:00:00.000Z`)
  const days = Math.max(1, Math.round((end - start) / 86_400_000) + 1)
  const previousEnd = new Date(start - 86_400_000)
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86_400_000)
  const previousDateFrom = iso(previousStart)
  const previousDateTo = iso(previousEnd)
  return {
    previousDateFrom,
    previousDateTo,
    previousLabel: `${previousDateFrom} to ${previousDateTo}`
  }
}

function addMonths(month: string, offset: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year!, monthNumber! - 1 + offset, 1))
  return monthKey(date)
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return iso(new Date(Date.UTC(year!, monthNumber!, 0)))
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year!, monthNumber! - 1, 1))
  )
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}
