import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { EntityNotFoundError, SampoError } from '../domain/errors'
import {
  aliasMatchKinds,
  categorisationRuleSchema,
  categorySchema,
  classificationStatuses,
  costBehaviours,
  merchantAliasSchema,
  merchantSchema,
  necessities,
  transactionClassificationSchema,
  usageTypes,
  type AliasMatchKind,
  type CategorisationRule,
  type Category,
  type ClassificationStatus,
  type CostBehaviour,
  type Merchant,
  type MerchantAlias,
  type Necessity,
  type TransactionClassification,
  type UsageType
} from '../domain/schemas'
import {
  AliasConflictError,
  CategoryCycleError,
  CategoryInUseError,
  CategoryNotFoundError,
  DuplicateCategoryError,
  DuplicateMerchantError,
  InvalidRuleError,
  MerchantNotFoundError,
  RuleNotFoundError
} from '../categorisation/errors'
import { isValidMatchPattern, normaliseMatchText } from '../categorisation/normalisation'

type Row = Record<string, unknown>

export type ClassificationListQuery = {
  categoryId?: string
  merchantId?: string
  usageType?: UsageType
  costBehaviour?: CostBehaviour
  necessity?: Necessity
  classificationStatus?: ClassificationStatus
  unclassifiedOnly?: boolean
}

export class CategoryRepository {
  constructor(private readonly database: Database) {}

  list(): Category[] {
    return this.database
      .prepare('SELECT * FROM categories ORDER BY parent_id IS NOT NULL, sort_order, lower(name)')
      .all()
      .map((row) => mapCategory(row as Row))
  }

  findById(id: string): Category {
    const row = this.database.prepare('SELECT * FROM categories WHERE id = ?').get(id)

    if (!row) {
      throw new CategoryNotFoundError(id)
    }

    return mapCategory(row as Row)
  }

  create(input: { name: string; parentId?: string; sortOrder?: number }): Category {
    const parent = input.parentId ? this.findById(input.parentId) : undefined

    if (parent?.parentId) {
      throw new CategoryCycleError('Phase 6 category hierarchy is limited to two levels')
    }

    const id = randomUUID()
    const now = new Date().toISOString()

    try {
      this.database
        .prepare(
          `
            INSERT INTO categories (
              id, name, parent_id, sort_order, is_system, is_active, created_at, updated_at
            )
            VALUES (@id, @name, @parentId, @sortOrder, 0, 1, @now, @now)
          `
        )
        .run({
          id,
          name: input.name,
          parentId: input.parentId ?? null,
          sortOrder: input.sortOrder ?? 0,
          now
        })
    } catch (error) {
      throwUniqueCategory(error)
    }

    return this.findById(id)
  }

  update(input: { id: string; name: string; parentId?: string; sortOrder: number }): Category {
    const existing = this.findById(input.id)
    const parent = input.parentId ? this.findById(input.parentId) : undefined

    if (input.parentId === input.id || parent?.parentId) {
      throw new CategoryCycleError('Phase 6 category hierarchy is limited to two levels')
    }

    if (existing.parentId && input.parentId === undefined) {
      const children = this.database
        .prepare('SELECT COUNT(*) AS count FROM categories WHERE parent_id = ?')
        .get(existing.id) as { count: number }

      if (children.count > 0) {
        throw new CategoryCycleError()
      }
    }

    try {
      this.database
        .prepare(
          `
            UPDATE categories
            SET name = @name,
                parent_id = @parentId,
                sort_order = @sortOrder,
                updated_at = @updatedAt
            WHERE id = @id
          `
        )
        .run({
          id: input.id,
          name: input.name,
          parentId: input.parentId ?? null,
          sortOrder: input.sortOrder,
          updatedAt: new Date().toISOString()
        })
    } catch (error) {
      throwUniqueCategory(error)
    }

    return this.findById(input.id)
  }

  setActive(id: string, active: boolean): Category {
    this.findById(id)
    this.database
      .prepare('UPDATE categories SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(active ? 1 : 0, new Date().toISOString(), id)
    return this.findById(id)
  }

  deleteUnused(id: string): void {
    const category = this.findById(id)

    if (category.isSystem) {
      throw new CategoryInUseError()
    }

    const usage = this.database
      .prepare(
        `
          SELECT
            (SELECT COUNT(*) FROM categories WHERE parent_id = @id)
            + (SELECT COUNT(*) FROM transaction_classifications WHERE category_id = @id)
            + (SELECT COUNT(*) FROM categorisation_rules WHERE category_id = @id)
            AS count
        `
      )
      .get({ id }) as { count: number }

    if (usage.count > 0) {
      throw new CategoryInUseError()
    }

    this.database.prepare('DELETE FROM categories WHERE id = ?').run(id)
  }

  assertAssignable(id: string | undefined): void {
    if (!id) return
    const category = this.findById(id)
    if (!category.isActive) {
      throw new InvalidRuleError('Inactive categories cannot be assigned')
    }
  }
}

export class MerchantRepository {
  constructor(private readonly database: Database) {}

