export const aiModelConfig = {
  bulkClassificationModel: 'gpt-5.6-luna',
  webLookupModel: 'gpt-5.6-terra',
  reasoningEffort: 'minimal' as const,
  webReasoningEffort: 'low' as const,
  batchSize: 40
}

export const aiConfidenceThresholds = {
  high: 900,
  medium: 700
}

export function confidenceBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= aiConfidenceThresholds.high) return 'high'
  if (score >= aiConfidenceThresholds.medium) return 'medium'
  return 'low'
}
