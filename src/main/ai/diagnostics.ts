import OpenAI from 'openai'

export type OpenAiNetworkProbeResult =
  { ok: true; status: number; statusText: string } | { ok: false; error: OpenAiErrorMetadata }

export type OpenAiErrorMetadata = {
  name?: string
  constructorName?: string
  message?: string
  status?: number
  code?: string
  causeName?: string
  causeCode?: string
  causeMessage?: string
  nestedCauseCode?: string
  nestedCauseMessage?: string
}

export function isDevelopmentRuntime(): boolean {
  return process.env['NODE_ENV'] !== 'production' || Boolean(process.env['ELECTRON_RENDERER_URL'])
}

export async function probeOpenAiModelsEndpoint(): Promise<OpenAiNetworkProbeResult> {
  try {
    const response = await fetch('https://api.openai.com/v1/models')
    const result = { ok: true, status: response.status, statusText: response.statusText } as const
    logDevelopmentDiagnostic('OpenAI no-key models probe', result)
    return result
  } catch (error) {
    const result = { ok: false, error: openAiErrorMetadata(error) } as const
    logDevelopmentDiagnostic('OpenAI no-key models probe failed', result)
    return result
  }
}

export function logOpenAiApiConnectionError(error: unknown): void {
  if (
    error instanceof OpenAI.APIConnectionError ||
    error instanceof OpenAI.APIConnectionTimeoutError
  ) {
    logDevelopmentDiagnostic('OpenAI API connection error', openAiErrorMetadata(error))
  }
}

export function logOpenAiApiError(error: unknown): void {
  if (error instanceof OpenAI.APIError) {
    logDevelopmentDiagnostic('OpenAI API error', openAiApiErrorMetadata(error))
  }
}

export function openAiApiErrorMetadata(error: {
  name: string
  status?: number
  code?: unknown
  param?: unknown
  message: string
  requestID?: unknown
}): {
  name: string
  status?: number
  code?: string
  param?: string
  message: string
  requestId?: string
} {
  return {
    name: error.name,
    status: error.status,
    code: stringValue(error.code),
    param: stringValue(error.param),
    message: error.message,
    requestId: stringValue((error as { requestID?: unknown }).requestID)
  }
}

export function openAiErrorMetadata(error: unknown): OpenAiErrorMetadata {
  const typed = error as {
    name?: unknown
    constructor?: { name?: unknown }
    message?: unknown
    status?: unknown
    code?: unknown
    cause?: {
      name?: unknown
      code?: unknown
      message?: unknown
      cause?: { code?: unknown; message?: unknown }
    }
  }

  return {
    name: stringValue(typed.name),
    constructorName: stringValue(typed.constructor?.name),
    message: stringValue(typed.message),
    status: numberValue(typed.status),
    code: stringValue(typed.code),
    causeName: stringValue(typed.cause?.name),
    causeCode: stringValue(typed.cause?.code),
    causeMessage: stringValue(typed.cause?.message),
    nestedCauseCode: stringValue(typed.cause?.cause?.code),
    nestedCauseMessage: stringValue(typed.cause?.cause?.message)
  }
}

function logDevelopmentDiagnostic(label: string, metadata: unknown): void {
  if (!isDevelopmentRuntime()) return
  console.warn(`[sampo-ai] ${label}`, metadata)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}
