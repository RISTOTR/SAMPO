import { SampoError } from '../domain/errors'

export class AiNotConfiguredError extends SampoError {
  constructor() {
    super('OpenAI API key is not configured', 'AI_NOT_CONFIGURED')
  }
}

export class AiDisabledError extends SampoError {
  constructor() {
    super('AI categorisation is disabled', 'AI_DISABLED')
  }
}

export class AiProviderError extends SampoError {
  constructor(code: string, message = 'AI provider request failed', cause?: unknown) {
    super(message, code, cause)
  }
}

export class AiInvalidResponseError extends SampoError {
  constructor(message = 'AI provider returned an invalid response') {
    super(message, 'AI_INVALID_RESPONSE')
  }
}

export class AiPartialResponseError extends SampoError {
  constructor(message = 'AI provider returned an incomplete response') {
    super(message, 'AI_PARTIAL_RESPONSE')
  }
}

export class AiSuggestionNotFoundError extends SampoError {
  constructor() {
    super('AI suggestion was not found', 'AI_SUGGESTION_NOT_FOUND')
  }
}

export class InvalidAiSuggestionAcceptanceError extends SampoError {
  constructor(message = 'AI suggestion cannot be accepted with the requested options') {
    super(message, 'AI_INVALID_SUGGESTION_ACCEPTANCE')
  }
}

export class AiWebLookupDisabledError extends SampoError {
  constructor() {
    super('AI web lookup is disabled', 'AI_WEB_LOOKUP_DISABLED')
  }
}

export class SecretStorageUnavailableError extends SampoError {
  constructor() {
    super('Secret storage encryption is unavailable', 'SECRET_STORAGE_UNAVAILABLE')
  }
}

export class SecretCorruptedError extends SampoError {
  constructor(cause?: unknown) {
    super('Stored secret could not be decrypted', 'SECRET_CORRUPTED', cause)
  }
}
