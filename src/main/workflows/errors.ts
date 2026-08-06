import {
  ActiveReconciliationError,
  DuplicateImportError,
  EntityNotFoundError,
  ReconciliationError,
  SampoError,
  UnsupportedImportFormatError
} from '../domain/errors'
import type { OperationErrorDto } from '../../shared/dtos'

export class PreviewExpiredError extends SampoError {
  constructor() {
    super('Import preview session expired or does not exist', 'PREVIEW_EXPIRED')
  }
}

export class SourceFileChangedError extends SampoError {
  constructor() {
    super('Source file changed after preview', 'SOURCE_FILE_CHANGED')
  }
}

export class UnsupportedAccountSourceError extends SampoError {
  constructor() {
    super('Selected account is not compatible with detected source', 'UNSUPPORTED_ACCOUNT_SOURCE')
  }
}

export class CancelledOperationError extends SampoError {
  constructor() {
    super('Operation cancelled', 'CANCELLED')
  }
}

export function toOperationError(error: unknown): OperationErrorDto {
  if (error instanceof CancelledOperationError) {
    return { code: 'cancelled', message: 'Cancelled.' }
  }

  if (error instanceof UnsupportedAccountSourceError) {
    return {
      code: 'unsupported_account_source',
      message: 'The selected account is not compatible with that file type.'
    }
  }

  if (error instanceof UnsupportedImportFormatError) {
    return { code: 'unsupported_file', message: 'The selected file is not supported.' }
  }

  if (error instanceof DuplicateImportError) {
    return { code: 'duplicate_import', message: 'This file has already been imported.' }
  }

  if (error instanceof PreviewExpiredError) {
    return {
      code: 'preview_expired',
      message: 'The import preview expired. Select the file again.'
    }
  }

  if (error instanceof SourceFileChangedError) {
    return {
      code: 'source_file_changed',
      message: 'The source file changed after preview. Select it again.'
    }
  }

  if (error instanceof EntityNotFoundError) {
    return { code: 'entity_not_found', message: 'The requested item was not found.' }
  }

  if (error instanceof ActiveReconciliationError) {
    return {
      code: 'active_reconciliation',
      message: 'Reverse the active reconciliation before rolling back this import.'
    }
  }

  if (error instanceof ReconciliationError) {
    if (error.message.includes('amount') || error.message.includes('preview')) {
      return { code: 'amount_mismatch', message: 'The reconciliation cannot be committed.' }
    }

    return {
      code: 'invalid_reconciliation_state',
      message: 'The reconciliation state is no longer valid.'
    }
  }

  if (error instanceof SampoError && error.code === 'ACCOUNT_IN_USE') {
    return { code: 'account_in_use', message: 'This account has imports or transactions.' }
  }

  if (error instanceof SampoError) {
    return { code: 'database_error', message: 'The operation could not be completed.' }
  }

  return { code: 'unexpected_error', message: 'Unexpected error.' }
}
