import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type {
  AliasMatchKind,
  CategorisationRule,
  ClassificationStatus,
  CostBehaviour,
  MerchantAlias,
  Necessity,
  Transaction,
  TransactionClassification,
  UsageType
} from '../domain/schemas'
import { TransactionRepository } from '../storage/transactions'
import {
  CategorisationRuleRepository,
  CategoryRepository,
  MerchantAliasRepository,
  MerchantRepository,
  TransactionClassificationRepository,
  normaliseValidPattern,
  type RuleInput,
  type SaveClassificationInput
} from '../storage/categorisation'
import { normaliseMatchText } from './normalisation'
import { InvalidRuleError, ManualClassificationPreservedError } from './errors'

export type ClassificationConflict = {
  field: 'merchant' | 'category' | 'usageType' | 'costBehaviour' | 'necessity'
  reason: string
}

export type ClassificationProposal = {
  transactionId: string
  merchantId?: string
  merchantName?: string
  categoryId?: string
  categoryPath?: string[]
  usageType: UsageType
  costBehaviour: CostBehaviour
  necessity: Necessity
  matchedRuleId?: string
  matchedRuleName?: string
  status: ClassificationStatus
  source: 'manual' | 'rule' | 'unclassified'
  conflicts: ClassificationConflict[]
}

export type RuleApplicationPreview = {
  matchCount: number
  manualPreservedCount: number
  ruleChangeCount: number
  ambiguousCount: number
  unchangedCount: number
  proposals: ClassificationProposal[]
}

export class ClassificationService {
  private readonly transactions: TransactionRepository
  private readonly classifications: TransactionClassificationRepository
  private readonly categories: CategoryRepository
  private readonly merchants: MerchantRepository
  private readonly aliases: MerchantAliasRepository
  private readonly rules: CategorisationRuleRepository

  constructor(private readonly database: Database) {
    this.transactions = new TransactionRepository(database)
    this.classifications = new TransactionClassificationRepository(database)
    this.categories = new CategoryRepository(database)
    this.merchants = new MerchantRepository(database)
    this.aliases = new MerchantAliasRepository(database)
    this.rules = new CategorisationRuleRepository(database)
  }

  evaluateTransaction(transactionId: string): ClassificationProposal {
    const transaction = this.transactions.findById(transactionId)
    const existing = this.classifications.findByTransactionId(transactionId)

    if (existing?.classificationSource === 'manual') {
      return this.classificationToProposal(transaction, existing)
    }

    return this.evaluateTransactionFacts(transaction, existing)
  }

  saveManual(
    input: Omit<SaveClassificationInput, 'classificationSource' | 'classificationStatus'>
  ): TransactionClassification {
    const transaction = this.transactions.findById(input.transactionId)
    this.categories.assertAssignable(input.categoryId)
    if (input.merchantId) this.merchants.findById(input.merchantId)

    return this.classifications.save({
      ...input,
      transactionId: transaction.id,
      usageType: input.usageType ?? 'unspecified',
      costBehaviour: input.costBehaviour ?? 'unspecified',
      necessity: input.necessity ?? 'unspecified',
      classificationSource: 'manual',
      classificationStatus: 'confirmed',
      appliedRuleId: undefined
    })
  }

  previewRule(input: RuleInput): RuleApplicationPreview {
    const rule = this.virtualRule(input)
    const transactions = this.transactions.listCommittedForClassification()
    return this.previewRuleAgainstTransactions(rule, transactions)
  }

  createRule(input: RuleInput): CategorisationRule {
    return this.rules.create(input)
  }

  applyRule(input: {
    ruleId: string
    overwriteRuleClassifications?: boolean
  }): RuleApplicationPreview {
    const rule = this.rules.findById(input.ruleId)
    const transactions = this.transactions.listCommittedForClassification()
    const preview = this.previewRuleAgainstTransactions(rule, transactions)
    const apply = this.database.transaction(() => {
      for (const proposal of preview.proposals) {
        if (proposal.source === 'manual') continue
        if (proposal.status === 'ambiguous') continue
        const existing = this.classifications.findByTransactionId(proposal.transactionId)
        if (existing?.classificationSource === 'rule' && !input.overwriteRuleClassifications) {
          continue
        }
        this.classifications.save({
          transactionId: proposal.transactionId,
          merchantId: proposal.merchantId,
          categoryId: proposal.categoryId,
          usageType: proposal.usageType,
          costBehaviour: proposal.costBehaviour,
          necessity: proposal.necessity,
          classificationSource: 'rule',
          classificationStatus: proposal.status,
          appliedRuleId: proposal.matchedRuleId
        })
      }
    })
    apply()
    return preview
  }

