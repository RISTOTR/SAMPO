import type { Database } from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import {
  accountSummaryDtoSchema,
  applyRuleInputDtoSchema,
  bulkClassificationInputDtoSchema,
  bulkClassificationResultDtoSchema,
  categorisationRuleDtoSchema,
  categoryDtoSchema,
  classificationProposalDtoSchema,
  createAccountInputDtoSchema,
  createCategoryInputDtoSchema,
  createMerchantAliasInputDtoSchema,
  createMerchantInputDtoSchema,
  importBatchSummaryDtoSchema,
  merchantAliasDtoSchema,
  merchantDtoSchema,
  merchantListQueryDtoSchema,
  overviewStatsDtoSchema,
  ruleApplicationPreviewDtoSchema,
  ruleInputDtoSchema,
  saveManualClassificationInputDtoSchema,
  transactionListQueryDtoSchema,
  transactionPageDtoSchema,
  updateAccountInputDtoSchema,
  updateCategoryInputDtoSchema,
  updateMerchantAliasInputDtoSchema,
  updateMerchantInputDtoSchema,
  type AccountSummaryDto,
  type BulkClassificationResultDto,
  type CategorisationRuleDto,
  type CategoryDto,
  type ClassificationProposalDto,
  type CommittedImportDto,
  type CommittedReconciliationDto,
  type ImportBatchSummaryDto,
  type ImportPreviewSessionDto,
  type MerchantAliasDto,
  type MerchantDto,
  type OverviewStatsDto,
  type ReconciliationCandidateDto,
  type ReconciliationPreviewDto,
  type ReversedReconciliationDto,
  type RuleApplicationPreviewDto,
  type SettlementSummaryDto,
  type TransactionListQueryDto,
  type TransactionPageDto
} from '../../shared/dtos'
import type { ImportBatch } from '../domain/schemas'
import { ClassificationService } from '../categorisation/classification-service'
import { ImportService } from '../services/import-service'
import { VisaSettlementReconciliationService } from '../reconciliation/visa-settlement-reconciliation-service'
import { AccountRepository } from '../storage/accounts'
import { ImportBatchRepository } from '../storage/import-batches'
import { TransactionLinkRepository } from '../storage/transaction-links'
import { TransactionRepository } from '../storage/transactions'
import {
  CategorisationRuleRepository,
  CategoryRepository,
  MerchantAliasRepository,
  MerchantRepository,
  TransactionClassificationRepository
} from '../storage/categorisation'
import {
  accountToDto,
  candidateToDto,
  categoryToDto,
  merchantAliasToDto,
  merchantToDto,
  importBatchToDto,
  proposalToDto,
  reconciliationPreviewToDto,
  ruleToDto,
  settlementToDto,
  transactionToRowDto
} from './dto-mappers'
import {
  assertAccountSourceCompatibility,
  ImportPreviewWorkflow,
  type FileDialogAdapter
} from './import-preview-workflow'

export class ApplicationWorkflow {
  private readonly accounts: AccountRepository
  private readonly importBatches: ImportBatchRepository
  private readonly imports: ImportService
  private readonly links: TransactionLinkRepository
  private readonly reconciliation: VisaSettlementReconciliationService
  private readonly transactions: TransactionRepository
  private readonly categories: CategoryRepository
  private readonly merchants: MerchantRepository
  private readonly merchantAliases: MerchantAliasRepository
  private readonly rules: CategorisationRuleRepository
  private readonly classifications: TransactionClassificationRepository
  private readonly classification: ClassificationService
  readonly previews: ImportPreviewWorkflow

  constructor(database: Database, dialogAdapter: FileDialogAdapter) {
    this.accounts = new AccountRepository(database)
    this.importBatches = new ImportBatchRepository(database)
    this.imports = new ImportService(database)
    this.links = new TransactionLinkRepository(database)
    this.reconciliation = new VisaSettlementReconciliationService(database)
    this.transactions = new TransactionRepository(database)
    this.categories = new CategoryRepository(database)
    this.merchants = new MerchantRepository(database)
    this.merchantAliases = new MerchantAliasRepository(database)
    this.rules = new CategorisationRuleRepository(database)
    this.classifications = new TransactionClassificationRepository(database)
    this.classification = new ClassificationService(database)
    this.previews = new ImportPreviewWorkflow(database, dialogAdapter)
  }

  getOverviewStats(): OverviewStatsDto {
    const classificationCounts = this.classifications.countByStatus()
    return overviewStatsDtoSchema.parse({
      accountCount: this.accounts.count(),
      committedImportCount: this.importBatches.countCommitted(),
      transactionCount: this.transactions.countAll(),
      unreconciledCardSettlementCount: this.transactions.countUnreconciledCardSettlements(),
      classifiedTransactionCount: classificationCounts.classified,
      unclassifiedTransactionCount: classificationCounts.unclassified,
      classificationNeedsReviewCount: classificationCounts.needsReview,
      activeCategorisationRuleCount: classificationCounts.activeRules
    })
  }

