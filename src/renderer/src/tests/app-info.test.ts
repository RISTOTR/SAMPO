import { describe, expect, it } from 'vitest'
import { appInfoSchema } from '../schemas/app-info'

describe('appInfoSchema', () => {
  it('accepts non-sensitive app metadata from preload', () => {
    expect(
      appInfoSchema.parse({
        name: 'Sampo',
        version: '0.1.0',
        platform: 'darwin',
        arch: 'arm64'
      })
    ).toEqual({
      name: 'Sampo',
      version: '0.1.0',
      platform: 'darwin',
      arch: 'arm64'
    })
  })

  it('rejects incomplete app metadata', () => {
    expect(() =>
      appInfoSchema.parse({
        name: 'Sampo',
        version: '',
        platform: 'darwin',
        arch: 'arm64'
      })
    ).toThrow()
  })
})
