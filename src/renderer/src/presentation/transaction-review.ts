import type { TransactionRowDto } from '../../../shared/dtos'

/** Mirrors the existing confirmation filter using authoritative DTO fields, not AI suggestions. */
export function transactionReviewState(
  transaction: Pick<TransactionRowDto, 'classification'>
): 'confirmed' | 'needs-review' | 'unclassified' {
  const classification = transaction.classification
  if (!classification) return 'unclassified'
  const merchantId = classification.merchantDisplay
    ? classification.merchantDisplay.authoritativeId
    : classification.merchantId
  const categoryId = classification.categoryDisplay
    ? classification.categoryDisplay.authoritativeId
    : classification.categoryId
  if (classification.classificationStatus === 'confirmed' && merchantId && categoryId)
    return 'confirmed'
  const hasDetection =
    classification.merchantDisplay?.source === 'detected' ||
    classification.categoryDisplay?.source === 'detected'
  return !merchantId && !categoryId && !hasDetection ? 'unclassified' : 'needs-review'
}

export const transactionReviewLabels = {
  confirmed: 'Confirmed',
  'needs-review': 'Needs confirmation',
  unclassified: 'Unclassified — needs confirmation'
} as const
export const transactionReviewIcons = {
  confirmed: '✓',
  'needs-review': '◐',
  unclassified: '?'
} as const