  listAccounts(): AccountSummaryDto[] {
    return this.accounts
      .list()
      .map((account) => accountSummaryDtoSchema.parse(accountToDto(account)))
  }

  createAccount(input: unknown): AccountSummaryDto {
    const parsed = createAccountInputDtoSchema.parse(input)
    return accountSummaryDtoSchema.parse(this.accounts.create(parsed))
  }

  updateAccount(input: unknown): AccountSummaryDto {
    const parsed = updateAccountInputDtoSchema.parse(input)
    return accountSummaryDtoSchema.parse(
      accountToDto(
        this.accounts.updateDetails(parsed.id, {
          name: parsed.name,
          institution: parsed.institution
        })
      )
    )
  }

  deleteUnusedAccount(accountId: string): void {
    this.accounts.deleteUnused(accountId)
  }

  selectAndInspectImport(
    accountId: string,
    browserWindow?: BrowserWindow
  ): Promise<ImportPreviewSessionDto | null> {
    return this.previews.selectAndInspectImport(accountId, browserWindow)
  }

  commitImportPreview(sessionId: string): Promise<CommittedImportDto> {
    return this.previews.commitImportPreview(sessionId)
  }

  discardImportPreview(sessionId: string): void {
    this.previews.discardImportPreview(sessionId)
  }

  listImportBatches(): ImportBatchSummaryDto[] {
    return this.importBatches
      .list()
      .map((batch) => this.importBatchSummary(batch))
      .map((batch) => importBatchSummaryDtoSchema.parse(batch))
  }

  rollbackImportBatch(importBatchId: string): ImportBatchSummaryDto {
    const rolledBack = this.imports.rollbackCommittedBatch(importBatchId)
    return importBatchSummaryDtoSchema.parse(this.importBatchSummary(rolledBack))
  }

  listTransactions(input: TransactionListQueryDto): TransactionPageDto {
    const query = transactionListQueryDtoSchema.parse(input)
    const page = this.transactions.listPage(query)
    const accountMap = new Map(this.accounts.list().map((account) => [account.id, account]))

    return transactionPageDtoSchema.parse({
      items: page.items.map((transaction) => {
        const account =
          accountMap.get(transaction.accountId) ?? this.accounts.findById(transaction.accountId)
        const proposal = this.classification.evaluateTransaction(transaction.id)
        return transactionToRowDto(transaction, account, {
          merchantId: proposal.merchantId,
          merchantName: proposal.merchantName,
          categoryId: proposal.categoryId,
          categoryPath: proposal.categoryPath,
          usageType: proposal.usageType,
          costBehaviour: proposal.costBehaviour,
          necessity: proposal.necessity,
          classificationSource: proposal.source,
          classificationStatus: proposal.status,
          appliedRuleId: proposal.matchedRuleId,
          appliedRuleName: proposal.matchedRuleName
        })
      }),
      total: page.total,
      limit: query.limit,
      offset: query.offset
    })
  }

  listUnreconciledSettlements(): SettlementSummaryDto[] {
    return this.transactions.listCardSettlements().map((settlement) => {
      const account = this.accounts.findById(settlement.accountId)
      const reconciled = this.links.listCardSettlementLinksFromSettlement(settlement.id).length > 0
      return settlementToDto(settlement, account, reconciled)
    })
  }

  findReconciliationCandidates(settlementTransactionId: string): ReconciliationCandidateDto[] {
    return this.reconciliation
      .findVisaSettlementCandidates(settlementTransactionId)
      .map((candidate) => {
        const visaBatch = this.importBatches.findById(candidate.visaImportBatchId)
        const visaAccount = this.accounts.findById(candidate.visaAccountId)
        return candidateToDto(candidate, visaAccount, visaBatch)
      })
  }

  previewReconciliation(
    settlementTransactionId: string,
    visaImportBatchId: string
  ): ReconciliationPreviewDto {
    return reconciliationPreviewToDto(
      this.reconciliation.previewVisaSettlementReconciliation(
        settlementTransactionId,
        visaImportBatchId
      )
    )
  }

  commitReconciliation(
    settlementTransactionId: string,
    visaImportBatchId: string
  ): CommittedReconciliationDto {
    return this.reconciliation.commitVisaSettlementReconciliation(
      settlementTransactionId,
      visaImportBatchId
    )
  }

  reverseReconciliation(settlementTransactionId: string): ReversedReconciliationDto {
    return this.reconciliation.reverseVisaSettlementReconciliation(settlementTransactionId)
  }

  clearPreviewSessions(): void {
    this.previews.clearSessions()
  }

  listCategories(): CategoryDto[] {
    return this.categories
      .list()
      .map((category) => categoryDtoSchema.parse(categoryToDto(category)))
  }

  createCategory(input: unknown): CategoryDto {
    const parsed = createCategoryInputDtoSchema.parse(input)
    return categoryDtoSchema.parse(categoryToDto(this.categories.create(parsed)))
  }

