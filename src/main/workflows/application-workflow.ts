import type { Database } from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import {
  accountSummaryDtoSchema,
  acceptAiSuggestionInputDtoSchema,
  aiConnectionTestDtoSchema,
  aiSettingsDtoSchema,
  aiSuggestionReviewDtoSchema,
  aiSuggestionDtoSchema,
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
  listAiSuggestionsInputDtoSchema,
  merchantAliasDtoSchema,
  merchantDtoSchema,
  merchantListQueryDtoSchema,
  overviewStatsDtoSchema,
  rejectAiSuggestionInputDtoSchema,
  ruleApplicationPreviewDtoSchema,
  ruleInputDtoSchema,
  saveManualClassificationInputDtoSchema,
  saveOpenAiApiKeyInputDtoSchema,
  smartClassifyBatchInputDtoSchema,
  smartClassifyInputDtoSchema,
  smartClassifySummaryDtoSchema,
  transactionListQueryDtoSchema,
  transactionPageDtoSchema,
  updateAccountInputDtoSchema,
  updateAiSettingsInputDtoSchema,
  updateCategoryInputDtoSchema,
  updateMerchantAliasInputDtoSchema,
  updateMerchantInputDtoSchema,
  type AccountSummaryDto,
  type AiConnectionTestDto,
  type AiSettingsDto,
  type AiSuggestionDto,
  type AiSuggestionReviewDto,
  type BulkClassificationResultDto,
  type CategorisationRuleDto,
  type CategoryDto,
  type ClassificationSummaryDto,
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
  type SmartClassifySummaryDto,
  type SettlementSummaryDto,
  type TransactionListQueryDto,
  type TransactionPageDto
} from '../../shared/dtos'
import type { AiClassificationSuggestion, ImportBatch } from '../domain/schemas'
import { aiModelConfig } from '../ai/config'
import { isDevelopmentRuntime, probeOpenAiModelsEndpoint } from '../ai/diagnostics'
import { AiNotConfiguredError } from '../ai/errors'
import {
  OpenAiClassificationProvider,
  testOpenAiResponsesConnection,
  type AiClassificationProvider
} from '../ai/provider'
import { SmartClassificationService } from '../ai/smart-classification-service'
import type { AiSuggestionReviewComponentStatus } from '../ai/smart-classification-service'
import { MemorySecretStore, type SecretStore } from '../ai/secret-store'
import { ClassificationService } from '../categorisation/classification-service'
import { ImportService } from '../services/import-service'
import { VisaSettlementReconciliationService } from '../reconciliation/visa-settlement-reconciliation-service'
import { AccountRepository } from '../storage/accounts'
import { ImportBatchRepository } from '../storage/import-batches'
import { TransactionLinkRepository } from '../storage/transaction-links'
import { TransactionRepository } from '../storage/transactions'
import { AiSettingsRepository, AiSuggestionRepository } from '../storage/ai'
import {
  CategorisationRuleRepository,
  CategoryRepository,
  MerchantAliasRepository,
  MerchantRepository,
  TransactionClassificationRepository
} from '../storage/categorisation'
import {
  accountToDto,
  aiSuggestionToDto,
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
  private readonly secretStore: SecretStore
  private readonly aiSettings: AiSettingsRepository
  private readonly aiSuggestions: AiSuggestionRepository
  private readonly smartClassification: SmartClassificationService
  readonly previews: ImportPreviewWorkflow

  constructor(
    database: Database,
    dialogAdapter: FileDialogAdapter,
    secretStore: SecretStore = new MemorySecretStore(),
    aiProvider?: AiClassificationProvider
  ) {
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
    this.secretStore = secretStore
    this.aiSettings = new AiSettingsRepository(database)
    this.aiSuggestions = new AiSuggestionRepository(database)
    this.smartClassification = new SmartClassificationService(
      database,
      aiProvider ?? new OpenAiClassificationProvider(secretStore)
    )
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
          merchantDisplay: this.merchantDisplay(transaction.id, proposal),
          categoryId: proposal.categoryId,
          categoryPath: proposal.categoryPath,
          categoryDisplay: this.categoryDisplay(transaction.id, proposal),
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
    const proposal = this.classification.evaluateTransaction(transactionId)
    return classificationProposalDtoSchema.parse({
      ...proposalToDto(proposal),
      merchantDisplay: this.merchantDisplay(transactionId, proposal),
      categoryDisplay: this.categoryDisplay(transactionId, proposal)
    })
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

  async getAiSettings(): Promise<AiSettingsDto> {
    const settings = this.aiSettings.get()
    return aiSettingsDtoSchema.parse({
      ...settings,
      keyConfigured: await this.secretStore.hasOpenAiApiKey(),
      models: aiModelConfig
    })
  }

  async saveOpenAiApiKey(input: unknown): Promise<AiSettingsDto> {
    const parsed = saveOpenAiApiKeyInputDtoSchema.parse(input)
    await this.secretStore.setOpenAiApiKey(parsed.apiKey)
    return this.getAiSettings()
  }

  async deleteOpenAiApiKey(): Promise<AiSettingsDto> {
    await this.secretStore.deleteOpenAiApiKey()
    this.aiSettings.update({ aiEnabled: false })
    return this.getAiSettings()
  }

  async updateAiSettings(input: unknown): Promise<AiSettingsDto> {
    const parsed = updateAiSettingsInputDtoSchema.parse(input)
    this.aiSettings.update(parsed)
    return this.getAiSettings()
  }

  async testAiConnection(): Promise<AiConnectionTestDto> {
    if (!(await this.secretStore.hasOpenAiApiKey())) {
      return aiConnectionTestDtoSchema.parse({ status: 'invalid_key' })
    }

    try {
      if (isDevelopmentRuntime()) {
        await probeOpenAiModelsEndpoint()
      }

      await testOpenAiResponsesConnection(this.secretStore)
      return aiConnectionTestDtoSchema.parse({ status: 'connected' })
    } catch (error) {
      return aiConnectionTestDtoSchema.parse({ status: this.mapAiConnectionError(error) })
    }
  }

  async smartClassify(input: unknown): Promise<SmartClassifySummaryDto> {
    const parsed = smartClassifyInputDtoSchema.parse(input)
    logAiManualClassifyDiagnostic('manual classify received', {
      count: parsed.transactionIds.length
    })
    const previousSettings = this.aiSettings.get()
    if (typeof parsed.allowWebLookup === 'boolean') {
      this.aiSettings.update({ allowWebLookup: parsed.allowWebLookup })
    }

    try {
      logAiManualClassifyDiagnostic('manual classification started', {
        count: parsed.transactionIds.length
      })
      const summary = await this.smartClassification.classifyTransactions(parsed.transactionIds)
      return smartClassifySummaryDtoSchema.parse(summary)
    } finally {
      if (typeof parsed.allowWebLookup === 'boolean') this.aiSettings.update(previousSettings)
    }
  }

  async smartClassifyImportBatch(input: unknown): Promise<SmartClassifySummaryDto> {
    const parsed = smartClassifyBatchInputDtoSchema.parse(input)
    const transactions = this.transactions.listForImportBatch(parsed.importBatchId)
    return smartClassifySummaryDtoSchema.parse(
      await this.smartClassification.classifyTransactions(
        transactions.map((transaction) => transaction.id)
      )
    )
  }

  listAiSuggestions(input?: unknown): AiSuggestionDto[] {
    const parsed = listAiSuggestionsInputDtoSchema.parse(input ?? {})
    const suggestions = parsed.transactionQuery
      ? this.aiSuggestions.listPendingForTransactions(
          this.transactions.listFilteredIds({
            sortBy: 'transactionDate',
            sortDirection: 'desc',
            ...parsed.transactionQuery
          })
        )
      : this.aiSuggestions.listPending()

    return suggestions.map((suggestion) =>
      aiSuggestionDtoSchema.parse(
        aiSuggestionToDto({
          suggestion,
          categoryPath: this.categoryPath(suggestion.suggestedCategoryId),
          ...this.aiSuggestionActionability(suggestion.transactionId, suggestion)
        })
      )
    )
  }

  acceptAiSuggestion(input: unknown): AiSuggestionReviewDto {
    const parsed = acceptAiSuggestionInputDtoSchema.parse(input)
    logAiReviewDiagnostic('review received', {
      action: aiAcceptanceMode(parsed)
    })
    return this.aiSuggestionReviewToDto(this.smartClassification.acceptSuggestion(parsed))
  }

  rejectAiSuggestion(input: unknown): AiSuggestionReviewDto {
    const parsed = rejectAiSuggestionInputDtoSchema.parse(input)
    logAiReviewDiagnostic('review received', {
      action: 'reject'
    })
    const suggestion = this.smartClassification.rejectSuggestion(parsed.suggestionId)
    return this.aiSuggestionReviewToDto({
      suggestion,
      category: 'not_suggested',
      merchant: 'not_suggested'
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

  private categoryPath(categoryId: string | undefined): string[] | undefined {
    if (!categoryId) return undefined
    const categories = this.categories.list()
    const category = categories.find((candidate) => candidate.id === categoryId)
    if (!category) return undefined
    const parent = category.parentId
      ? categories.find((candidate) => candidate.id === category.parentId)
      : undefined
    return parent ? [parent.name, category.name] : [category.name]
  }

  private merchantDisplay(
    transactionId: string,
    proposal: ClassificationProposalDto
  ): NonNullable<ClassificationSummaryDto['merchantDisplay']> {
    const authoritativeId = this.classifications.findByTransactionId(transactionId)?.merchantId
    const authoritativeName = authoritativeId
      ? this.merchants.findById(authoritativeId).name
      : undefined
    const detectedName =
      proposal.merchantName && proposal.merchantId !== authoritativeId
        ? proposal.merchantName
        : undefined
    const displayName = authoritativeName ?? proposal.merchantName

    return {
      authoritativeId,
      authoritativeName,
      detectedName,
      displayName,
      source: authoritativeName ? 'authoritative' : displayName ? 'detected' : 'unknown'
    }
  }

  private categoryDisplay(
    transactionId: string,
    proposal: ClassificationProposalDto
  ): NonNullable<ClassificationSummaryDto['categoryDisplay']> {
    const authoritativeId = this.classifications.findByTransactionId(transactionId)?.categoryId
    const authoritativePath = this.categoryPath(authoritativeId)
    const detectedPath =
      proposal.categoryPath && proposal.categoryId !== authoritativeId
        ? proposal.categoryPath
        : undefined
    const displayPath = authoritativePath ?? proposal.categoryPath

    return {
      authoritativeId,
      authoritativePath,
      detectedId: detectedPath ? proposal.categoryId : undefined,
      detectedPath,
      displayPath,
      source: authoritativePath ? 'authoritative' : displayPath ? 'detected' : 'unknown'
    }
  }

  private aiSuggestionReviewToDto(input: {
    suggestion: AiClassificationSuggestion
    category: AiSuggestionReviewComponentStatus
    merchant: AiSuggestionReviewComponentStatus
  }): AiSuggestionReviewDto {
    const suggestion = aiSuggestionToDto({
      suggestion: input.suggestion,
      categoryPath: this.categoryPath(input.suggestion.suggestedCategoryId),
      ...this.aiSuggestionActionability(input.suggestion.transactionId, input.suggestion)
    })

    return aiSuggestionReviewDtoSchema.parse({
      suggestion,
      category: input.category,
      merchant: input.merchant,
      suggestionStatus: input.suggestion.status
    })
  }

  private aiSuggestionActionability(
    transactionId: string,
    suggestion: AiClassificationSuggestion
  ): { canAcceptCategory: boolean; canAcceptMerchant: boolean } {
    const classification = this.classifications.findByTransactionId(transactionId)
    return {
      canAcceptCategory: Boolean(
        suggestion.suggestedCategoryId &&
        !(classification?.categoryId && classification.categorySource === 'manual')
      ),
      canAcceptMerchant: Boolean(
        suggestion.suggestedMerchantName &&
        !(classification?.merchantId && classification.merchantSource === 'manual')
      )
    }
  }

  private mapAiConnectionError(error: unknown): AiConnectionTestDto['status'] {
    if (error instanceof AiNotConfiguredError) return 'invalid_key'
    const code = (error as { code?: string }).code
    if (code === 'AI_INVALID_REQUEST' || code === 'AI_UNPROCESSABLE_REQUEST')
      return 'invalid_request'
    if (code === 'AI_INVALID_KEY') return 'invalid_key'
    if (code === 'AI_PERMISSION_ERROR') return 'permission_error'
    if (code === 'AI_MODEL_NOT_FOUND') return 'model_not_found'
    if (code === 'AI_RATE_LIMITED' || code === 'AI_QUOTA_EXCEEDED') return 'quota_or_rate_limit'
    if (code === 'AI_TIMEOUT') return 'timeout'
    if (code === 'AI_NETWORK_ERROR') return 'network_error'
    return 'service_error'
  }
}

function aiAcceptanceMode(input: { acceptCategory: boolean; acceptMerchant: boolean }): string {
  if (input.acceptCategory && input.acceptMerchant) return 'both'
  if (input.acceptCategory) return 'category'
  if (input.acceptMerchant) return 'merchant'
  return 'none'
}

function logAiReviewDiagnostic(label: string, metadata: Record<string, unknown>): void {
  if (process.env['NODE_ENV'] === 'production' && !process.env['ELECTRON_RENDERER_URL']) return
  console.warn(`[sampo-ai-ipc] ${label}`, metadata)
}

function logAiManualClassifyDiagnostic(label: string, metadata: Record<string, unknown>): void {
  if (process.env['NODE_ENV'] === 'production' && !process.env['ELECTRON_RENDERER_URL']) return
  console.warn(`[sampo-ai-ipc] ${label}`, metadata)
}

export function ensureAccountSourceCompatibilityForTransaction(
  accountId: string,
  sourceKind: Parameters<typeof assertAccountSourceCompatibility>[1],
  accounts: AccountRepository
): void {
  assertAccountSourceCompatibility(accounts.findById(accountId), sourceKind)
}
