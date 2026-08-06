import {
  AliasConflictError,
  AmbiguousClassificationError,
  BulkUpdateConflictError,
  CategoryCycleError,
  CategoryInUseError,
  CategoryNotFoundError,
  DuplicateCategoryError,
  DuplicateMerchantError,
  InvalidRuleError,
  ManualClassificationPreservedError,
  MerchantNotFoundError,
  RuleNotFoundError
} from '../categorisation/errors'
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

  if (error instanceof CategoryNotFoundError) {
    return { code: 'category_not_found', message: 'The selected category was not found.' }
  }

  if (error instanceof CategoryInUseError) {
    return { code: 'category_in_use', message: 'This category is still in use.' }
  }

  if (error instanceof CategoryCycleError) {
    return { code: 'category_cycle', message: 'That category hierarchy is not allowed.' }
  }

  if (error instanceof DuplicateCategoryError) {
    return { code: 'duplicate_category', message: 'A sibling category already has that name.' }
  }

  if (error instanceof MerchantNotFoundError) {
    return { code: 'merchant_not_found', message: 'The selected merchant was not found.' }
  }

  if (error instanceof DuplicateMerchantError) {
    return { code: 'duplicate_merchant', message: 'A merchant already has that name.' }
  }

  if (error instanceof AliasConflictError) {
    return { code: 'alias_conflict', message: 'That alias conflicts with another merchant.' }
  }

  if (error instanceof RuleNotFoundError) {
    return { code: 'rule_not_found', message: 'The selected rule was not found.' }
  }

  if (error instanceof InvalidRuleError) {
    return { code: 'invalid_rule', message: 'The categorisation rule is invalid.' }
  }

  if (error instanceof AmbiguousClassificationError) {
    return {
      code: 'ambiguous_classification',
      message: 'The classification is ambiguous and needs review.'
    }
  }

  if (error instanceof ManualClassificationPreservedError) {
    return {
      code: 'manual_classification_preserved',
      message: 'Manual classifications are preserved by default.'
    }
  }

  if (error instanceof BulkUpdateConflictError) {
    return { code: 'bulk_update_conflict', message: 'The bulk update could not be applied.' }
  }

  if (error instanceof SampoError && error.code === 'ACCOUNT_IN_USE') {
    return { code: 'account_in_use', message: 'This account has imports or transactions.' }
  }

  if (error instanceof SampoError) {
    return { code: 'database_error', message: 'The operation could not be completed.' }
  }

  return { code: 'unexpected_error', message: 'Unexpected error.' }
}