  updateCategory(input: unknown): CategoryDto {
    const parsed = updateCategoryInputDtoSchema.parse(input)
    return categoryDtoSchema.parse(categoryToDto(this.categories.update(parsed)))
  }

  deactivateCategory(id: string): CategoryDto {
    return categoryDtoSchema.parse(categoryToDto(this.categories.setActive(id, false)))
  }

  reactivateCategory(id: string): CategoryDto {
    return categoryDtoSchema.parse(categoryToDto(this.categories.setActive(id, true)))
  }

  deleteUnusedCategory(id: string): void {
    this.categories.deleteUnused(id)
  }

  listMerchants(input: unknown): MerchantDto[] {
    const query = merchantListQueryDtoSchema.parse(input ?? {})
    return this.merchants
      .list(query)
      .map((merchant) => merchantDtoSchema.parse(merchantToDto(merchant)))
  }

  createMerchant(input: unknown): MerchantDto {
    const parsed = createMerchantInputDtoSchema.parse(input)
    return merchantDtoSchema.parse(merchantToDto(this.merchants.create(parsed)))
  }

  updateMerchant(input: unknown): MerchantDto {
    const parsed = updateMerchantInputDtoSchema.parse(input)
    return merchantDtoSchema.parse(merchantToDto(this.merchants.update(parsed)))
  }

  listMerchantAliases(): MerchantAliasDto[] {
    return this.merchantAliases
      .list()
      .map((alias) => merchantAliasDtoSchema.parse(merchantAliasToDto(alias)))
  }

  createMerchantAlias(input: unknown): MerchantAliasDto {
    const parsed = createMerchantAliasInputDtoSchema.parse(input)
    return merchantAliasDtoSchema.parse(merchantAliasToDto(this.merchantAliases.create(parsed)))
  }

  updateMerchantAlias(input: unknown): MerchantAliasDto {
    const parsed = updateMerchantAliasInputDtoSchema.parse(input)
    return merchantAliasDtoSchema.parse(merchantAliasToDto(this.merchantAliases.update(parsed)))
  }

  deactivateMerchantAlias(id: string): MerchantAliasDto {
    return merchantAliasDtoSchema.parse(merchantAliasToDto(this.merchantAliases.deactivate(id)))
  }

  getClassification(transactionId: string): ClassificationProposalDto {
    return classificationProposalDtoSchema.parse(
      proposalToDto(this.classification.evaluateTransaction(transactionId))
    )
  }

  saveManualClassification(input: unknown): ClassificationProposalDto {
    const parsed = saveManualClassificationInputDtoSchema.parse(input)
    this.classification.saveManual(parsed)
    return this.getClassification(parsed.transactionId)
  }

  previewRule(input: unknown): RuleApplicationPreviewDto {
    const parsed = ruleInputDtoSchema.parse(input)
    const preview = this.classification.previewRule(parsed)
    return ruleApplicationPreviewDtoSchema.parse({
      ...preview,
      proposals: preview.proposals.map(proposalToDto)
    })
  }

  createRule(input: unknown): CategorisationRuleDto {
    const parsed = ruleInputDtoSchema.parse(input)
    return categorisationRuleDtoSchema.parse(ruleToDto(this.classification.createRule(parsed)))
  }

  applyRule(input: unknown): RuleApplicationPreviewDto {
    const parsed = applyRuleInputDtoSchema.parse(input)
    const preview = this.classification.applyRule(parsed)
    return ruleApplicationPreviewDtoSchema.parse({
      ...preview,
      proposals: preview.proposals.map(proposalToDto)
    })
  }

  bulkUpdateClassification(input: unknown): BulkClassificationResultDto {
    const parsed = bulkClassificationInputDtoSchema.parse(input)
    return bulkClassificationResultDtoSchema.parse({
      updatedCount: this.classification.bulkUpdate(parsed)
    })
  }

  listRules(): CategorisationRuleDto[] {
    return this.rules.list().map((rule) => categorisationRuleDtoSchema.parse(ruleToDto(rule)))
  }

  activateRule(id: string): CategorisationRuleDto {
    return categorisationRuleDtoSchema.parse(ruleToDto(this.rules.setActive(id, true)))
  }

  deactivateRule(id: string): CategorisationRuleDto {
    return categorisationRuleDtoSchema.parse(ruleToDto(this.rules.setActive(id, false)))
  }

  private importBatchSummary(batch: ImportBatch): ImportBatchSummaryDto {
    const account = this.accounts.findById(batch.accountId)
    const rollbackBlockedByReconciliation =
      batch.status === 'committed' &&
      this.links.importBatchParticipatesInCardSettlementLinks(batch.id)

    return importBatchToDto(batch, account, rollbackBlockedByReconciliation)
  }
}

export function ensureAccountSourceCompatibilityForTransaction(
  accountId: string,
  sourceKind: Parameters<typeof assertAccountSourceCompatibility>[1],
  accounts: AccountRepository
): void {
  assertAccountSourceCompatibility(accounts.findById(accountId), sourceKind)
}
