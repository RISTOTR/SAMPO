import { describe, expect, it } from 'vitest'
import {
  createAccountInputDtoSchema,
  aiSettingsDtoSchema,
  bulkClassificationInputDtoSchema,
  dashboardDataDtoSchema,
  importPreviewSessionDtoSchema,
  ruleInputDtoSchema,
  saveOpenAiApiKeyInputDtoSchema,
  transactionListQueryDtoSchema
} from '../../../shared/dtos'

describe('shared renderer DTO schemas', () => {
  it('restricts account creation to Phase 5 account types', () => {
    expect(
      createAccountInputDtoSchema.parse({
        name: 'Synthetic current',
        kind: 'current'
      })
    ).toMatchObject({ currency: 'EUR' })

    expect(() =>
      createAccountInputDtoSchema.parse({
        name: 'Synthetic cash',
        kind: 'cash'
      })
    ).toThrow()
  })

  it('enforces transaction query defaults and maximum page size', () => {
    expect(transactionListQueryDtoSchema.parse({})).toMatchObject({
      sortBy: 'transactionDate',
      sortDirection: 'desc',
      limit: 50,
      offset: 0
    })
    expect(() => transactionListQueryDtoSchema.parse({ limit: 500 })).toThrow()
  })

  it('parses dashboard DTOs without raw database rows', () => {
    const data = dashboardDataDtoSchema.parse({
      period: { preset: 'latest_month', label: 'Jan 2026' },
      hasData: true,
      totalSpending: { amountCents: 1000 },
      totalIncome: { amountCents: 2000 },
      netCashFlow: { amountCents: 1000 },
      recurringSpending: { amountCents: 300 },
      transactionCount: 3,
      categories: [
        {
          categoryPath: ['Unclassified'],
          label: 'Unclassified',
          amountCents: 1000,
          percentOfSpending: 100,
          transactionCount: 1,
          previousAmountCents: 0,
          differenceCents: 1000
        }
      ],
      merchants: [],
      monthlyTrend: [],
      biggestChanges: [],
      recurring: {
        totalCents: 300,
        subscriptionCents: 0,
        recurringBillCents: 300,
        recurringPaymentCents: 0,
        monthlyBaselineCents: 300,
        confirmedSeriesCount: 1
      },
      dataQuality: {
        classifiedSpendingPercent: 0,
        needsConfirmationCount: 1,
        unclassifiedSpendingCents: 1000
      }
    })

    expect(data.categories[0]?.label).toBe('Unclassified')
    expect(data).not.toHaveProperty('amount_cents')
  })

  it('preserves transaction search and confirmation filter query fields', () => {
    expect(
      transactionListQueryDtoSchema.parse({
        search: 'iberdrola',
        confirmationFilter: 'needs_confirmation',
        sortBy: 'transactionDate',
        sortDirection: 'desc',
        limit: 50,
        offset: 25
      })
    ).toMatchObject({
      search: 'iberdrola',
      confirmationFilter: 'needs_confirmation',
      limit: 50,
      offset: 25
    })
  })

  it('validates Phase 6 classification DTO inputs', () => {
    expect(
      transactionListQueryDtoSchema.parse({
        classificationStatus: 'ambiguous',
        unclassifiedOnly: true
      })
    ).toMatchObject({ classificationStatus: 'ambiguous', unclassifiedOnly: true })

    expect(() => ruleInputDtoSchema.parse({ name: '' })).toThrow()
    expect(() =>
      bulkClassificationInputDtoSchema.parse({
        transactionIds: Array.from({ length: 101 }, () => '11111111-1111-4111-8111-111111111111')
      })
    ).toThrow()
  })

  it('keeps AI settings readback separate from API key input', () => {
    const settings = aiSettingsDtoSchema.parse({
      keyConfigured: true,
      aiEnabled: true,
      classifyNewImports: false,
      allowWebLookup: false,
      autoAcceptHighConfidence: false,
      models: {
        bulkClassificationModel: 'gpt-5.6-luna',
        webLookupModel: 'gpt-5.6-terra',
        reasoningEffort: 'low',
        webReasoningEffort: 'low',
        batchSize: 40
      }
    })

    expect(settings).not.toHaveProperty('apiKey')
    expect(saveOpenAiApiKeyInputDtoSchema.parse({ apiKey: 'sk-test' })).toEqual({
      apiKey: 'sk-test'
    })
  })

  it('rejects preview sessions that expose full file paths instead of filenames', () => {
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      accountId: '22222222-2222-4222-8222-222222222222',
      sourceKind: 'evo_visa_xls',
      sourceFileName: 'synthetic.xls',
      inspection: {
        sourceKind: 'evo_visa_xls',
        originalFileName: 'synthetic.xls',
        detectedFormat: 'synthetic',
        completedCount: 1,
        pendingCount: 0,
        invalidRowCount: 0,
        warningCount: 0,
        canImport: true,
        warnings: []
      },
      transactions: [
        {
          sourceRowIndex: 0,
          transactionDate: '2026-01-01',
          description: 'SYNTHETIC',
          amountCents: -100,
          currency: 'EUR',
          transactionType: 'expense',
          isPending: false,
          reviewStatus: 'confirmed'
        }
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:30:00.000Z'
    }

    expect(importPreviewSessionDtoSchema.parse(base).sourceFileName).toBe('synthetic.xls')
    expect(() =>
      importPreviewSessionDtoSchema.parse({
        ...base,
        sourceFileName: '/private/tmp/synthetic.xls'
      })
    ).toThrow()
  })
})
