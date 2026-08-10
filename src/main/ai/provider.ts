import OpenAI from 'openai'
import { z } from 'zod'
import { aiModelConfig } from './config'
import { logOpenAiApiConnectionError, logOpenAiApiError } from './diagnostics'
import { AiInvalidResponseError, AiNotConfiguredError, AiProviderError } from './errors'
import type { SecretStore } from './secret-store'

export type AiClassificationInput = {
  inputId: string
  descriptor: string
  sourceContext: 'card_purchase' | 'account_movement'
}

export type AiClassificationContext = {
  categories: { id: string; key?: string; label: string; parentLabel?: string }[]
  country?: string
  city?: string
  allowWebLookup: boolean
}

export type AiClassificationResult = {
  inputId: string
  merchant?: {
    canonicalName?: string
    confidence: number
  }
  category: {
    categoryId?: string
    confidence: number
    categoryUnknown: boolean
  }
  merchantType?: string
  needsWebLookup: boolean
  reasonCode:
    | 'known_brand'
    | 'merchant_name_signal'
    | 'local_business_signal'
    | 'category_signal_only'
    | 'ambiguous'
    | 'unknown'
  sources?: { title: string; url: string }[]
}

export type AiClassificationProvider = {
  classify: (
    items: AiClassificationInput[],
    context: AiClassificationContext
  ) => Promise<AiClassificationResult[]>
}

const providerResultSchema = z.object({
  results: z.array(
    z.object({
      inputId: z.string().min(1),
      merchant: z
        .object({
          canonicalName: z.string().trim().min(1).nullable(),
          confidence: z.number().min(0).max(1)
        })
        .nullable(),
      category: z.object({
        categoryId: z.string().nullable(),
        confidence: z.number().min(0).max(1),
        categoryUnknown: z.boolean()
      }),
      merchantType: z.string().trim().min(1).nullable(),
      needsWebLookup: z.boolean(),
      reasonCode: z.enum([
        'known_brand',
        'merchant_name_signal',
        'local_business_signal',
        'category_signal_only',
        'ambiguous',
        'unknown'
      ]),
      sources: z.array(z.object({ title: z.string().min(1), url: z.string().url() }))
    })
  )
})

type OpenAiResponsesClient = Pick<OpenAI, 'responses'>

export async function testOpenAiResponsesConnection(
  secretStore: SecretStore,
  clientFactory: (apiKey: string) => OpenAiResponsesClient = (apiKey) => new OpenAI({ apiKey })
): Promise<void> {
  const apiKey = await secretStore.getOpenAiApiKey()
  if (!apiKey) throw new AiNotConfiguredError()
  const client = clientFactory(apiKey)

  try {
    await client.responses.create({
      model: aiModelConfig.bulkClassificationModel,
      input: 'Reply with OK.',
      store: false
    })
  } catch (error) {
    throw mapProviderError(error)
  }
}

export class OpenAiClassificationProvider implements AiClassificationProvider {
  constructor(
    private readonly secretStore: SecretStore,
    private readonly clientFactory: (apiKey: string) => Pick<OpenAI, 'responses'> = (apiKey) =>
      new OpenAI({ apiKey })
  ) {}

  async classify(
    items: AiClassificationInput[],
    context: AiClassificationContext
  ): Promise<AiClassificationResult[]> {
    const apiKey = await this.secretStore.getOpenAiApiKey()
    if (!apiKey) throw new AiNotConfiguredError()
    const client = this.clientFactory(apiKey)

    try {
      const response = await client.responses.create({
        model: context.allowWebLookup
          ? aiModelConfig.webLookupModel
          : aiModelConfig.bulkClassificationModel,
        store: false,
        reasoning: { effort: aiModelConfig.reasoningEffort },
        tools: context.allowWebLookup
          ? [
              {
                type: 'web_search_preview',
                search_context_size: 'low'
              }
            ]
          : undefined,
        text: {
          format: {
            type: 'json_schema',
            name: 'sampo_ai_classification',
            strict: true,
            schema: structuredOutputSchema
          }
        },
        input: [
          {
            role: 'system',
            content:
              'Classify local personal-finance transaction descriptors into the provided category IDs. Return concise JSON only. Always return every field in the schema. Use null when merchant identity cannot be determined. Use null when no valid category can be selected. Never invent a merchant merely to avoid null. Category confidence and merchant confidence are independent.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              items,
              context: {
                categories: context.categories,
                country: context.country,
                city: context.city,
                allowWebLookup: context.allowWebLookup
              }
            })
          }
        ]
      })
      const parsed = providerResultSchema.safeParse(JSON.parse(response.output_text))
      if (!parsed.success) throw new AiInvalidResponseError()
      return parsed.data.results.map((result) => ({
        inputId: result.inputId,
        merchant: result.merchant
          ? {
              canonicalName: result.merchant.canonicalName ?? undefined,
              confidence: result.merchant.confidence
            }
          : undefined,
        category: {
          categoryId: result.category.categoryId ?? undefined,
          confidence: result.category.confidence,
          categoryUnknown: result.category.categoryUnknown
        },
        merchantType: result.merchantType ?? undefined,
        needsWebLookup: result.needsWebLookup,
        reasonCode: result.reasonCode,
        sources: result.sources.length > 0 ? result.sources : undefined
      }))
    } catch (error) {
      if (error instanceof AiInvalidResponseError || error instanceof AiNotConfiguredError)
        throw error
      if (error instanceof SyntaxError) throw new AiInvalidResponseError()
      throw mapProviderError(error)
    }
  }
}

