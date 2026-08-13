import type {
  AccountSummaryDto,
  AcceptAiSuggestionInputDto,
  AiConnectionTestDto,
  AiSettingsDto,
  AiSuggestionDto,
  AiSuggestionReviewDto,
  ApiResult,
  ApplyRuleInputDto,
  BulkClassificationInputDto,
  BulkClassificationResultDto,
  CategorisationRuleDto,
  CategoryDto,
  ClassificationProposalDto,
  CommittedImportDto,
  CommittedReconciliationDto,
  CreateAccountInputDto,
  CreateCategoryInputDto,
  CreateMerchantAliasInputDto,
  CreateMerchantInputDto,
  ImportBatchSummaryDto,
  ImportPreviewSessionDto,
  ListAiSuggestionsInputDto,
  MatchingClassificationSummaryDto,
  MatchingClassificationSummaryInputDto,
  MerchantAliasDto,
  MerchantDto,
  MerchantListQueryDto,
  OverviewStatsDto,
  ReconciliationCandidateDto,
  ReconciliationPreviewDto,
  ReversedReconciliationDto,
  RuleApplicationPreviewDto,
  RuleInputDto,
  SaveManualAndConfirmMatchesResultDto,
  SaveManualClassificationInputDto,
  SaveOpenAiApiKeyInputDto,
  SettlementSummaryDto,
  SmartClassifyBatchInputDto,
  SmartClassifyInputDto,
  SmartClassifySummaryDto,
  TransactionListQueryDto,
  TransactionPageDto,
  UpdateAccountInputDto,
  UpdateAiSettingsInputDto,
  UpdateCategoryInputDto,
  UpdateMerchantAliasInputDto,
  UpdateMerchantInputDto
} from './dtos'

export type AppInfo = {
  name: string
  version: string
  platform: string
  arch: string
}

export type SampoApi = {
  getAppInfo: () => Promise<AppInfo>
  overview: {
    getStats: () => Promise<ApiResult<OverviewStatsDto>>
  }
  accounts: {
    list: () => Promise<ApiResult<AccountSummaryDto[]>>
    create: (input: CreateAccountInputDto) => Promise<ApiResult<AccountSummaryDto>>
    update: (input: UpdateAccountInputDto) => Promise<ApiResult<AccountSummaryDto>>
    deleteUnused: (accountId: string) => Promise<ApiResult<void>>
  }
  imports: {
    selectAndInspect: (accountId: string) => Promise<ApiResult<ImportPreviewSessionDto | null>>
    commitPreview: (sessionId: string) => Promise<ApiResult<CommittedImportDto>>
    discardPreview: (sessionId: string) => Promise<ApiResult<void>>
    list: () => Promise<ApiResult<ImportBatchSummaryDto[]>>
    rollback: (importBatchId: string) => Promise<ApiResult<ImportBatchSummaryDto>>
  }
  transactions: {
    list: (query: TransactionListQueryDto) => Promise<ApiResult<TransactionPageDto>>
  }
  reconciliation: {
    listUnreconciledSettlements: () => Promise<ApiResult<SettlementSummaryDto[]>>
    findCandidates: (
      settlementTransactionId: string
    ) => Promise<ApiResult<ReconciliationCandidateDto[]>>
    preview: (
      settlementTransactionId: string,
      visaImportBatchId: string
    ) => Promise<ApiResult<ReconciliationPreviewDto>>
    commit: (
      settlementTransactionId: string,
      visaImportBatchId: string
    ) => Promise<ApiResult<CommittedReconciliationDto>>
    reverse: (settlementTransactionId: string) => Promise<ApiResult<ReversedReconciliationDto>>
  }
  categories: {
    list: () => Promise<ApiResult<CategoryDto[]>>
    create: (input: CreateCategoryInputDto) => Promise<ApiResult<CategoryDto>>
    update: (input: UpdateCategoryInputDto) => Promise<ApiResult<CategoryDto>>
    deactivate: (id: string) => Promise<ApiResult<CategoryDto>>
    reactivate: (id: string) => Promise<ApiResult<CategoryDto>>
    deleteUnused: (id: string) => Promise<ApiResult<void>>
  }
  merchants: {
    list: (query?: MerchantListQueryDto) => Promise<ApiResult<MerchantDto[]>>
    create: (input: CreateMerchantInputDto) => Promise<ApiResult<MerchantDto>>
    update: (input: UpdateMerchantInputDto) => Promise<ApiResult<MerchantDto>>
  }
  merchantAliases: {
    list: () => Promise<ApiResult<MerchantAliasDto[]>>
    create: (input: CreateMerchantAliasInputDto) => Promise<ApiResult<MerchantAliasDto>>
    update: (input: UpdateMerchantAliasInputDto) => Promise<ApiResult<MerchantAliasDto>>
    deactivate: (id: string) => Promise<ApiResult<MerchantAliasDto>>
  }
  classification: {
    get: (transactionId: string) => Promise<ApiResult<ClassificationProposalDto>>
    saveManual: (
      input: SaveManualClassificationInputDto
    ) => Promise<ApiResult<ClassificationProposalDto>>
    matchingSummary: (
      input: MatchingClassificationSummaryInputDto
    ) => Promise<ApiResult<MatchingClassificationSummaryDto>>
    saveManualAndConfirmMatches: (
      input: SaveManualClassificationInputDto
    ) => Promise<ApiResult<SaveManualAndConfirmMatchesResultDto>>
    previewRule: (input: RuleInputDto) => Promise<ApiResult<RuleApplicationPreviewDto>>
    createRule: (input: RuleInputDto) => Promise<ApiResult<CategorisationRuleDto>>
    applyRule: (input: ApplyRuleInputDto) => Promise<ApiResult<RuleApplicationPreviewDto>>
    bulkUpdate: (
      input: BulkClassificationInputDto
    ) => Promise<ApiResult<BulkClassificationResultDto>>
  }
  rules: {
    list: () => Promise<ApiResult<CategorisationRuleDto[]>>
    activate: (id: string) => Promise<ApiResult<CategorisationRuleDto>>
    deactivate: (id: string) => Promise<ApiResult<CategorisationRuleDto>>
  }
  ai: {
    getSettings: () => Promise<ApiResult<AiSettingsDto>>
    saveOpenAiApiKey: (input: SaveOpenAiApiKeyInputDto) => Promise<ApiResult<AiSettingsDto>>
    deleteOpenAiApiKey: () => Promise<ApiResult<AiSettingsDto>>
    updateSettings: (input: UpdateAiSettingsInputDto) => Promise<ApiResult<AiSettingsDto>>
    testConnection: () => Promise<ApiResult<AiConnectionTestDto>>
    smartClassify: (input: SmartClassifyInputDto) => Promise<ApiResult<SmartClassifySummaryDto>>
    smartClassifyImportBatch: (
      input: SmartClassifyBatchInputDto
    ) => Promise<ApiResult<SmartClassifySummaryDto>>
    listSuggestions: (input?: ListAiSuggestionsInputDto) => Promise<ApiResult<AiSuggestionDto[]>>
    acceptSuggestion: (
      input: AcceptAiSuggestionInputDto
    ) => Promise<ApiResult<AiSuggestionReviewDto>>
    rejectSuggestion: (input: { suggestionId: string }) => Promise<ApiResult<AiSuggestionReviewDto>>
  }
}
