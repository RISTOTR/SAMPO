import { z } from 'zod'

export const accountKinds = ['current', 'credit_card', 'cash', 'other'] as const
export const importSourceKinds = ['evo_visa_xls', 'evo_account_pdf', 'unknown'] as const
export const importStatuses = ['pending', 'committed', 'rolled_back', 'failed'] as const
export const transactionTypes = [
  'expense',
  'income',
  'transfer',
  'card_settlement',
  'refund',
  'fee',
  'cash_withdrawal',
  'tax',
  'unknown'
] as const
export const reviewStatuses = ['confirmed', 'needs_review'] as const
export const transactionLinkKinds = [
  'card_settlement',
  'own_account_transfer',
  'refund',
  'related'
] as const

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const sha256Pattern = /^[a-f0-9]{64}$/

export const uuidSchema = z.string().uuid()
export const isoDateSchema = z
  .string()
  .regex(isoDatePattern)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: 'Invalid ISO date'
  })
export const utcTimestampSchema = z.string().regex(utcTimestampPattern)
export const currencySchema = z.string().regex(/^[A-Z]{3}$/)
export const nonBlankStringSchema = z.string().trim().min(1)
export const integerCentsSchema = z.number().int().safe()
export const nonZeroIntegerCentsSchema = integerCentsSchema.refine((value) => value !== 0, {
  message: 'Zero-value transactions are not accepted in the Phase 1 domain model'
})
export const fileSha256Schema = z.string().regex(sha256Pattern)

export const accountSchema = z.object({
  id: uuidSchema,
  name: nonBlankStringSchema,
  kind: z.enum(accountKinds),
  institution: z.string().trim().min(1).optional(),
  currency: currencySchema,
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema
})

export const newAccountSchema = z.object({
  name: nonBlankStringSchema,
  kind: z.enum(accountKinds),
  institution: z.string().trim().min(1).optional(),
  currency: currencySchema.default('EUR')
})

export const importBatchSchema = z.object({
  id: uuidSchema,
  accountId: uuidSchema,
  sourceKind: z.enum(importSourceKinds),
  sourceFileName: nonBlankStringSchema,
  fileSha256: fileSha256Schema,
  statementPeriodStart: isoDateSchema.optional(),
  statementPeriodEnd: isoDateSchema.optional(),
  status: z.enum(importStatuses),
  transactionCount: z.number().int().min(0),
  createdAt: utcTimestampSchema,
  committedAt: utcTimestampSchema.optional(),
  rolledBackAt: utcTimestampSchema.optional()
})

export const newImportBatchSchema = z.object({
  accountId: uuidSchema,
  sourceKind: z.enum(importSourceKinds),
  sourceFileName: nonBlankStringSchema,
  fileSha256: fileSha256Schema,
  statementPeriodStart: isoDateSchema.optional(),
  statementPeriodEnd: isoDateSchema.optional()
})

export const transactionSchema = z.object({
  id: uuidSchema,
  importBatchId: uuidSchema,
  accountId: uuidSchema,
  sourceRowIndex: z.number().int().min(0),
  transactionDate: isoDateSchema,
  valueDate: isoDateSchema.optional(),
  reference: z.string().trim().min(1).optional(),
  originalDescription: nonBlankStringSchema,
  normalizedMerchant: z.string().trim().min(1).optional(),
  amountCents: nonZeroIntegerCentsSchema,
  balanceCents: integerCentsSchema.optional(),
  currency: currencySchema,
  transactionType: z.enum(transactionTypes),
  isPending: z.boolean(),
  excludedFromSpending: z.boolean(),
  reviewStatus: z.enum(reviewStatuses),
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema
})

export const newTransactionSchema = z
  .object({
    accountId: uuidSchema,
    sourceRowIndex: z.number().int().min(0),
    transactionDate: isoDateSchema,
    valueDate: isoDateSchema.optional(),
    reference: z.string().trim().min(1).optional(),
    originalDescription: nonBlankStringSchema,
    normalizedMerchant: z.string().trim().min(1).optional(),
    amountCents: nonZeroIntegerCentsSchema,
    balanceCents: integerCentsSchema.optional(),
    currency: currencySchema.default('EUR'),
    transactionType: z.enum(transactionTypes),
    isPending: z.boolean().default(false),
    excludedFromSpending: z.boolean().default(false),
    reviewStatus: z.enum(reviewStatuses).optional()
  })
  .transform((transaction) => ({
    ...transaction,
    reviewStatus: transaction.reviewStatus ?? (transaction.isPending ? 'needs_review' : 'confirmed')
  }))

export const transactionLinkSchema = z.object({
  id: uuidSchema,
  fromTransactionId: uuidSchema,
  toTransactionId: uuidSchema,
  kind: z.enum(transactionLinkKinds),
  createdAt: utcTimestampSchema
})

export const newTransactionLinkSchema = z
  .object({
    fromTransactionId: uuidSchema,
    toTransactionId: uuidSchema,
    kind: z.enum(transactionLinkKinds)
  })
  .refine((link) => link.fromTransactionId !== link.toTransactionId, {
    message: 'A transaction cannot link to itself',
    path: ['toTransactionId']
  })

export const preparedImportSchema = z.object({
  accountId: uuidSchema,
  sourceKind: z.enum(importSourceKinds),
  sourceFileName: nonBlankStringSchema,
  fileSha256: fileSha256Schema,
  statementPeriodStart: isoDateSchema.optional(),
  statementPeriodEnd: isoDateSchema.optional(),
  transactions: z.array(newTransactionSchema).min(1)
})

export type Account = z.infer<typeof accountSchema>
export type NewAccount = z.input<typeof newAccountSchema>
export type ImportBatch = z.infer<typeof importBatchSchema>
export type NewImportBatch = z.input<typeof newImportBatchSchema>
export type Transaction = z.infer<typeof transactionSchema>
export type NewTransaction = z.input<typeof newTransactionSchema>
export type NormalizedNewTransaction = z.output<typeof newTransactionSchema>
export type TransactionLink = z.infer<typeof transactionLinkSchema>
export type NewTransactionLink = z.input<typeof newTransactionLinkSchema>
export type PreparedImport = z.input<typeof preparedImportSchema>
export type NormalizedPreparedImport = z.output<typeof preparedImportSchema>
export type AccountKind = (typeof accountKinds)[number]
export type ImportStatus = (typeof importStatuses)[number]
export type ImportSourceKind = (typeof importSourceKinds)[number]