  list(query: { search?: string } = {}): Merchant[] {
    const search = query.search?.trim()
    return this.database
      .prepare(
        `
          SELECT * FROM merchants
          ${search ? 'WHERE lower(name) LIKE @search' : ''}
          ORDER BY lower(name)
        `
      )
      .all(search ? { search: `%${search.toLocaleLowerCase('es-ES')}%` } : {})
      .map((row) => mapMerchant(row as Row))
  }

  findById(id: string): Merchant {
    const row = this.database.prepare('SELECT * FROM merchants WHERE id = ?').get(id)

    if (!row) {
      throw new MerchantNotFoundError(id)
    }

    return mapMerchant(row as Row)
  }

  create(input: { name: string }): Merchant {
    const id = randomUUID()
    const now = new Date().toISOString()

    try {
      this.database
        .prepare('INSERT INTO merchants (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(id, input.name, now, now)
    } catch (error) {
      throwUniqueMerchant(error)
    }

    return this.findById(id)
  }

  update(input: { id: string; name: string }): Merchant {
    this.findById(input.id)

    try {
      this.database
        .prepare('UPDATE merchants SET name = ?, updated_at = ? WHERE id = ?')
        .run(input.name, new Date().toISOString(), input.id)
    } catch (error) {
      throwUniqueMerchant(error)
    }

    return this.findById(input.id)
  }
}

export class MerchantAliasRepository {
  constructor(private readonly database: Database) {}

  list(): MerchantAlias[] {
    return this.database
      .prepare(
        `
          SELECT * FROM merchant_aliases
          ORDER BY is_active DESC, priority DESC, match_kind, lower(pattern)
        `
      )
      .all()
      .map((row) => mapMerchantAlias(row as Row))
  }

  listActive(): MerchantAlias[] {
    return this.database
      .prepare('SELECT * FROM merchant_aliases WHERE is_active = 1 ORDER BY priority DESC')
      .all()
      .map((row) => mapMerchantAlias(row as Row))
  }

  create(input: {
    merchantId: string
    matchKind: AliasMatchKind
    pattern: string
    priority?: number
  }): MerchantAlias {
    new MerchantRepository(this.database).findById(input.merchantId)
    const normalisedPattern = normaliseValidPattern(input.pattern)
    const existing = this.database
      .prepare(
        `
          SELECT id, merchant_id AS merchantId FROM merchant_aliases
          WHERE is_active = 1 AND match_kind = ? AND normalised_pattern = ?
        `
      )
      .all(input.matchKind, normalisedPattern) as { id: string; merchantId: string }[]

    if (existing.some((row) => row.merchantId !== input.merchantId)) {
      throw new AliasConflictError()
    }

    const existingForMerchant = existing.find((row) => row.merchantId === input.merchantId)
    if (existingForMerchant) return this.findById(existingForMerchant.id)

    const id = randomUUID()
    const now = new Date().toISOString()
    this.database
      .prepare(
        `
          INSERT INTO merchant_aliases (
            id, merchant_id, match_kind, pattern, normalised_pattern,
            priority, is_active, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        `
      )
      .run(
        id,
        input.merchantId,
        input.matchKind,
        input.pattern,
        normalisedPattern,
        input.priority ?? 0,
        now,
        now
      )

    return this.findById(id)
  }

