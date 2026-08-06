import type { Database } from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import {
  accountSummaryDtoSchema,
  createAccountInputDtoSchema,
  importBatchSummaryDtoSchema,
  overviewStatsDtoSchema,
  transactionListQueryDtoSchema,
  transactionPageDtoSchema,
  updateAccountInputDtoSchema,
  type AccountSummaryDto,
  type CommittedImportDto,
  type CommittedReconciliationDto,
  type ImportBatchSummaryDto,
  type ImportPreviewSessionDto,
  type OverviewStatsDto,
  type ReconciliationCandidateDto,
  type ReconciliationPreviewDto,
  type ReversedReconciliationDto,
  type SettlementSummaryDto,
  type TransactionListQueryDto,
  type TransactionPageDto
} from '../../shared/dtos'
import type { ImportBatch } from '../domain/schemas'
import { ImportService } from '../services/import-service'
import { VisaSettlementReconciliationService } from '../reconciliation/visa-settlement-reconciliation-service'
import { AccountRepository } from '../storage/accounts'
import { ImportBatchRepository } from '../storage/import-batches'
import { TransactionLinkRepository } from '../storage/transaction-links'
import { TransactionRepository } from '../storage/transactions'
import {
  accountToDto,
  candidateToDto,
  importBatchToDto,
  reconciliationPreviewToDto,
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
  readonly previews: ImportPreviewWorkflow

  constructor(database: Database, dialogAdapter: FileDialogAdapter) {
    this.accounts = new AccountRepository(database)
    this.importBatches = new ImportBatchRepository(database)
    this.imports = new ImportService(database)
    this.links = new TransactionLinkRepository(database)
    this.reconciliation = new VisaSettlementReconciliationService(database)
    this.transactions = new TransactionRepository(database)
    this.previews = new ImportPreviewWorkflow(database, dialogAdapter)
  }

  getOverviewStats(): OverviewStatsDto {
    return overviewStatsDtoSchema.parse({
      accountCount: this.accounts.count(),
      committedImportCount: this.importBatches.countCommitted(),
      transactionCount: this.transactions.countAll(),
      unreconciledCardSettlementCount: this.transactions.countUnreconciledCardSettlements()
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
        return transactionToRowDto(transaction, account)
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