  applyToTransactions(transactionIds: string[]): void {
    const apply = this.database.transaction(() => {
      for (const id of transactionIds) {
        const proposal = this.evaluateTransaction(id)
        if (proposal.source === 'manual' || proposal.status === 'ambiguous') continue
        if (proposal.source === 'unclassified') continue
        this.classifications.save({
          transactionId: proposal.transactionId,
          merchantId: proposal.merchantId,
          categoryId: proposal.categoryId,
          usageType: proposal.usageType,
          costBehaviour: proposal.costBehaviour,
          necessity: proposal.necessity,
          classificationSource: 'rule',
          classificationStatus: proposal.status,
          appliedRuleId: proposal.matchedRuleId
        })
      }
    })
    apply()
  }

  bulkUpdate(input: {
    transactionIds: string[]
    merchantId?: string
    categoryId?: string
    usageType?: UsageType
    costBehaviour?: CostBehaviour
    necessity?: Necessity
    markConfirmed?: boolean
    overwriteManual?: boolean
  }): number {
    this.categories.assertAssignable(input.categoryId)
    if (input.merchantId) this.merchants.findById(input.merchantId)

    const update = this.database.transaction(() => {
      let count = 0
      for (const transactionId of input.transactionIds) {
        this.transactions.findById(transactionId)
        const existing = this.classifications.findByTransactionId(transactionId)
        if (existing?.classificationSource === 'manual' && !input.overwriteManual) {
          throw new ManualClassificationPreservedError()
        }
        this.classifications.save({
          transactionId,
          merchantId: input.merchantId ?? existing?.merchantId,
          categoryId: input.categoryId ?? existing?.categoryId,
          usageType: input.usageType ?? existing?.usageType ?? 'unspecified',
          costBehaviour: input.costBehaviour ?? existing?.costBehaviour ?? 'unspecified',
          necessity: input.necessity ?? existing?.necessity ?? 'unspecified',
          classificationSource: 'manual',
          classificationStatus: input.markConfirmed
            ? 'confirmed'
            : (existing?.classificationStatus ?? 'confirmed'),
          appliedRuleId: undefined
        })
        count += 1
      }
      return count
    })

    return update()
  }

  private evaluateTransactionFacts(
    transaction: Transaction,
    existing: TransactionClassification | undefined
  ): ClassificationProposal {
    const aliasResult = this.resolveAlias(transaction)
    const ruleResult = this.resolveRule(transaction, aliasResult.merchantId)
    const conflicts = [...aliasResult.conflicts, ...ruleResult.conflicts]
    const merchantId = ruleResult.merchantId ?? aliasResult.merchantId ?? existing?.merchantId
    const ruleStatus = ruleResult.status
    const status: ClassificationStatus =
      conflicts.length > 0
        ? 'ambiguous'
        : transaction.isPending
          ? 'needs_review'
          : ruleResult.matchedRule
            ? ruleStatus
            : 'needs_review'

    if (!merchantId && !ruleResult.categoryId && !ruleResult.matchedRule) {
      return {
        transactionId: transaction.id,
        usageType: existing?.usageType ?? 'unspecified',
        costBehaviour: existing?.costBehaviour ?? 'unspecified',
        necessity: existing?.necessity ?? 'unspecified',
        status: conflicts.length > 0 ? 'ambiguous' : 'needs_review',
        source: 'unclassified',
        conflicts
      }
    }

    return this.decorateProposal({
      transactionId: transaction.id,
      merchantId,
      categoryId: ruleResult.categoryId ?? existing?.categoryId,
      usageType: ruleResult.usageType ?? existing?.usageType ?? 'unspecified',
      costBehaviour: ruleResult.costBehaviour ?? existing?.costBehaviour ?? 'unspecified',
      necessity: ruleResult.necessity ?? existing?.necessity ?? 'unspecified',
      matchedRuleId: ruleResult.matchedRule?.id,
      matchedRuleName: ruleResult.matchedRule?.name,
      status,
      source: status === 'ambiguous' ? 'unclassified' : 'rule',
      conflicts
    })
  }