export function mapProviderError(error: unknown): AiProviderError {
  logOpenAiApiError(error)

  if (error instanceof OpenAI.BadRequestError) {
    return new AiProviderError('AI_INVALID_REQUEST', 'OpenAI request was invalid', error)
  }
  if (error instanceof OpenAI.AuthenticationError) {
    return new AiProviderError('AI_INVALID_KEY', 'OpenAI API key was rejected', error)
  }
  if (error instanceof OpenAI.PermissionDeniedError) {
    return new AiProviderError('AI_PERMISSION_ERROR', 'OpenAI permission denied', error)
  }
  if (error instanceof OpenAI.NotFoundError) {
    return new AiProviderError(
      'AI_MODEL_NOT_FOUND',
      'OpenAI model or endpoint was not found',
      error
    )
  }
  if (error instanceof OpenAI.UnprocessableEntityError) {
    return new AiProviderError(
      'AI_UNPROCESSABLE_REQUEST',
      'OpenAI request was not processable',
      error
    )
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new AiProviderError(rateLimitCode(error), 'OpenAI rate limit or quota error', error)
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    logOpenAiApiConnectionError(error)
    return new AiProviderError('AI_TIMEOUT', 'OpenAI request timed out', error)
  }
  if (error instanceof OpenAI.APIConnectionError) {
    logOpenAiApiConnectionError(error)
    return new AiProviderError('AI_NETWORK_ERROR', 'OpenAI network request failed', error)
  }
  if (error instanceof OpenAI.InternalServerError) {
    return new AiProviderError('AI_SERVICE_ERROR', 'OpenAI service error', error)
  }

  const status = (error as { status?: number }).status
  if (status === 400) return new AiProviderError('AI_INVALID_REQUEST', undefined, error)
  if (status === 401) return new AiProviderError('AI_INVALID_KEY', undefined, error)
  if (status === 403) return new AiProviderError('AI_PERMISSION_ERROR', undefined, error)
  if (status === 404) return new AiProviderError('AI_MODEL_NOT_FOUND', undefined, error)
  if (status === 422) return new AiProviderError('AI_UNPROCESSABLE_REQUEST', undefined, error)
  if (status === 429) return new AiProviderError(rateLimitCode(error), undefined, error)
  if (status && status >= 500) return new AiProviderError('AI_SERVICE_ERROR', undefined, error)
  return new AiProviderError('AI_SERVICE_ERROR', 'OpenAI provider handling failed', error)
}

function rateLimitCode(error: unknown): 'AI_RATE_LIMITED' | 'AI_QUOTA_EXCEEDED' {
  return (error as { code?: string }).code === 'insufficient_quota'
    ? 'AI_QUOTA_EXCEEDED'
    : 'AI_RATE_LIMITED'
}

export const structuredOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'inputId',
          'merchant',
          'category',
          'merchantType',
          'needsWebLookup',
          'reasonCode',
          'sources'
        ],
        properties: {
          inputId: { type: 'string' },
          merchant: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['canonicalName', 'confidence'],
            properties: {
              canonicalName: { type: ['string', 'null'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 }
            }
          },
          category: {
            type: 'object',
            additionalProperties: false,
            required: ['categoryId', 'confidence', 'categoryUnknown'],
            properties: {
              categoryId: { type: ['string', 'null'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              categoryUnknown: { type: 'boolean' }
            }
          },
          merchantType: { type: ['string', 'null'] },
          needsWebLookup: { type: 'boolean' },
          reasonCode: {
            type: 'string',
            enum: [
              'known_brand',
              'merchant_name_signal',
              'local_business_signal',
              'category_signal_only',
              'ambiguous',
              'unknown'
            ]
          },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'url'],
              properties: {
                title: { type: 'string' },
                url: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
} as const
