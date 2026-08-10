import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../shared/ipc'
import { operationErrorDtoSchema } from '../../shared/dtos'

describe('IPC contract', () => {
  it('exposes only named Sampo channels and no generic channel entry point', () => {
    const channels = Object.values(IPC_CHANNELS)

    expect(channels).toHaveLength(new Set(channels).size)
    expect(channels.every((channel) => channel.startsWith('sampo:'))).toBe(true)
    expect(channels).not.toContain('sampo:query')
    expect(channels).not.toContain('sampo:filesystem')
    expect(channels).not.toContain('sampo:ipc')
    expect(channels).not.toContain('sampo:ai:get-openai-api-key')
    expect(channels).not.toContain('sampo:ai:openai-proxy')
    expect(channels).not.toContain('sampo:openai')
  })

  it('validates stable renderer-safe error DTOs without stack traces', () => {
    const error = operationErrorDtoSchema.parse({
      code: 'validation_error',
      message: 'Rejected IPC sender.'
    })

    expect(error).toEqual({
      code: 'validation_error',
      message: 'Rejected IPC sender.'
    })
    expect(JSON.stringify(error)).not.toContain('stack')
  })
})