  private resolveAlias(transaction: Transaction): {
    merchantId?: string
    conflicts: ClassificationConflict[]
  } {
    const text = normaliseMatchText(transaction.originalDescription)
    const matches = this.aliases
      .listActive()
      .filter((alias) => matchText(alias.matchKind, alias.normalisedPattern, text))
      .map((alias) => ({ alias, rank: aliasRank(alias) }))
      .sort((left, right) => right.rank - left.rank)

    const bestRank = matches[0]?.rank
    const best = matches.filter((match) => match.rank === bestRank)
    const merchantIds = new Set(best.map((match) => match.alias.merchantId))

    if (merchantIds.size > 1) {
      return {
        conflicts: [{ field: 'merchant', reason: 'equal_rank_alias_conflict' }]
      }
    }

    return { merchantId: best[0]?.alias.merchantId, conflicts: [] }
  }

  private resolveRule(
    transaction: Transaction,
    merchantId: string | undefined
  ): {
    merchantId?: string
    categoryId?: string
    usageType?: UsageType
    costBehaviour?: CostBehaviour
    necessity?: Necessity
    matchedRule?: CategorisationRule
    status: ClassificationStatus
    conflicts: ClassificationConflict[]
  } {
    const text = normaliseMatchText(transaction.originalDescription)
    const matches = this.rules
      .list(true)
      .filter((rule) => ruleMatches(rule, text, merchantId, transaction))
      .map((rule) => ({ rule, rank: ruleRank(rule) }))
      .sort((left, right) => right.rank - left.rank)

    const bestRank = matches[0]?.rank
    const best = matches.filter((match) => match.rank === bestRank)

    if (best.length === 0) {
      return { status: 'needs_review', conflicts: [] }
    }

    const conflicts = collectRuleConflicts(best.map((match) => match.rule))
    const rule = best[0]!.rule

    return {
      merchantId: rule.merchantId,
      categoryId: rule.categoryId,
      usageType: rule.usageType,
      costBehaviour: rule.costBehaviour,
      necessity: rule.necessity,
      matchedRule: rule,
      status:
        conflicts.length > 0 ? 'ambiguous' : transaction.isPending ? 'needs_review' : 'confirmed',
      conflicts
    }
  }

  private previewRuleAgainstTransactions(
    rule: CategorisationRule,
    transactions: Transaction[]
  ): RuleApplicationPreview {
    const proposals: ClassificationProposal[] = []
    let manualPreservedCount = 0
    let ruleChangeCount = 0
    let ambiguousCount = 0
    let unchangedCount = 0

    for (const transaction of transactions) {
      const existing = this.classifications.findByTransactionId(transaction.id)
      const alias = this.resolveAlias(transaction)
      const text = normaliseMatchText(transaction.originalDescription)

      if (!ruleMatches(rule, text, alias.merchantId, transaction)) {
        unchangedCount += 1
        continue
      }

      if (existing?.classificationSource === 'manual') {
        manualPreservedCount += 1
        proposals.push(this.classificationToProposal(transaction, existing))
        continue
      }

      const proposal = this.decorateProposal({
        transactionId: transaction.id,
        merchantId: rule.merchantId ?? alias.merchantId ?? existing?.merchantId,
        categoryId: rule.categoryId ?? existing?.categoryId,
        usageType: rule.usageType,
        costBehaviour: rule.costBehaviour,
        necessity: rule.necessity,
        matchedRuleId: rule.id,
        matchedRuleName: rule.name,
        status: transaction.isPending ? 'needs_review' : 'confirmed',
        source: 'rule',
        conflicts: alias.conflicts
      })

      if (proposal.status === 'ambiguous') ambiguousCount += 1
      if (existing?.classificationSource === 'rule') ruleChangeCount += 1
      proposals.push(proposal)
    }

    return {
      matchCount: proposals.length,
      manualPreservedCount,
      ruleChangeCount,
      ambiguousCount,
      unchangedCount,
      proposals
    }
  }

