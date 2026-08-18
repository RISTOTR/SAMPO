import type { NewTransaction, Transaction } from '../domain/schemas'
import { normaliseMatchText } from '../categorisation/normalisation'

export type TransactionFingerprintInput = Pick<
  Transaction | NewTransaction,
  'accountId' | 'transactionDate' | 'originalDescription' | 'amountCents' | 'currency'
>

export function createTransactionFingerprint(input: TransactionFingerprintInput): string {
  return [
    input.accountId,
    input.transactionDate,
    normaliseMatchText(input.originalDescription),
    String(input.amountCents),
    (input.currency ?? 'EUR').toUpperCase()
  ].join('\u001f')
}
