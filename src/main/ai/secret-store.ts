import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { app, safeStorage } from 'electron'
import { SecretCorruptedError, SecretStorageUnavailableError } from './errors'

export type SecretStore = {
  hasOpenAiApiKey: () => Promise<boolean>
  setOpenAiApiKey: (key: string) => Promise<void>
  deleteOpenAiApiKey: () => Promise<void>
  getOpenAiApiKey: () => Promise<string | null>
}

export class FileSecretStore implements SecretStore {
  constructor(private readonly filePath: string) {}

  static forUserData(): FileSecretStore {
    return new FileSecretStore(join(app.getPath('userData'), 'secrets', 'openai-api-key.bin'))
  }

  async hasOpenAiApiKey(): Promise<boolean> {
    return (await this.getOpenAiApiKey()) !== null
  }

  async setOpenAiApiKey(key: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new SecretStorageUnavailableError()
    }
    const encrypted = safeStorage.encryptString(key)
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
    const tempPath = `${this.filePath}.${process.pid}.tmp`
    await writeFile(tempPath, encrypted, { mode: 0o600 })
    await rename(tempPath, this.filePath)
  }

  async deleteOpenAiApiKey(): Promise<void> {
    await rm(this.filePath, { force: true })
  }

  async getOpenAiApiKey(): Promise<string | null> {
    let encrypted: Buffer
    try {
      encrypted = await readFile(this.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new SecretStorageUnavailableError()
    }

    try {
      return safeStorage.decryptString(encrypted)
    } catch (error) {
      throw new SecretCorruptedError(error)
    }
  }
}

export class MemorySecretStore implements SecretStore {
  private key: string | null = null

  async hasOpenAiApiKey(): Promise<boolean> {
    return this.key !== null
  }

  async setOpenAiApiKey(key: string): Promise<void> {
    this.key = key
  }

  async deleteOpenAiApiKey(): Promise<void> {
    this.key = null
  }

  async getOpenAiApiKey(): Promise<string | null> {
    return this.key
  }
}
