import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { sha256File } from '../utils/file-hash'
import { FileHashError } from '../domain/errors'

describe('sha256File', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-hash-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('returns stable lowercase SHA-256 hashes for identical synthetic contents', async () => {
    const firstPath = join(directory, 'first.txt')
    const secondPath = join(directory, 'second.txt')

    writeFileSync(firstPath, 'synthetic file contents\n')
    writeFileSync(secondPath, 'synthetic file contents\n')

    const firstHash = await sha256File(firstPath)
    const secondHash = await sha256File(secondPath)

    expect(firstHash).toMatch(/^[a-f0-9]{64}$/)
    expect(firstHash).toBe(secondHash)
  })

  it('returns different hashes for changed synthetic contents', async () => {
    const firstPath = join(directory, 'first.txt')
    const secondPath = join(directory, 'second.txt')

    writeFileSync(firstPath, 'synthetic file contents\n')
    writeFileSync(secondPath, 'changed synthetic file contents\n')

    await expect(sha256File(firstPath)).resolves.not.toBe(await sha256File(secondPath))
  })

  it('rejects a missing file clearly', async () => {
    await expect(sha256File(join(directory, 'missing.txt'))).rejects.toThrow(FileHashError)
  })
})