  private virtualRule(input: RuleInput): CategorisationRule {
    if (input.merchantId) this.merchants.findById(input.merchantId)
    this.categories.assertAssignable(input.categoryId)
    const descriptionPattern = input.descriptionPattern?.trim()
    const normalisedDescriptionPattern = descriptionPattern
      ? normaliseValidPattern(descriptionPattern)
      : undefined
    const hasDescription = Boolean(input.descriptionMatchKind && normalisedDescriptionPattern)
    const hasOutput = Boolean(
      input.merchantId ||
      input.categoryId ||
      (input.usageType && input.usageType !== 'unspecified') ||
      (input.costBehaviour && input.costBehaviour !== 'unspecified') ||
      (input.necessity && input.necessity !== 'unspecified')
    )

    if (!input.name.trim() || (!input.merchantId && !hasDescription) || !hasOutput) {
      throw new InvalidRuleError()
    }

    const now = new Date().toISOString()
    return {
      id: randomUUID(),
      name: input.name,
      merchantId: input.merchantId,
      descriptionMatchKind: input.descriptionMatchKind,
      descriptionPattern,
      normalisedDescriptionPattern,
      categoryId: input.categoryId,
      usageType: input.usageType ?? 'unspecified',
      costBehaviour: input.costBehaviour ?? 'unspecified',
      necessity: input.necessity ?? 'unspecified',
      priority: input.priority ?? 0,
      isActive: true,
      createdAt: now,
      updatedAt: now
    }
  }

  private classificationToProposal(
    transaction: Transaction,
    classification: TransactionClassification
  ): ClassificationProposal {
    return this.decorateProposal({
      transactionId: transaction.id,
      merchantId: classification.merchantId,
      categoryId: classification.categoryId,
      usageType: classification.usageType,
      costBehaviour: classification.costBehaviour,
      necessity: classification.necessity,
      matchedRuleId: classification.appliedRuleId,
      status: classification.classificationStatus,
      source: classification.classificationSource,
      conflicts: []
    })
  }

  private decorateProposal(proposal: ClassificationProposal): ClassificationProposal {
    const merchantName = proposal.merchantId
      ? this.merchants.findById(proposal.merchantId).name
      : undefined
    const categoryPath = proposal.categoryId ? this.categoryPath(proposal.categoryId) : undefined

    return {
      ...proposal,
      merchantName,
      categoryPath,
      status: proposal.conflicts.length > 0 ? 'ambiguous' : proposal.status
    }
  }

  private categoryPath(categoryId: string): string[] {
    const category = this.categories.findById(categoryId)
    if (!category.parentId) return [category.name]
    const parent = this.categories.findById(category.parentId)
    return [parent.name, category.name]
  }
}

function matchText(kind: AliasMatchKind, pattern: string, text: string): boolean {
  if (kind === 'exact') return text === pattern
  if (kind === 'starts_with') return text.startsWith(pattern)
  return text.includes(pattern)
}

function aliasRank(alias: MerchantAlias): number {
  const kindRank =
    alias.matchKind === 'exact' ? 3000 : alias.matchKind === 'starts_with' ? 2000 : 1000
  return kindRank + alias.priority
}

function ruleMatches(
  rule: CategorisationRule,
  text: string,
  merchantId: string | undefined,
  transaction: Transaction
): boolean {
  if (rule.merchantId && rule.merchantId === merchantId) return true
  if (!rule.descriptionMatchKind || !rule.normalisedDescriptionPattern) return false
  if (
    (transaction.transactionType === 'card_settlement' ||
      transaction.transactionType === 'transfer') &&
    rule.descriptionMatchKind !== 'exact'
  ) {
    return false
  }
  return matchText(rule.descriptionMatchKind, rule.normalisedDescriptionPattern, text)
}

function ruleRank(rule: CategorisationRule): number {
  const conditionRank = rule.merchantId
    ? 4000
    : rule.descriptionMatchKind === 'exact'
      ? 3000
      : rule.descriptionMatchKind === 'starts_with'
        ? 2000
        : 1000
  return conditionRank + rule.priority
}

function collectRuleConflicts(rules: CategorisationRule[]): ClassificationConflict[] {
  if (rules.length <= 1) return []
  const conflicts: ClassificationConflict[] = []
  addConflict(
    conflicts,
    'merchant',
    rules.map((rule) => rule.merchantId)
  )
  addConflict(
    conflicts,
    'category',
    rules.map((rule) => rule.categoryId)
  )
  addConflict(
    conflicts,
    'usageType',
    rules.map((rule) => rule.usageType)
  )
  addConflict(
    conflicts,
    'costBehaviour',
    rules.map((rule) => rule.costBehaviour)
  )
  addConflict(
    conflicts,
    'necessity',
    rules.map((rule) => rule.necessity)
  )
  return conflicts
}

function addConflict(
  conflicts: ClassificationConflict[],
  field: ClassificationConflict['field'],
  values: (string | undefined)[]
): void {
  const meaningful = new Set(values.filter((value) => value && value !== 'unspecified'))
  if (meaningful.size > 1) {
    conflicts.push({ field, reason: 'equal_rank_rule_conflict' })
  }
}
