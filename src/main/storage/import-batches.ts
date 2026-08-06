import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { EntityNotFoundError, InvalidImportStatusTransitionError } from '../domain/errors'
import {
  importBatchSchema,
  newImportBatchSchema,
  type ImportBatch,
  type ImportStatus,
  type NewImportBatch
} from '../domain/schemas'
import { mapImportBatch } from './row-mappers'

const allowedTransitions: Record<ImportStatus, ImportStatus[]> = {
  pending: ['committed', 'failed'],
  committed: ['rolled_back'],
  rolled_back: [],
  failed: []
}

export class ImportBatchRepository {
  constructor(private readonly database: Database) {}

  createPending(input: NewImportBatch): ImportBatch {
    const batch = newImportBatchSchema.parse(input)
    const now = new Date().toISOString()
    const id = randomUUID()

    this.database
      .prepare(
        `
          INSERT INTO import_batches (
            id,
            account_id,
            source_kind,
            source_file_name,
            file_sha256,
            statement_period_start,
            statement_period_end,
            status,
            transaction_count,
            created_at
          )
          VALUES (
            @id,
            @accountId,
            @sourceKind,
            @sourceFileName,
            @fileSha256,
            @statementPeriodStart,
            @statementPeriodEnd,
            'pending',
            0,
            @createdAt
          )
        `
      )
      .run({
        id,
        accountId: batch.accountId,
        sourceKind: batch.sourceKind,
        sourceFileName: batch.sourceFileName,
        fileSha256: batch.fileSha256,
        statementPeriodStart: batch.statementPeriodStart ?? null,
        statementPeriodEnd: batch.statementPeriodEnd ?? null,
        createdAt: now
      })

    return this.findById(id)
  }

  findById(id: string): ImportBatch {
    const row = this.database.prepare('SELECT * FROM import_batches WHERE id = ?').get(id)

    if (!row) {
      throw new EntityNotFoundError('ImportBatch', id)
    }

    return importBatchSchema.parse(mapImportBatch(row as never))
  }

  list(): ImportBatch[] {
    return this.database
      .prepare('SELECT * FROM import_batches ORDER BY created_at ASC')
      .all()
      .map((row) => importBatchSchema.parse(mapImportBatch(row as never)))
  }

  countCommitted(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM import_batches WHERE status = 'committed'")
      .get() as { count: number }

    return row.count
  }

  listCommittedBySourceKind(sourceKind: ImportBatch['sourceKind']): ImportBatch[] {
    return this.database
      .prepare(
        `
          SELECT * FROM import_batches
          WHERE source_kind = ? AND status = 'committed'
          ORDER BY committed_at ASC, created_at ASC
        `
      )
      .all(sourceKind)
      .map((row) => importBatchSchema.parse(mapImportBatch(row as never)))
  }

  findCommittedDuplicate(accountId: string, fileSha256: string): ImportBatch | undefined {
    const row = this.database
      .prepare(
        `
          SELECT * FROM import_batches
          WHERE account_id = ? AND file_sha256 = ? AND status = 'committed'
        `
      )
      .get(accountId, fileSha256)

    return row ? importBatchSchema.parse(mapImportBatch(row as never)) : undefined
  }

  markCommitted(id: string, transactionCount: number): ImportBatch {
    const batch = this.findById(id)
    assertTransition(batch.status, 'committed')

    this.database
      .prepare(
        `
          UPDATE import_batches
          SET status = 'committed', transaction_count = ?, committed_at = ?
          WHERE id = ?
        `
      )
      .run(transactionCount, new Date().toISOString(), id)

    return this.findById(id)
  }

  markFailed(id: string): ImportBatch {
    const batch = this.findById(id)
    assertTransition(batch.status, 'failed')

    this.database.prepare("UPDATE import_batches SET status = 'failed' WHERE id = ?").run(id)

    return this.findById(id)
  }

  markRolledBack(id: string): ImportBatch {
    const batch = this.findById(id)
    assertTransition(batch.status, 'rolled_back')

    this.database
      .prepare(
        `
          UPDATE import_batches
          SET status = 'rolled_back', transaction_count = 0, rolled_back_at = ?
          WHERE id = ?
        `
      )
      .run(new Date().toISOString(), id)

    return this.findById(id)
  }
}

export function assertTransition(from: ImportStatus, to: ImportStatus): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidImportStatusTransitionError(from, to)
  }
}