  update(input: {
    id: string
    merchantId: string
    matchKind: AliasMatchKind
    pattern: string
    priority: number
  }): MerchantAlias {
    this.findById(input.id)
    new MerchantRepository(this.database).findById(input.merchantId)
    const normalisedPattern = normaliseValidPattern(input.pattern)
    this.database
      .prepare(
        `
          UPDATE merchant_aliases
          SET merchant_id = ?, match_kind = ?, pattern = ?, normalised_pattern = ?,
              priority = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        input.merchantId,
        input.matchKind,
        input.pattern,
        normalisedPattern,
        input.priority,
        new Date().toISOString(),
        input.id
      )
    return this.findById(input.id)
  }

  deactivate(id: string): MerchantAlias {
    this.findById(id)
    this.database
      .prepare('UPDATE merchant_aliases SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id)
    return this.findById(id)
  }

  findById(id: string): MerchantAlias {
    const row = this.database.prepare('SELECT * FROM merchant_aliases WHERE id = ?').get(id)

    if (!row) {
      throw new EntityNotFoundError('Merchant alias', id)
    }

    return mapMerchantAlias(row as Row)
  }
}

export class CategorisationRuleRepository {
  constructor(private readonly database: Database) {}

  list(activeOnly = false): CategorisationRule[] {
    return this.database
      .prepare(
        `
          SELECT * FROM categorisation_rules
          ${activeOnly ? 'WHERE is_active = 1' : ''}
          ORDER BY is_active DESC, priority DESC, lower(name)
        `
      )
      .all()
      .map((row) => mapRule(row as Row))
  }

  findById(id: string): CategorisationRule {
    const row = this.database.prepare('SELECT * FROM categorisation_rules WHERE id = ?').get(id)

    if (!row) {
      throw new RuleNotFoundError(id)
    }

    return mapRule(row as Row)
  }

  create(input: RuleInput): CategorisationRule {
    validateRuleInput(input, this.database)
    const id = randomUUID()
    const now = new Date().toISOString()
    const descriptionPattern = input.descriptionPattern?.trim()
    const normalisedDescriptionPattern = descriptionPattern
      ? normaliseValidPattern(descriptionPattern)
      : undefined

    this.database
      .prepare(
        `
          INSERT INTO categorisation_rules (
            id, name, merchant_id, description_match_kind, description_pattern,
            normalised_description_pattern, category_id, usage_type, cost_behaviour,
            necessity, priority, is_active, created_at, updated_at
          )
          VALUES (
            @id, @name, @merchantId, @descriptionMatchKind, @descriptionPattern,
            @normalisedDescriptionPattern, @categoryId, @usageType, @costBehaviour,
            @necessity, @priority, 1, @now, @now
          )
        `
      )
      .run({
        id,
        name: input.name,
        merchantId: input.merchantId ?? null,
        descriptionMatchKind: input.descriptionMatchKind ?? null,
        descriptionPattern: descriptionPattern ?? null,
        normalisedDescriptionPattern: normalisedDescriptionPattern ?? null,
        categoryId: input.categoryId ?? null,
        usageType: input.usageType ?? 'unspecified',
        costBehaviour: input.costBehaviour ?? 'unspecified',
        necessity: input.necessity ?? 'unspecified',
        priority: input.priority ?? 0,
        now
      })

    return this.findById(id)
  }

  setActive(id: string, active: boolean): CategorisationRule {
    this.findById(id)
    this.database
      .prepare('UPDATE categorisation_rules SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(active ? 1 : 0, new Date().toISOString(), id)
    return this.findById(id)
  }
}

export class TransactionClassificationRepository {
  constructor(private readonly database: Database) {}

  findByTransactionId(transactionId: string): TransactionClassification | undefined {
    const row = this.database
      .prepare('SELECT * FROM transaction_classifications WHERE transaction_id = ?')
      .get(transactionId)

    return row ? mapClassification(row as Row) : undefined
  }

  listConfirmedManualMerchantExamples(): { merchantId: string; originalDescription: string }[] {
    return this.database
      .prepare(
        `
          SELECT
            c.merchant_id AS merchantId,
            t.original_description AS originalDescription
          FROM transaction_classifications c
          JOIN transactions t ON t.id = c.transaction_id
          WHERE c.classification_status = 'confirmed'
            AND c.merchant_source = 'manual'
            AND c.merchant_id IS NOT NULL
        `
      )
      .all() as { merchantId: string; originalDescription: string }[]
  }

  listConfirmedManualCategoryExamples(): { categoryId: string; originalDescription: string }[] {
    return this.database
      .prepare(
        `
          SELECT
            c.category_id AS categoryId,
            t.original_description AS originalDescription
          FROM transaction_classifications c
          JOIN transactions t ON t.id = c.transaction_id
          WHERE c.classification_status = 'confirmed'
            AND c.category_source = 'manual'
            AND c.category_id IS NOT NULL
        `
      )
      .all() as { categoryId: string; originalDescription: string }[]
  }

  listForTransactions(transactionIds: string[]): Map<string, TransactionClassification> {
    const classifications = new Map<string, TransactionClassification>()
    if (transactionIds.length === 0) return classifications

    const placeholders = transactionIds.map(() => '?').join(', ')
    const rows = this.database
      .prepare(
        `SELECT * FROM transaction_classifications WHERE transaction_id IN (${placeholders})`
      )
      .all(...transactionIds)

    for (const row of rows) {
      const classification = mapClassification(row as Row)
      classifications.set(classification.transactionId, classification)
    }

    return classifications
  }

  save(input: SaveClassificationInput): TransactionClassification {
    const now = new Date().toISOString()
    this.database
      .prepare(
        `
          INSERT INTO transaction_classifications (
            transaction_id, merchant_id, merchant_source, category_id, category_source, usage_type, cost_behaviour,
            necessity, classification_source, classification_status, applied_rule_id,
            created_at, updated_at
          )
          VALUES (
            @transactionId, @merchantId, @merchantSource, @categoryId, @categorySource, @usageType, @costBehaviour,
            @necessity, @classificationSource, @classificationStatus, @appliedRuleId,
            @now, @now
          )
          ON CONFLICT(transaction_id) DO UPDATE SET
            merchant_id = excluded.merchant_id,
            merchant_source = excluded.merchant_source,
            category_id = excluded.category_id,
            category_source = excluded.category_source,
            usage_type = excluded.usage_type,
            cost_behaviour = excluded.cost_behaviour,
            necessity = excluded.necessity,
            classification_source = excluded.classification_source,
            classification_status = excluded.classification_status,
            applied_rule_id = excluded.applied_rule_id,
            updated_at = excluded.updated_at
        `
      )
      .run({
        transactionId: input.transactionId,
        merchantId: input.merchantId ?? null,
        merchantSource: input.merchantId
          ? (input.merchantSource ?? input.classificationSource)
          : null,
        categoryId: input.categoryId ?? null,
        categorySource: input.categoryId
          ? (input.categorySource ?? input.classificationSource)
          : null,
        usageType: input.usageType ?? 'unspecified',
        costBehaviour: input.costBehaviour ?? 'unspecified',
        necessity: input.necessity ?? 'unspecified',
        classificationSource: input.classificationSource,
        classificationStatus: input.classificationStatus,
        appliedRuleId: input.appliedRuleId ?? null,
        now
      })

    return this.findByTransactionId(input.transactionId)!
  }

  countByStatus(): {
    classified: number
    unclassified: number
    needsReview: number
    activeRules: number
  } {
    const row = this.database
      .prepare(
        `
          SELECT
            SUM(CASE WHEN c.transaction_id IS NOT NULL AND c.classification_status = 'confirmed' THEN 1 ELSE 0 END) AS classified,
            SUM(CASE WHEN c.transaction_id IS NULL OR c.classification_source = 'unclassified' THEN 1 ELSE 0 END) AS unclassified,
            SUM(CASE WHEN c.classification_status IN ('needs_review', 'ambiguous') THEN 1 ELSE 0 END) AS needsReview,
            (SELECT COUNT(*) FROM categorisation_rules WHERE is_active = 1) AS activeRules
          FROM transactions t
          LEFT JOIN transaction_classifications c ON c.transaction_id = t.id
        `
      )
      .get() as {
      classified: number | null
      unclassified: number | null
      needsReview: number | null
      activeRules: number
    }

    return {
      classified: row.classified ?? 0,
      unclassified: row.unclassified ?? 0,
      needsReview: row.needsReview ?? 0,
      activeRules: row.activeRules
    }
  }
}

export type RuleInput = {
  name: string
  merchantId?: string
  descriptionMatchKind?: AliasMatchKind
  descriptionPattern?: string
  categoryId?: string
  usageType?: UsageType
  costBehaviour?: CostBehaviour
  necessity?: Necessity
  priority?: number
}

export type SaveClassificationInput = {
  transactionId: string
  merchantId?: string
  merchantSource?: 'manual' | 'rule' | 'ai'
  categoryId?: string
  categorySource?: 'manual' | 'rule' | 'ai'
  usageType?: UsageType
  costBehaviour?: CostBehaviour
  necessity?: Necessity
  classificationSource: 'manual' | 'rule' | 'ai' | 'unclassified'
  classificationStatus: ClassificationStatus
  appliedRuleId?: string
}

function validateRuleInput(input: RuleInput, database: Database): void {
  const hasMerchant = Boolean(input.merchantId)
  const hasDescription = Boolean(input.descriptionMatchKind && input.descriptionPattern)
  const hasOutput = Boolean(
    input.categoryId ||
    input.merchantId ||
    (input.usageType && input.usageType !== 'unspecified') ||
    (input.costBehaviour && input.costBehaviour !== 'unspecified') ||
    (input.necessity && input.necessity !== 'unspecified')
  )

  if (!input.name.trim() || (!hasMerchant && !hasDescription) || !hasOutput) {
    throw new InvalidRuleError()
  }

  if (input.descriptionMatchKind && !aliasMatchKinds.includes(input.descriptionMatchKind)) {
    throw new InvalidRuleError()
  }

  if (input.descriptionPattern) {
    normaliseValidPattern(input.descriptionPattern)
  }

  if (input.merchantId) {
    new MerchantRepository(database).findById(input.merchantId)
  }

  if (input.categoryId) {
    new CategoryRepository(database).assertAssignable(input.categoryId)
  }
}

export function normaliseValidPattern(value: string): string {
  if (!isValidMatchPattern(value)) {
    throw new InvalidRuleError('Match pattern must contain letters or numbers')
  }

  return normaliseMatchText(value)
}

function mapCategory(row: Row): Category {
  return categorySchema.parse({
    id: row['id'],
    key: row['key'] ?? undefined,
    name: row['name'],
    parentId: row['parent_id'] ?? undefined,
    sortOrder: row['sort_order'],
    isSystem: Boolean(row['is_system']),
    isActive: Boolean(row['is_active']),
    createdAt: row['created_at'],
    updatedAt: row['updated_at']
  })
}

function mapMerchant(row: Row): Merchant {
  return merchantSchema.parse({
    id: row['id'],
    name: row['name'],
    createdAt: row['created_at'],
    updatedAt: row['updated_at']
  })
}

function mapMerchantAlias(row: Row): MerchantAlias {
  return merchantAliasSchema.parse({
    id: row['id'],
    merchantId: row['merchant_id'],
    matchKind: row['match_kind'],
    pattern: row['pattern'],
    normalisedPattern: row['normalised_pattern'],
    priority: row['priority'],
    isActive: Boolean(row['is_active']),
    createdAt: row['created_at'],
    updatedAt: row['updated_at']
  })
}

function mapRule(row: Row): CategorisationRule {
  return categorisationRuleSchema.parse({
    id: row['id'],
    name: row['name'],
    merchantId: row['merchant_id'] ?? undefined,
    descriptionMatchKind: row['description_match_kind'] ?? undefined,
    descriptionPattern: row['description_pattern'] ?? undefined,
    normalisedDescriptionPattern: row['normalised_description_pattern'] ?? undefined,
    categoryId: row['category_id'] ?? undefined,
    usageType: row['usage_type'],
    costBehaviour: row['cost_behaviour'],
    necessity: row['necessity'],
    priority: row['priority'],
    isActive: Boolean(row['is_active']),
    createdAt: row['created_at'],
    updatedAt: row['updated_at']
  })
}

function mapClassification(row: Row): TransactionClassification {
  return transactionClassificationSchema.parse({
    transactionId: row['transaction_id'],
    merchantId: row['merchant_id'] ?? undefined,
    merchantSource: row['merchant_source'] ?? undefined,
    categoryId: row['category_id'] ?? undefined,
    categorySource: row['category_source'] ?? undefined,
    usageType: row['usage_type'],
    costBehaviour: row['cost_behaviour'],
    necessity: row['necessity'],
    classificationSource: row['classification_source'],
    classificationStatus: row['classification_status'],
    appliedRuleId: row['applied_rule_id'] ?? undefined,
    createdAt: row['created_at'],
    updatedAt: row['updated_at']
  })
}

function throwUniqueCategory(error: unknown): never {
  if (error instanceof Error && error.message.includes('categories_sibling_name_idx')) {
    throw new DuplicateCategoryError()
  }
  throw error
}

function throwUniqueMerchant(error: unknown): never {
  if (error instanceof Error && error.message.includes('merchants_name_normalised_idx')) {
    throw new DuplicateMerchantError()
  }
  throw error
}

export function assertClassificationEnums(input: {
  usageType?: UsageType
  costBehaviour?: CostBehaviour
  necessity?: Necessity
  classificationStatus?: ClassificationStatus
}): void {
  if (input.usageType && !usageTypes.includes(input.usageType)) throw new SampoError('', '')
  if (input.costBehaviour && !costBehaviours.includes(input.costBehaviour)) {
    throw new SampoError('', '')
  }
  if (input.necessity && !necessities.includes(input.necessity)) throw new SampoError('', '')
  if (input.classificationStatus && !classificationStatuses.includes(input.classificationStatus)) {
    throw new SampoError('', '')
  }
}
