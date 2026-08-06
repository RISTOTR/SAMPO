import { SampoError } from '../domain/errors'

export class CategoryNotFoundError extends SampoError {
  constructor(id: string) {
    super(`Category not found: ${id}`, 'CATEGORY_NOT_FOUND')
  }
}

export class CategoryInUseError extends SampoError {
  constructor() {
    super('Category is in use', 'CATEGORY_IN_USE')
  }
}

export class CategoryCycleError extends SampoError {
  constructor(message = 'Category parent would create an invalid hierarchy') {
    super(message, 'CATEGORY_CYCLE')
  }
}

export class DuplicateCategoryError extends SampoError {
  constructor() {
    super('Duplicate category name under the same parent', 'DUPLICATE_CATEGORY')
  }
}

export class MerchantNotFoundError extends SampoError {
  constructor(id: string) {
    super(`Merchant not found: ${id}`, 'MERCHANT_NOT_FOUND')
  }
}

export class DuplicateMerchantError extends SampoError {
  constructor() {
    super('Duplicate merchant name', 'DUPLICATE_MERCHANT')
  }
}

export class AliasConflictError extends SampoError {
  constructor() {
    super('Merchant alias conflicts with another merchant', 'ALIAS_CONFLICT')
  }
}

export class RuleNotFoundError extends SampoError {
  constructor(id: string) {
    super(`Categorisation rule not found: ${id}`, 'RULE_NOT_FOUND')
  }
}

export class InvalidRuleError extends SampoError {
  constructor(message = 'Categorisation rule is invalid') {
    super(message, 'INVALID_RULE')
  }
}

export class AmbiguousClassificationError extends SampoError {
  constructor() {
    super('Classification result is ambiguous', 'AMBIGUOUS_CLASSIFICATION')
  }
}

export class ManualClassificationPreservedError extends SampoError {
  constructor() {
    super('Manual classification is preserved', 'MANUAL_CLASSIFICATION_PRESERVED')
  }
}

export class BulkUpdateConflictError extends SampoError {
  constructor() {
    super('Bulk classification update conflict', 'BULK_UPDATE_CONFLICT')
  }
}
