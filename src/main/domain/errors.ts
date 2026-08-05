export class SampoError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class DuplicateImportError extends SampoError {
  constructor(message = 'A committed import with this file hash already exists for the account') {
    super(message, 'DUPLICATE_IMPORT')
  }
}

export class EntityNotFoundError extends SampoError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, 'ENTITY_NOT_FOUND')
  }
}

export class InvalidImportStatusTransitionError extends SampoError {
  constructor(from: string, to: string) {
    super(
      `Invalid import status transition from ${from} to ${to}`,
      'INVALID_IMPORT_STATUS_TRANSITION'
    )
  }
}

export class AccountMismatchError extends SampoError {
  constructor(message = 'Transaction account does not match the import batch account') {
    super(message, 'ACCOUNT_MISMATCH')
  }
}

export class MigrationVersionIncompatibilityError extends SampoError {
  constructor(currentVersion: number, latestSupportedVersion: number) {
    super(
      `Database schema version ${currentVersion} is newer than supported version ${latestSupportedVersion}`,
      'MIGRATION_VERSION_INCOMPATIBILITY'
    )
  }
}

export class DatabaseInitializationError extends SampoError {
  constructor(cause: unknown) {
    super('Database initialization failed', 'DATABASE_INITIALIZATION_FAILED', cause)
  }
}

export class FileHashError extends SampoError {
  constructor(message: string, cause?: unknown) {
    super(message, 'FILE_HASH_FAILED', cause)
  }
}

export class UnsupportedImportFormatError extends SampoError {
  constructor(message = 'Unsupported import file format', cause?: unknown) {
    super(message, 'UNSUPPORTED_IMPORT_FORMAT', cause)
  }
}

export class ImportParseError extends SampoError {
  constructor(message = 'Import file contains blocking parse errors', cause?: unknown) {
    super(message, 'IMPORT_PARSE_FAILED', cause)
  }
}
