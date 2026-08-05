import type { NewTransaction } from '../../domain/schemas'

export function createPendingCandidateKey(
  transaction: Pick<
    NewTransaction,
    'transactionDate' | 'originalDescription' | 'amountCents' | 'currency'
  >
): string {
  return [
    transaction.transactionDate,
    normalizeDescription(transaction.originalDescription),
    Math.abs(transaction.amountCents),
    transaction.currency ?? 'EUR'
  ].join('|')
}

function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, ' ').toUpperCase()
}
