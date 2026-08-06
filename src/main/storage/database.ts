import { app } from 'electron'
import DatabaseConstructor, { type Database } from 'better-sqlite3'
import { dirname, join } from 'path'
import { mkdirSync } from 'fs'
import { DatabaseInitializationError } from '../domain/errors'
import { getSchemaVersion, runMigrations } from './migrations'

export type SampoDatabase = {
  connection: Database
  path: string
  schemaVersion: number
  close: () => void
}

export type CreateDatabaseOptions = {
  path: string
  useWal?: boolean
}

export function getApplicationDatabasePath(): string {
  if (!app.isPackaged && process.env['SAMPO_DATABASE_PATH']) {
    return process.env['SAMPO_DATABASE_PATH']
  }

  return join(app.getPath('userData'), 'sampo.sqlite3')
}

export function createDatabase(options: CreateDatabaseOptions): SampoDatabase {
  let connection: Database | undefined

  try {
    if (options.path !== ':memory:') {
      mkdirSync(dirname(options.path), { recursive: true })
    }

    connection = new DatabaseConstructor(options.path)
    connection.pragma('foreign_keys = ON')
    connection.pragma('busy_timeout = 5000')

    if (options.useWal ?? options.path !== ':memory:') {
      connection.pragma('journal_mode = WAL')
    }

    runMigrations(connection)

    return {
      connection,
      path: options.path,
      schemaVersion: getSchemaVersion(connection),
      close: () => connection?.close()
    }
  } catch (error) {
    connection?.close()
    throw new DatabaseInitializationError(error)
  }
}

export function createApplicationDatabase(): SampoDatabase {
  return createDatabase({ path: getApplicationDatabasePath(), useWal: true })
}
