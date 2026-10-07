import type { DashboardDataDto, DashboardCategorySpendDto } from '../../../shared/dtos'
import { formatCents } from '../formatters'

export function comparisonLabel(amount: number, percent?: number): string {
  const direction = amount > 0 ? '↑ +' : amount < 0 ? '↓ −' : ''
  return `${direction}${formatCents(Math.abs(amount))}${percent === undefined ? '' : ` (${Math.abs(percent).toFixed(1)}%)`}`
}

export function visibleCategories(
  rows: DashboardCategorySpendDto[],
  expanded: boolean
): DashboardCategorySpendDto[] {
  const sorted = [...rows]
    .filter((row) => row.transactionCount > 0)
    .sort((a, b) => b.amountCents - a.amountCents)
  if (expanded) return sorted
  const top = sorted.slice(0, 5)
  const unclassified = sorted.find((row) => !row.categoryId)
  if (unclassified && !top.includes(unclassified)) top.push(unclassified)
  return top
}

export function periodQuery(period: DashboardDataDto['period']): Record<string, string> {
  return { dateFrom: period.dateFrom ?? '', dateTo: period.dateTo ?? '' }
}

export function trendMonths(
  data: DashboardDataDto['monthlyTrend'],
  from?: string,
  to?: string
): { month: string; values?: DashboardDataDto['monthlyTrend'][number] }[] {
  if (!from || !to) return data.map((values) => ({ month: values.month, values }))
  const rows = new Map(data.map((row) => [row.month, row]))
  const result: ReturnType<typeof trendMonths> = []
  let month = from.slice(0, 7)
  while (month <= to.slice(0, 7)) {
    result.push({ month, values: rows.get(month) })
    const [year, number] = month.split('-').map(Number)
    month = number === 12 ? `${year! + 1}-01` : `${year}-${String(number! + 1).padStart(2, '0')}`
  }
  return result
}
