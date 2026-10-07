import type { DashboardDataDto } from '../../../../shared/dtos'
export function dashboardFixture(): DashboardDataDto {
  return {
    period: {
      preset: 'last_3_months',
      label: 'Jul 2026 to Sep 2026',
      dateFrom: '2026-07-01',
      dateTo: '2026-09-30',
      previousLabel: 'Apr 2026 to Jun 2026',
      previousTransactionCount: 10,
      latestTransactionDate: '2026-09-06'
    },
    hasData: true,
    totalSpending: { amountCents: 234567, comparison: { amountCents: 12400, percent: 5.6 } },
    totalIncome: { amountCents: 500000, comparison: { amountCents: 10000, percent: 2 } },
    netCashFlow: { amountCents: 265433, comparison: { amountCents: -2400, percent: -0.9 } },
    recurringSpending: { amountCents: 30000 },
    transactionCount: 30,
    categories: [
      {
        categoryId: '11111111-1111-4111-8111-111111111111',
        label: 'Housing / Rent',
        categoryPath: ['Housing', 'Rent'],
        amountCents: 140900,
        percentOfSpending: 60.1,
        transactionCount: 3,
        previousAmountCents: 140900,
        differenceCents: 0
      },
      {
        categoryId: '22222222-2222-4222-8222-222222222222',
        label: 'Food / Groceries',
        categoryPath: ['Food', 'Groceries'],
        amountCents: 34300,
        percentOfSpending: 14.6,
        transactionCount: 12,
        previousAmountCents: 26100,
        differenceCents: 8200
      },
      {
        label: 'Unclassified',
        categoryPath: ['Unclassified'],
        amountCents: 59367,
        percentOfSpending: 25.3,
        transactionCount: 15,
        previousAmountCents: 55167,
        differenceCents: 4200
      }
    ],
    merchants: [
      {
        merchantId: '33333333-3333-4333-8333-333333333333',
        label: 'Synthetic Market',
        amountCents: 34300,
        transactionCount: 12,
        averageAmountCents: 2858
      }
    ],
    monthlyTrend: [
      {
        month: '2026-07',
        spendingCents: 80000,
        incomeCents: 200000,
        netCashFlowCents: 120000,
        recurringSpendCents: 10000
      },
      {
        month: '2026-08',
        spendingCents: 90000,
        incomeCents: 200000,
        netCashFlowCents: 110000,
        recurringSpendCents: 10000
      },
      {
        month: '2026-09',
        spendingCents: 64567,
        incomeCents: 100000,
        netCashFlowCents: 35433,
        recurringSpendCents: 10000
      }
    ],
    biggestChanges: [],
    recurring: {
      totalCents: 30000,
      subscriptionCents: 8000,
      recurringBillCents: 15600,
      recurringPaymentCents: 6400,
      confirmedSeriesCount: 3,
      monthlyBaselineCents: 28600
    },
    dataQuality: {
      classifiedSpendingPercent: 74.7,
      needsConfirmationCount: 15,
      unclassifiedSpendingCents: 59367,
      unreconciledSettlementCount: 1
    }
  }
}
