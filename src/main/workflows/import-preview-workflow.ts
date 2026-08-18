import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { basename } from 'path'
import type { BrowserWindow } from 'electron'
import {
  committedImportDtoSchema,
  importPreviewSessionDtoSchema,
  type CommittedImportDto,
  type ImportPreviewSessionDto
} from '../../shared/dtos'
import { UnsupportedImportFormatError } from '../domain/errors'
import type { Account, ImportSourceKind, PreparedImport } from '../domain/schemas'
import { EvoAccountExcelImporter } from '../importers/evo-account-excel/evo-account-excel-importer'
import { EvoAccountPdfImporter } from '../importers/evo-account-pdf/evo-account-pdf-importer'
import { EvoVisaXlsImporter } from '../importers/evo-visa/evo-visa-xls-importer'
import type { ImportFileInput, ImportInspection, TransactionImporter } from '../importers/types'
import { ImportService } from '../services/import-service'
import { AccountRepository } from '../storage/accounts'
import { sha256File } from '../utils/file-hash'
import { inspectionToDto, previewTransactionToDto } from './dto-mappers'
import {
  PreviewExpiredError,
  SourceFileChangedError,
  UnsupportedAccountSourceError
} from './errors'

export type FileDialogAdapter = {
  selectImportFile: (window: BrowserWindow | undefined) => Promise<string | undefined>
}

type InternalPreviewSession = {
  id: string
  accountId: string
  filePath: string
  sourceFileName: string
  sourceKind: ImportSourceKind
  importer: TransactionImporter
  inspection: ImportInspection
  preparedImport: PreparedImport
  fileSha256: string
  createdAt: string
  expiresAt: string
}

const sessionTtlMs = 30 * 60 * 1000
const maxActiveSessions = 8

export class ImportPreviewWorkflow {
  private readonly accounts: AccountRepository
  private readonly importService: ImportService
  private readonly importers: TransactionImporter[]
  private readonly sessions = new Map<string, InternalPreviewSession>()

  constructor(
    database: Database,
    private readonly dialogAdapter: FileDialogAdapter,
    importers: TransactionImporter[] = [
      new EvoAccountExcelImporter(),
      new EvoVisaXlsImporter(),
      new EvoAccountPdfImporter()
    ]
  ) {
    this.accounts = new AccountRepository(database)
    this.importService = new ImportService(database)
    this.importers = importers
  }

  async selectAndInspectImport(
    accountId: string,
    browserWindow?: BrowserWindow
  ): Promise<ImportPreviewSessionDto | null> {
    this.pruneExpiredSessions()
    const account = this.accounts.findById(accountId)
    const filePath = await this.dialogAdapter.selectImportFile(browserWindow)

    if (!filePath) {
      return null
    }

    const input: ImportFileInput = {
      filePath,
      originalFileName: basename(filePath)
    }
    const importer = await this.detectImporter(input)

    assertAccountSourceCompatibility(account, importer.sourceKind)

    const inspection = await importer.inspect(input)
    const originalPreparedImport = await importer.prepare(input, { accountId: account.id })
    const duplicatePreview =
      this.importService.previewPreparedImportDeduplication(originalPreparedImport)
    const preparedImport = duplicatePreview.preparedImport
    const inspectionWithDuplicates: ImportInspection = {
      ...inspection,
      newTransactionCount: duplicatePreview.newTransactionCount,
      duplicateTransactionCount: duplicatePreview.duplicateTransactionCount,
      canImport:
        inspection.canImport &&
        duplicatePreview.newTransactionCount > 0 &&
        duplicatePreview.originalTransactionCount > 0
    }
    const fileSha256 = await sha256File(filePath)
    const now = new Date()
    const session: InternalPreviewSession = {
      id: randomUUID(),
      accountId: account.id,
      filePath,
      sourceFileName: basename(input.originalFileName),
      sourceKind: importer.sourceKind,
      importer,
      inspection: inspectionWithDuplicates,
      preparedImport,
      fileSha256,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + sessionTtlMs).toISOString()
    }

    if (this.sessions.size >= maxActiveSessions) {
      const oldest = [...this.sessions.values()].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt)
      )[0]

      if (oldest) {
        this.sessions.delete(oldest.id)
      }
    }

    this.sessions.set(session.id, session)
    return this.toDto(session)
  }

  async commitImportPreview(sessionId: string): Promise<CommittedImportDto> {
    const session = await this.getValidSession(sessionId)
    const account = this.accounts.findById(session.accountId)

    assertAccountSourceCompatibility(account, session.sourceKind)

    if (!existsSync(session.filePath)) {
      this.sessions.delete(session.id)
      throw new SourceFileChangedError()
    }

    const currentHash = await sha256File(session.filePath)

    if (currentHash !== session.fileSha256) {
      this.sessions.delete(session.id)
      throw new SourceFileChangedError()
    }

    const result = this.importService.commitPreparedImport(session.preparedImport)
    this.sessions.delete(session.id)

    return committedImportDtoSchema.parse({
      batchId: result.batch.id,
      transactionCount: result.transactions.length,
      sourceFileName: result.batch.sourceFileName,
      committedAt: result.batch.committedAt
    })
  }

  discardImportPreview(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  clearSessions(): void {
    this.sessions.clear()
  }

  activeSessionCount(): number {
    this.pruneExpiredSessions()
    return this.sessions.size
  }

  private async detectImporter(input: ImportFileInput): Promise<TransactionImporter> {
    for (const importer of this.importers) {
      if (await importer.canHandle(input)) {
        return importer
      }
    }

    throw new UnsupportedImportFormatError()
  }

  private async getValidSession(sessionId: string): Promise<InternalPreviewSession> {
    this.pruneExpiredSessions()
    const session = this.sessions.get(sessionId)

    if (!session) {
      throw new PreviewExpiredError()
    }

    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.sessions.delete(session.id)
      throw new PreviewExpiredError()
    }

    return session
  }

  private pruneExpiredSessions(): void {
    const now = Date.now()

    for (const session of this.sessions.values()) {
      if (Date.parse(session.expiresAt) <= now) {
        this.sessions.delete(session.id)
      }
    }
  }

  private toDto(session: InternalPreviewSession): ImportPreviewSessionDto {
    return importPreviewSessionDtoSchema.parse({
      id: session.id,
      accountId: session.accountId,
      sourceKind: session.sourceKind,
      sourceFileName: session.sourceFileName,
      inspection: inspectionToDto(session.inspection),
      transactions: session.preparedImport.transactions.map((transaction) =>
        previewTransactionToDto(transaction)
      ),
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    })
  }
}

export function assertAccountSourceCompatibility(
  account: Account,
  sourceKind: ImportSourceKind
): void {
  if (
    account.kind === 'current' &&
    (sourceKind === 'evo_account_pdf' || sourceKind === 'evo_account_excel')
  ) {
    return
  }

  if (account.kind === 'credit_card' && sourceKind === 'evo_visa_xls') {
    return
  }

  throw new UnsupportedAccountSourceError()
}
