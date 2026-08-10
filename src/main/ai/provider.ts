import OpenAI from 'openai'
import { z } from 'zod'
import { aiModelConfig } from './config'
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
          canonicalName: z.string().trim().min(1).optional(),
          confidence: z.number().min(0).max(1)
        })
        .optional(),
      category: z.object({
        categoryId: z.string().nullable().optional(),
        confidence: z.number().min(0).max(1),
        categoryUnknown: z.boolean()
      }),
      merchantType: z.string().trim().min(1).optional(),
      needsWebLookup: z.boolean(),
      reasonCode: z.enum([
        'known_brand',
        'merchant_name_signal',
        'local_business_signal',
        'category_signal_only',
        'ambiguous',
        'unknown'
      ]),
      sources: z.array(z.object({ title: z.string().min(1), url: z.string().url() })).optional()
    })
  )
})

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
              'Classify local personal-finance transaction descriptors into the provided category IDs. Return concise JSON only. Merchant may be omitted when uncertain.'
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
        ...result,
        category: {
          categoryId: result.category.categoryId ?? undefined,
          confidence: result.category.confidence,
          categoryUnknown: result.category.categoryUnknown
        }
      }))
    } catch (error) {
      if (error instanceof AiInvalidResponseError || error instanceof AiNotConfiguredError)
        throw error
      throw mapProviderError(error)
    }
  }
}

function mapProviderError(error: unknown): AiProviderError {
  const status = (error as { status?: number }).status
  if (status === 401) return new AiProviderError('AI_INVALID_KEY')
  if (status === 403) return new AiProviderError('AI_PERMISSION_ERROR')
  if (status === 429) return new AiProviderError('AI_RATE_LIMITED')
  if (status && status >= 500) return new AiProviderError('AI_SERVICE_ERROR')
  return new AiProviderError('AI_NETWORK_ERROR')
}

const structuredOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['inputId', 'category', 'needsWebLookup', 'reasonCode'],
        properties: {
          inputId: { type: 'string' },
          merchant: {
            type: 'object',
            additionalProperties: false,
            required: ['confidence'],
            properties: {
              canonicalName: { type: 'string' },
              confidence: { type: 'number', minimum: 0, maximum: 1 }
            }
          },
          category: {
            type: 'object',
            additionalProperties: false,
            required: ['confidence', 'categoryUnknown'],
            properties: {
              categoryId: { type: ['string', 'null'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              categoryUnknown: { type: 'boolean' }
            }
          },
          merchantType: { type: 'string' },
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
