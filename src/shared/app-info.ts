import type {
  AccountSummaryDto,
  ApiResult,
  CommittedImportDto,
  CommittedReconciliationDto,
  CreateAccountInputDto,
  ImportBatchSummaryDto,
  ImportPreviewSessionDto,
  OverviewStatsDto,
  ReconciliationCandidateDto,
  ReconciliationPreviewDto,
  ReversedReconciliationDto,
  SettlementSummaryDto,
  TransactionListQueryDto,
  TransactionPageDto,
  UpdateAccountInputDto
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
}
