import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createDatabase, type SampoDatabase } from '../storage/database'
import { getSchemaVersion, latestMigrationVersion } from '../storage/migrations'
import { AccountRepository } from '../storage/accounts'
import { ImportBatchRepository } from '../storage/import-batches'
import { TransactionRepository } from '../storage/transactions'
import { TransactionLinkRepository } from '../storage/transaction-links'
import {
  CategoryRepository,
  MerchantRepository,
  TransactionClassificationRepository
} from '../storage/categorisation'
import { ImportService } from '../services/import-service'
import {
  AccountMismatchError,
  DatabaseInitializationError,
  DuplicateImportError,
  EntityNotFoundError,
  InvalidImportStatusTransitionError
} from '../domain/errors'
import { centsToDisplayAmount, eurosToCents } from '../domain/money'
import type { Account, NewTransaction, PreparedImport, Transaction } from '../domain/schemas'

const syntheticHash = 'a'.repeat(64)
const changedSyntheticHash = 'b'.repeat(64)

function tempDatabasePath(directory: string): string {
  return join(directory, 'sampo-test.sqlite3')
}

function createTestDatabase(directory: string): SampoDatabase {
  return createDatabase({ path: tempDatabasePath(directory), useWal: false })
}

function createAccount(accounts: AccountRepository): Account {
  return accounts.create({
    name: 'Synthetic current account',
    kind: 'current',
    institution: 'Synthetic institution'
  })
}

function makeTransaction(
  accountId: string,
  overrides: Partial<NewTransaction> = {}
): NewTransaction {
  return {
    accountId,
    sourceRowIndex: 0,
    transactionDate: '2026-01-15',
    originalDescription: 'Synthetic grocery purchase',
    amountCents: -1234,
    transactionType: 'expense',
    ...overrides
  }
}

function makePreparedImport(
  accountId: string,
  transactions: NewTransaction[] = [makeTransaction(accountId)],
  overrides: Partial<PreparedImport> = {}
): PreparedImport {
  return {
    accountId,
    sourceKind: 'unknown',
    sourceFileName: 'synthetic-source.txt',
    fileSha256: syntheticHash,
    transactions,
    ...overrides
  }
}

describe('financial core migrations', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-db-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('migrates a fresh database and records the schema version', () => {
    const database = createTestDatabase(directory)

    expect(database.schemaVersion).toBe(latestMigrationVersion)
    expect(getSchemaVersion(database.connection)).toBe(latestMigrationVersion)
    expect(
      database.connection
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM sqlite_master
            WHERE type = 'table'
              AND name IN ('recurring_series', 'recurring_series_transactions')
          `
        )
        .get()
    ).toMatchObject({ count: 2 })
    database.close()
  })

  it('upgrades a synthetic pre-AI database through latest migrations without partial migration state', () => {
    const path = tempDatabasePath(directory)
    const phase6 = createDatabase({ path, useWal: false })

    phase6.connection.prepare('DELETE FROM schema_migrations WHERE version = ?').run(11)
    phase6.connection.prepare('DELETE FROM schema_migrations WHERE version = ?').run(10)
    phase6.connection.prepare('DELETE FROM schema_migrations WHERE version = ?').run(9)
    phase6.connection.prepare('DELETE FROM schema_migrations WHERE version = ?').run(8)
    phase6.connection.prepare('DELETE FROM schema_migrations WHERE version = ?').run(6)
    phase6.connection.prepare('DELETE FROM schema_migrations WHERE version = ?').run(7)
    phase6.connection.prepare('DELETE FROM schema_migrations WHERE version = ?').run(5)
    phase6.connection
      .prepare('ALTER TABLE transaction_classifications DROP COLUMN merchant_source')
      .run()
    phase6.connection
      .prepare('ALTER TABLE transaction_classifications DROP COLUMN category_source')
      .run()
    phase6.connection.prepare('DROP TABLE ai_suggestion_sources').run()
    phase6.connection.prepare('DROP TABLE ai_classification_suggestions').run()
    phase6.connection.prepare('DROP TABLE ai_settings').run()
    phase6.connection.prepare('DROP TABLE recurring_series_transactions').run()
    phase6.connection.prepare('DROP TABLE recurring_series').run()
    expect(getSchemaVersion(phase6.connection)).toBe(4)
    phase6.close()

    const upgraded = createDatabase({ path, useWal: false })
    const aiSettingsCount = upgraded.connection
      .prepare('SELECT COUNT(*) AS count FROM ai_settings')
      .get() as { count: number }
    const migrationCount = upgraded.connection
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 5')
      .get() as { count: number }

    expect(upgraded.schemaVersion).toBe(latestMigrationVersion)
    expect(aiSettingsCount.count).toBe(1)
    expect(migrationCount.count).toBe(1)
    expect(
      (
        upgraded.connection
          .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 6')
          .get() as { count: number }
      ).count
    ).toBe(1)
    upgraded.close()
  })

  it('upgrades a synthetic Phase 7 database to allow account Excel imports', () => {
    const path = tempDatabasePath(directory)
    const phase7 = new Database(path)

    phase7.pragma('foreign_keys = ON')
    phase7.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        kind TEXT NOT NULL CHECK (kind IN ('current', 'credit_card', 'cash', 'other')),
        institution TEXT,
        currency TEXT NOT NULL DEFAULT 'EUR' CHECK (length(currency) = 3),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE import_batches (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK (
          source_kind IN ('evo_visa_xls', 'evo_account_pdf', 'unknown')
        ),
        source_file_name TEXT NOT NULL CHECK (length(trim(source_file_name)) > 0),
        file_sha256 TEXT NOT NULL CHECK (length(file_sha256) = 64),
        statement_period_start TEXT,
        statement_period_end TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'rolled_back', 'failed')),
        transaction_count INTEGER NOT NULL DEFAULT 0 CHECK (transaction_count >= 0),
        created_at TEXT NOT NULL,
        committed_at TEXT,
        rolled_back_at TEXT,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
      );

      CREATE UNIQUE INDEX import_batches_committed_file_hash_idx
        ON import_batches(account_id, file_sha256)
        WHERE status = 'committed';

      CREATE INDEX import_batches_account_id_idx ON import_batches(account_id);

      CREATE TABLE transactions (
        id TEXT PRIMARY KEY,
        import_batch_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        source_row_index INTEGER NOT NULL CHECK (source_row_index >= 0),
        transaction_date TEXT NOT NULL,
        original_description TEXT NOT NULL CHECK (length(trim(original_description)) > 0),
        amount_cents INTEGER NOT NULL CHECK (amount_cents != 0),
        currency TEXT NOT NULL DEFAULT 'EUR' CHECK (length(currency) = 3),
        transaction_type TEXT NOT NULL CHECK (
          transaction_type IN (
            'expense',
            'income',
            'transfer',
            'card_settlement',
            'refund',
            'fee',
            'cash_withdrawal',
            'tax',
            'unknown'
          )
        ),
        is_pending INTEGER NOT NULL DEFAULT 0 CHECK (is_pending IN (0, 1)),
        excluded_from_spending INTEGER NOT NULL DEFAULT 0 CHECK (excluded_from_spending IN (0, 1)),
        review_status TEXT NOT NULL CHECK (review_status IN ('confirmed', 'needs_review')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
      );

      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES
        (1, 'create_financial_core_tables', datetime('now')),
        (2, 'add_card_settlement_reconciliation_indexes', datetime('now')),
        (3, 'add_ui_query_indexes', datetime('now')),
        (4, 'add_categorisation_tables', datetime('now')),
        (5, 'add_ai_classification_tables', datetime('now')),
        (6, 'allow_ai_transaction_classifications', datetime('now')),
        (7, 'add_field_level_classification_sources', datetime('now'));

      INSERT INTO accounts (id, name, kind, currency, created_at, updated_at)
      VALUES (
        '22222222-2222-4222-8222-000000000010',
        'Synthetic current',
        'current',
        'EUR',
        datetime('now'),
        datetime('now')
      );

      INSERT INTO import_batches (
        id, account_id, source_kind, source_file_name, file_sha256, status,
        transaction_count, created_at, committed_at
      )
      VALUES (
        '22222222-2222-4222-8222-000000000011',
        '22222222-2222-4222-8222-000000000010',
        'evo_account_pdf',
        'synthetic.pdf',
        '${'e'.repeat(64)}',
        'committed',
        1,
        datetime('now'),
        datetime('now')
      );

      INSERT INTO transactions (
        id, import_batch_id, account_id, source_row_index, transaction_date,
        original_description, amount_cents, currency, transaction_type,
        is_pending, excluded_from_spending, review_status, created_at, updated_at
      )
      VALUES (
        '22222222-2222-4222-8222-000000000012',
        '22222222-2222-4222-8222-000000000011',
        '22222222-2222-4222-8222-000000000010',
        0,
        '2026-06-01',
        'Synthetic movement',
        -100,
        'EUR',
        'expense',
        0,
        0,
        'confirmed',
        datetime('now'),
        datetime('now')
      );
    `)
    phase7.close()

    const upgraded = createDatabase({ path, useWal: false })

    expect(upgraded.schemaVersion).toBe(latestMigrationVersion)
    expect(upgraded.connection.pragma('foreign_key_check')).toEqual([])
    expect(() =>
      upgraded.connection
        .prepare(
          `
            INSERT INTO import_batches (
              id, account_id, source_kind, source_file_name, file_sha256, status,
              transaction_count, created_at, committed_at
            )
            VALUES (
              '22222222-2222-4222-8222-000000000013',
              '22222222-2222-4222-8222-000000000010',
              'evo_account_excel',
              'synthetic.xlsx',
              @hash,
              'committed',
              0,
              datetime('now'),
              datetime('now')
            )
          `
        )
        .run({ hash: 'f'.repeat(64) })
    ).not.toThrow()
    expect(
      upgraded.connection
        .prepare('SELECT COUNT(*) AS count FROM transactions WHERE import_batch_id = ?')
        .get('22222222-2222-4222-8222-000000000011')
    ).toMatchObject({ count: 1 })
    upgraded.close()
  })

  it('repairs committed duplicate transaction fingerprints from older imports', () => {
    const path = tempDatabasePath(directory)
    const database = createDatabase({ path, useWal: false })

    database.connection.exec(`
      INSERT INTO accounts (id, name, kind, currency, created_at, updated_at)
      VALUES (
        '22222222-2222-4222-8222-000000000020',
        'Synthetic current',
        'current',
        'EUR',
        '2026-08-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z'
      );

      INSERT INTO import_batches (
        id, account_id, source_kind, source_file_name, file_sha256, status,
        transaction_count, created_at, committed_at
      )
      VALUES
        (
          '22222222-2222-4222-8222-000000000021',
          '22222222-2222-4222-8222-000000000020',
          'evo_account_pdf',
          'synthetic.pdf',
          '${'1'.repeat(64)}',
          'committed',
          1,
          '2026-08-01T00:00:00.000Z',
          '2026-08-01T00:00:00.000Z'
        ),
        (
          '22222222-2222-4222-8222-000000000022',
          '22222222-2222-4222-8222-000000000020',
          'evo_account_excel',
          'synthetic.xlsx',
          '${'2'.repeat(64)}',
          'committed',
          1,
          '2026-08-02T00:00:00.000Z',
          '2026-08-02T00:00:00.000Z'
        );

      INSERT INTO transactions (
        id, import_batch_id, account_id, source_row_index, transaction_date,
        value_date, original_description, amount_cents, currency, transaction_type,
        is_pending, excluded_from_spending, review_status, created_at, updated_at
      )
      VALUES
        (
          '22222222-2222-4222-8222-000000000023',
          '22222222-2222-4222-8222-000000000021',
          '22222222-2222-4222-8222-000000000020',
          11,
          '2026-07-20',
          '2026-07-20',
          'Synthetic   incoming transfer',
          72000,
          'EUR',
          'income',
          0,
          0,
          'confirmed',
          '2026-08-01T00:00:01.000Z',
          '2026-08-01T00:00:01.000Z'
        ),
        (
          '22222222-2222-4222-8222-000000000024',
          '22222222-2222-4222-8222-000000000022',
          '22222222-2222-4222-8222-000000000020',
          11,
          '2026-07-20',
          '2026-07-20',
          ' synthetic incoming transfer ',
          72000,
          'EUR',
          'income',
          0,
          0,
          'confirmed',
          '2026-08-02T00:00:01.000Z',
          '2026-08-02T00:00:01.000Z'
        );

      INSERT INTO transaction_classifications (
        transaction_id, classification_source, classification_status, created_at, updated_at
      )
      VALUES (
        '22222222-2222-4222-8222-000000000024',
        'manual',
        'confirmed',
        '2026-08-02T00:00:02.000Z',
        '2026-08-02T00:00:02.000Z'
      );
    `)
    database.connection.prepare('DELETE FROM schema_migrations WHERE version = ?').run(9)
    database.close()

    const upgraded = createDatabase({ path, useWal: false })

    expect(
      upgraded.connection
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM transactions
            WHERE account_id = '22222222-2222-4222-8222-000000000020'
          `
        )
        .get()
    ).toMatchObject({ count: 1 })
    expect(
      upgraded.connection
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM transactions
            WHERE id = '22222222-2222-4222-8222-000000000023'
          `
        )
        .get()
    ).toMatchObject({ count: 1 })
    expect(
      upgraded.connection
        .prepare(
          `
            SELECT id, transaction_count AS transactionCount
            FROM import_batches
            WHERE id IN (
              '22222222-2222-4222-8222-000000000021',
              '22222222-2222-4222-8222-000000000022'
            )
            ORDER BY created_at ASC
          `
        )
        .all()
    ).toEqual([
      { id: '22222222-2222-4222-8222-000000000021', transactionCount: 1 },
      { id: '22222222-2222-4222-8222-000000000022', transactionCount: 0 }
    ])
    expect(getSchemaVersion(upgraded.connection)).toBe(latestMigrationVersion)
    upgraded.close()
  })

  it('allows accepted AI transaction classifications after migrations', () => {
    const database = createTestDatabase(directory)
    const account = database.connection
      .prepare(
        `
          INSERT INTO accounts (id, name, kind, institution, currency, created_at, updated_at)
          VALUES ('22222222-2222-4222-8222-000000000001', 'Synthetic', 'current', NULL, 'EUR', datetime('now'), datetime('now'))
          RETURNING id
        `
      )
      .get() as { id: string }
    const batch = database.connection
      .prepare(
        `
          INSERT INTO import_batches (
            id, account_id, source_kind, source_file_name, file_sha256, status,
            transaction_count, created_at, committed_at
          )
          VALUES (
            '22222222-2222-4222-8222-000000000002', @accountId, 'unknown',
            'synthetic.txt', @hash, 'committed', 1, datetime('now'), datetime('now')
          )
          RETURNING id
        `
      )
      .get({ accountId: account.id, hash: 'd'.repeat(64) }) as { id: string }
    database.connection
      .prepare(
        `
          INSERT INTO transactions (
            id, import_batch_id, account_id, source_row_index, transaction_date,
            original_description, amount_cents, currency, transaction_type,
            is_pending, excluded_from_spending, review_status, created_at, updated_at
          )
          VALUES (
            '22222222-2222-4222-8222-000000000003', @batchId, @accountId, 0,
            '2026-02-01', 'Synthetic AI classification', -100, 'EUR', 'expense',
            0, 0, 'confirmed', datetime('now'), datetime('now')
          )
        `
      )
      .run({ batchId: batch.id, accountId: account.id })

    expect(() =>
      database.connection
        .prepare(
          `
            INSERT INTO transaction_classifications (
              transaction_id, classification_source, classification_status,
              created_at, updated_at
            )
            VALUES (
              '22222222-2222-4222-8222-000000000003', 'ai', 'confirmed',
              datetime('now'), datetime('now')
            )
          `
        )
        .run()
    ).not.toThrow()
    database.close()
  })

  it('does not rerun migrations when reopened', () => {
    const first = createTestDatabase(directory)
    const appliedAt = first.connection
      .prepare('SELECT applied_at FROM schema_migrations WHERE version = ?')
      .get(latestMigrationVersion) as { applied_at: string }
    first.close()

    const second = createTestDatabase(directory)
    const reappliedAt = second.connection
      .prepare('SELECT applied_at FROM schema_migrations WHERE version = ?')
      .get(latestMigrationVersion) as { applied_at: string }

    expect(reappliedAt.applied_at).toBe(appliedAt.applied_at)
    second.close()
  })

  it('fails safely for an unsupported newer schema version', () => {
    const database = createTestDatabase(directory)
    database.connection
      .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(999, 'future_schema', new Date().toISOString())
    database.close()

    expect(() => createTestDatabase(directory)).toThrow(DatabaseInitializationError)
  })

  it('enables foreign keys', () => {
    const database = createTestDatabase(directory)
    const row = database.connection.pragma('foreign_keys', { simple: true })

    expect(row).toBe(1)
    database.close()
  })

  it('includes a safe underlying cause in database initialization errors', () => {
    const path = join(directory, 'not-a-database-directory')
    mkdirSync(path)

    expect(() => createDatabase({ path, useWal: false })).toThrow(/Database initialization failed:/)
  })
})

describe('account repository', () => {
  let directory: string
  let database: SampoDatabase
  let accounts: AccountRepository

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-accounts-'))
    database = createTestDatabase(directory)
    accounts = new AccountRepository(database.connection)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates, retrieves, lists, and updates an account', () => {
    const account = createAccount(accounts)

    expect(accounts.findById(account.id)).toMatchObject({
      name: 'Synthetic current account',
      currency: 'EUR'
    })
    expect(accounts.list()).toHaveLength(1)

    const updated = accounts.updateDetails(account.id, {
      name: 'Synthetic household account'
    })

    expect(updated.name).toBe('Synthetic household account')
    expect(updated.institution).toBeUndefined()
  })

  it('prevents deleting an account that has an import batch', () => {
    const account = createAccount(accounts)
    const batches = new ImportBatchRepository(database.connection)
    batches.createPending({
      accountId: account.id,
      sourceKind: 'unknown',
      sourceFileName: 'synthetic-source.txt',
      fileSha256: syntheticHash
    })

    expect(() => accounts.deleteUnused(account.id)).toThrow(/Cannot delete/)
  })

  it('validates unsupported account kind and malformed currency', () => {
    expect(() =>
      accounts.create({
        name: 'Synthetic invalid account',
        kind: 'unsupported',
        currency: 'EUR'
      } as never)
    ).toThrow()

    expect(() =>
      accounts.create({
        name: 'Synthetic invalid currency account',
        kind: 'current',
        currency: 'EURO'
      })
    ).toThrow()
  })
})

describe('import service and transaction repository', () => {
  let directory: string
  let database: SampoDatabase
  let accounts: AccountRepository
  let service: ImportService
  let transactions: TransactionRepository
  let links: TransactionLinkRepository
  let account: Account

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-imports-'))
    database = createTestDatabase(directory)
    accounts = new AccountRepository(database.connection)
    service = new ImportService(database.connection)
    transactions = new TransactionRepository(database.connection)
    links = new TransactionLinkRepository(database.connection)
    account = createAccount(accounts)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('commits a valid prepared import atomically with the correct count', () => {
    const result = service.commitPreparedImport(
      makePreparedImport(account.id, [
        makeTransaction(account.id, { sourceRowIndex: 0, amountCents: -1500 }),
        makeTransaction(account.id, {
          sourceRowIndex: 1,
          transactionType: 'income',
          amountCents: 2500,
          originalDescription: 'Synthetic incoming transfer'
        })
      ])
    )

    expect(result.batch.status).toBe('committed')
    expect(result.batch.transactionCount).toBe(2)
    expect(result.transactions).toHaveLength(2)
    expect(transactions.countForImportBatch(result.batch.id)).toBe(2)
    expect(transactions.listForAccount(account.id)).toHaveLength(2)
  })

  it('rejects duplicate committed files for the same account and permits them after rollback', () => {
    const first = service.commitPreparedImport(makePreparedImport(account.id))

    expect(() => service.commitPreparedImport(makePreparedImport(account.id))).toThrow(
      DuplicateImportError
    )

    service.rollbackCommittedBatch(first.batch.id)
    const second = service.commitPreparedImport(makePreparedImport(account.id))

    expect(second.batch.status).toBe('committed')
  })

  it('skips overlapping transactions from different files using occurrence counts', () => {
    const first = service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, {
            sourceRowIndex: 0,
            transactionDate: '2026-06-10',
            originalDescription: 'Synthetic utility',
            amountCents: -1000
          })
        ],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: '1'.repeat(64)
        }
      )
    )
    const overlap = service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, {
            sourceRowIndex: 0,
            transactionDate: '2026-06-10',
            originalDescription: 'Synthetic utility',
            amountCents: -1000
          })
        ],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: '2'.repeat(64)
        }
      )
    )

    expect(first.transactions).toHaveLength(1)
    expect(overlap.transactions).toHaveLength(0)
    expect(overlap.skippedDuplicateTransactionCount).toBe(1)
    expect(overlap.batch.transactionCount).toBe(0)
    expect(transactions.listForAccount(account.id)).toHaveLength(1)
  })

  it('skips account Excel rows already imported from account PDF with the same stable facts', () => {
    const equivalent = {
      sourceRowIndex: 11,
      transactionDate: '2026-07-20',
      valueDate: '2026-07-20',
      originalDescription: 'Synthetic incoming transfer',
      amountCents: 72000,
      transactionType: 'income' as const
    }
    const first = service.commitPreparedImport(
      makePreparedImport(account.id, [makeTransaction(account.id, equivalent)], {
        sourceKind: 'evo_account_pdf',
        sourceFileName: 'synthetic.pdf',
        fileSha256: '5'.repeat(64)
      })
    )
    const overlap = service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, {
            ...equivalent,
            originalDescription: ' synthetic   incoming transfer '
          })
        ],
        {
          sourceKind: 'evo_account_excel',
          sourceFileName: 'synthetic.xlsx',
          fileSha256: '6'.repeat(64)
        }
      )
    )

    expect(first.transactions).toHaveLength(1)
    expect(overlap.transactions).toHaveLength(0)
    expect(overlap.skippedDuplicateTransactionCount).toBe(1)
    expect(overlap.batch.transactionCount).toBe(0)
    expect(transactions.listForAccount(account.id)).toHaveLength(1)
  })

  it('promotes an exact pending Visa row when the completed representation arrives', () => {
    const pending = service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, {
            sourceRowIndex: 0,
            transactionDate: '2026-06-10',
            originalDescription: 'Synthetic pending card merchant',
            amountCents: -1000,
            isPending: true
          })
        ],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: '8'.repeat(64)
        }
      )
    )
    const pendingTransactionId = pending.transactions[0]!.id

    const completed = service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, {
            sourceRowIndex: 0,
            transactionDate: '2026-06-10',
            originalDescription: 'Synthetic pending card merchant',
            amountCents: -1000,
            isPending: false
          })
        ],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: '9'.repeat(64)
        }
      )
    )

    expect(completed.transactions).toHaveLength(0)
    expect(completed.skippedDuplicateTransactionCount).toBe(1)
    expect(transactions.listForAccount(account.id)).toHaveLength(1)
    expect(transactions.findById(pendingTransactionId)).toMatchObject({
      id: pendingTransactionId,
      isPending: false,
      reviewStatus: 'confirmed'
    })
  })

  it('does not downgrade a completed Visa row when a matching pending representation arrives', () => {
    const completed = service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, {
            sourceRowIndex: 0,
            transactionDate: '2026-06-10',
            originalDescription: 'Synthetic completed card merchant',
            amountCents: -1000,
            isPending: false
          })
        ],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: 'e'.repeat(64)
        }
      )
    )

    const pending = service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, {
            sourceRowIndex: 0,
            transactionDate: '2026-06-10',
            originalDescription: 'Synthetic completed card merchant',
            amountCents: -1000,
            isPending: true
          })
        ],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: 'f'.repeat(64)
        }
      )
    )

    expect(pending.transactions).toHaveLength(0)
    expect(pending.skippedDuplicateTransactionCount).toBe(1)
    expect(transactions.findById(completed.transactions[0]!.id)).toMatchObject({
      isPending: false,
      reviewStatus: 'confirmed'
    })
  })

  it('ignores changed value dates and balances when detecting overlap', () => {
    const stableFacts = {
      transactionDate: '2026-06-10',
      originalDescription: 'Synthetic balance-shifted merchant',
      amountCents: -1000
    }
    service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, {
            sourceRowIndex: 0,
            ...stableFacts,
            valueDate: '2026-06-11',
            balanceCents: 10000
          })
        ],
        {
          sourceKind: 'evo_account_excel',
          fileSha256: 'a'.repeat(64)
        }
      )
    )

    const changedMetadata = service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, {
            sourceRowIndex: 0,
            ...stableFacts,
            valueDate: '2026-06-12',
            balanceCents: 9000
          })
        ],
        {
          sourceKind: 'evo_account_excel',
          fileSha256: 'b'.repeat(64)
        }
      )
    )

    expect(changedMetadata.transactions).toHaveLength(0)
    expect(changedMetadata.skippedDuplicateTransactionCount).toBe(1)
    expect(transactions.listForAccount(account.id)).toHaveLength(1)
  })

  it('does not deduplicate matching descriptions and amounts from another month', () => {
    const equivalent = {
      originalDescription: 'Synthetic monthly subscription',
      amountCents: -1000
    }
    service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, {
            sourceRowIndex: 0,
            transactionDate: '2026-06-10',
            ...equivalent
          })
        ],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: 'c'.repeat(64)
        }
      )
    )

    const nextMonth = service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, {
            sourceRowIndex: 0,
            transactionDate: '2026-07-10',
            ...equivalent
          })
        ],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: 'd'.repeat(64)
        }
      )
    )

    expect(nextMonth.transactions).toHaveLength(1)
    expect(nextMonth.skippedDuplicateTransactionCount).toBe(0)
    expect(transactions.listForAccount(account.id)).toHaveLength(2)
  })

  it('imports only the non-overlapping excess occurrence from a partial overlap', () => {
    const equivalent = {
      transactionDate: '2026-06-10',
      originalDescription: 'Synthetic repeated merchant',
      amountCents: -1000
    }
    service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, { sourceRowIndex: 0, ...equivalent }),
          makeTransaction(account.id, { sourceRowIndex: 1, ...equivalent })
        ],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: '3'.repeat(64)
        }
      )
    )
    const overlap = service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, { sourceRowIndex: 0, ...equivalent }),
          makeTransaction(account.id, { sourceRowIndex: 1, ...equivalent }),
          makeTransaction(account.id, { sourceRowIndex: 2, ...equivalent })
        ],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: '4'.repeat(64)
        }
      )
    )

    expect(overlap.transactions).toHaveLength(1)
    expect(overlap.skippedDuplicateTransactionCount).toBe(2)
    expect(overlap.batch.transactionCount).toBe(1)
    expect(transactions.listForAccount(account.id)).toHaveLength(3)
  })

  it('imports one excess occurrence when one existing row overlaps two incoming rows', () => {
    const equivalent = {
      transactionDate: '2026-06-13',
      originalDescription: 'HSL MOBIILI',
      amountCents: -330
    }
    service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [makeTransaction(account.id, { sourceRowIndex: 10, ...equivalent })],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: '7'.repeat(64)
        }
      )
    )
    const overlap = service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, { sourceRowIndex: 10, ...equivalent }),
          makeTransaction(account.id, { sourceRowIndex: 11, ...equivalent })
        ],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: '8'.repeat(64)
        }
      )
    )

    expect(overlap.transactions).toHaveLength(1)
    expect(overlap.skippedDuplicateTransactionCount).toBe(1)
    expect(transactions.listForAccount(account.id)).toHaveLength(2)
  })

  it('preserves genuine identical Visa rows within one fresh import', () => {
    const equivalent = {
      transactionDate: '2026-06-13',
      originalDescription: 'HSL MOBIILI',
      amountCents: -330
    }
    const result = service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [
          makeTransaction(account.id, { sourceRowIndex: 13, ...equivalent }),
          makeTransaction(account.id, { sourceRowIndex: 14, ...equivalent })
        ],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: '5'.repeat(64)
        }
      )
    )

    expect(result.transactions).toHaveLength(2)
    expect(result.skippedDuplicateTransactionCount).toBe(0)
    expect(result.transactions.map((transaction) => transaction.sourceRowIndex)).toEqual([13, 14])
    expect(result.transactions.reduce((sum, transaction) => sum + transaction.amountCents, 0)).toBe(
      -660
    )
    expect(transactions.listForAccount(account.id)).toHaveLength(2)
  })

  it('preserves real-shape duplicate July Visa purchases and skips them on overlapping reimport', () => {
    const equivalent = {
      transactionDate: '2026-07-04',
      originalDescription: 'KAMIãOKO JATETXEA',
      amountCents: -560
    }
    const firstPrepared = makePreparedImport(
      account.id,
      [
        makeTransaction(account.id, { sourceRowIndex: 32, ...equivalent }),
        makeTransaction(account.id, { sourceRowIndex: 33, ...equivalent })
      ],
      {
        sourceKind: 'evo_visa_xls',
        fileSha256: 'a'.repeat(64)
      }
    )
    const firstPreview = service.previewPreparedImportDeduplication(firstPrepared)
    const first = service.commitPreparedImport(firstPrepared)
    const secondPreview = service.previewPreparedImportDeduplication({
      ...firstPrepared,
      fileSha256: 'b'.repeat(64)
    })
    const second = service.commitPreparedImport({
      ...firstPrepared,
      fileSha256: 'b'.repeat(64)
    })

    expect(firstPreview).toMatchObject({
      newTransactionCount: 2,
      duplicateTransactionCount: 0
    })
    expect(first.transactions).toHaveLength(2)
    expect(first.transactions.reduce((sum, transaction) => sum + transaction.amountCents, 0)).toBe(
      -1120
    )
    expect(secondPreview).toMatchObject({
      newTransactionCount: 0,
      duplicateTransactionCount: 2
    })
    expect(second.transactions).toHaveLength(0)
    expect(second.skippedDuplicateTransactionCount).toBe(2)
    expect(transactions.listForAccount(account.id)).toHaveLength(2)
  })

  it('does not deduplicate equivalent rows on another account', () => {
    const otherAccount = accounts.create({ name: 'Synthetic other card', kind: 'credit_card' })
    const equivalent = {
      transactionDate: '2026-06-10',
      originalDescription: 'Synthetic account-scoped merchant',
      amountCents: -1000
    }

    service.commitPreparedImport(
      makePreparedImport(
        account.id,
        [makeTransaction(account.id, { sourceRowIndex: 0, ...equivalent })],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: '6'.repeat(64)
        }
      )
    )
    const other = service.commitPreparedImport(
      makePreparedImport(
        otherAccount.id,
        [makeTransaction(otherAccount.id, { sourceRowIndex: 0, ...equivalent })],
        {
          sourceKind: 'evo_visa_xls',
          fileSha256: '7'.repeat(64)
        }
      )
    )

    expect(other.transactions).toHaveLength(1)
    expect(transactions.listForAccount(account.id)).toHaveLength(1)
    expect(transactions.listForAccount(otherAccount.id)).toHaveLength(1)
  })

  it('rejects an account mismatch without leaving partial rows', () => {
    const otherAccount = accounts.create({
      name: 'Synthetic other account',
      kind: 'current'
    })

    expect(() =>
      service.commitPreparedImport(
        makePreparedImport(account.id, [makeTransaction(otherAccount.id)])
      )
    ).toThrow(AccountMismatchError)

    expect(transactions.listForAccount(account.id)).toHaveLength(0)
    expect(transactions.listForAccount(otherAccount.id)).toHaveLength(0)
  })

  it('rejects malformed transaction data without partial inserts', () => {
    expect(() =>
      service.commitPreparedImport(
        makePreparedImport(account.id, [
          makeTransaction(account.id, { sourceRowIndex: 0 }),
          makeTransaction(account.id, {
            sourceRowIndex: 1,
            originalDescription: ' ',
            amountCents: -200
          })
        ])
      )
    ).toThrow()

    expect(transactions.listForAccount(account.id)).toHaveLength(0)
  })

  it('rejects invalid status transitions', () => {
    const batches = new ImportBatchRepository(database.connection)
    const batch = batches.createPending({
      accountId: account.id,
      sourceKind: 'unknown',
      sourceFileName: 'synthetic-source.txt',
      fileSha256: changedSyntheticHash
    })

    expect(() => batches.markRolledBack(batch.id)).toThrow(InvalidImportStatusTransitionError)

    const failed = service.markPendingBatchFailed(batch.id)
    expect(failed.status).toBe('failed')
    expect(() => batches.markCommitted(failed.id, 0)).toThrow(InvalidImportStatusTransitionError)
  })

  it('supports transaction signs, pending defaults, optional fields, and validation rules', () => {
    const result = service.commitPreparedImport(
      makePreparedImport(account.id, [
        makeTransaction(account.id, {
          sourceRowIndex: 0,
          transactionType: 'income',
          amountCents: 1000,
          balanceCents: 2000,
          valueDate: '2026-01-16',
          originalDescription: 'Synthetic incoming amount'
        }),
        makeTransaction(account.id, {
          sourceRowIndex: 1,
          amountCents: -500,
          isPending: true,
          originalDescription: 'Synthetic pending card movement'
        })
      ])
    )

    const incoming = result.transactions[0] as Transaction
    const pending = result.transactions[1] as Transaction

    expect(incoming.amountCents).toBe(1000)
    expect(incoming.balanceCents).toBe(2000)
    expect(incoming.valueDate).toBe('2026-01-16')
    expect(pending.amountCents).toBe(-500)
    expect(pending.reviewStatus).toBe('needs_review')

    expect(() =>
      service.commitPreparedImport(
        makePreparedImport(account.id, [makeTransaction(account.id, { amountCents: 0 })])
      )
    ).toThrow()

    expect(() =>
      service.commitPreparedImport(
        makePreparedImport(account.id, [makeTransaction(account.id, { sourceRowIndex: -1 })])
      )
    ).toThrow()
  })

  it('rolls back committed imports, removes transactions and links, and rejects repeated rollback', () => {
    const result = service.commitPreparedImport(
      makePreparedImport(account.id, [
        makeTransaction(account.id, { sourceRowIndex: 0 }),
        makeTransaction(account.id, {
          sourceRowIndex: 1,
          amountCents: 550,
          transactionType: 'refund'
        })
      ])
    )
    const link = links.create({
      fromTransactionId: result.transactions[0].id,
      toTransactionId: result.transactions[1].id,
      kind: 'refund'
    })

    expect(links.findById(link.id).kind).toBe('refund')

    const rolledBack = service.rollbackCommittedBatch(result.batch.id)

    expect(rolledBack.status).toBe('rolled_back')
    expect(rolledBack.transactionCount).toBe(0)
    expect(transactions.listForImportBatch(result.batch.id)).toHaveLength(0)
    expect(() => links.findById(link.id)).toThrow(EntityNotFoundError)
    expect(new ImportBatchRepository(database.connection).findById(result.batch.id).status).toBe(
      'rolled_back'
    )
    expect(() => service.rollbackCommittedBatch(result.batch.id)).toThrow(
      InvalidImportStatusTransitionError
    )
  })

  it('lists transactions with focused filters, sorting, pagination, and enforced limits', () => {
    const otherAccount = accounts.create({ name: 'Synthetic savings', kind: 'current' })
    const firstImport = service.commitPreparedImport(
      makePreparedImport(account.id, [
        makeTransaction(account.id, {
          sourceRowIndex: 0,
          transactionDate: '2026-01-10',
          amountCents: -3000,
          originalDescription: 'Synthetic market fuencarral'
        }),
        makeTransaction(account.id, {
          sourceRowIndex: 1,
          transactionDate: '2026-01-12',
          amountCents: 500,
          transactionType: 'refund',
          isPending: true,
          originalDescription: 'Synthetic EXPJUAN refund'
        }),
        makeTransaction(account.id, {
          sourceRowIndex: 2,
          transactionDate: '2026-02-01',
          amountCents: -900,
          excludedFromSpending: true,
          originalDescription: 'Synthetic unresolved movement'
        })
      ])
    )
    service.commitPreparedImport(
      makePreparedImport(otherAccount.id, [
        makeTransaction(otherAccount.id, {
          sourceRowIndex: 0,
          transactionDate: '2026-02-02',
          amountCents: 2000,
          transactionType: 'income',
          originalDescription: 'Synthetic income'
        })
      ])
    )
    const categories = new CategoryRepository(database.connection)
    const merchants = new MerchantRepository(database.connection)
    const classifications = new TransactionClassificationRepository(database.connection)
    const utilities = categories.create({ name: 'Utilities', sortOrder: 1 })
    const market = merchants.create({ name: 'Synthetic Market' })
    const utilityMerchant = merchants.create({ name: 'Iberdrola Synthetic' })

    classifications.save({
      transactionId: firstImport.transactions[0].id,
      merchantId: market.id,
      categoryId: utilities.id,
      usageType: 'personal',
      costBehaviour: 'variable',
      necessity: 'essential',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    classifications.save({
      transactionId: firstImport.transactions[1].id,
      merchantId: utilityMerchant.id,
      usageType: 'personal',
      costBehaviour: 'variable',
      necessity: 'essential',
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })

    const accountPage = transactions.listPage({
      accountId: account.id,
      sortBy: 'transactionDate',
      sortDirection: 'desc',
      limit: 2,
      offset: 0
    })
    expect(accountPage.total).toBe(3)
    expect(accountPage.items).toHaveLength(2)
    expect(accountPage.items[0]?.transactionDate).toBe('2026-02-01')
    expect(
      transactions
        .listPage({
          dateFrom: '2026-02-01',
          dateTo: '2026-02-28',
          sortBy: 'amount',
          sortDirection: 'asc',
          limit: 50,
          offset: 0
        })
        .items.map((transaction) => transaction.amountCents)
    ).toEqual([-900, 2000])
    expect(
      transactions.listPage({
        transactionType: 'refund',
        pending: true,
        sortBy: 'transactionDate',
        sortDirection: 'desc',
        limit: 50,
        offset: 0
      }).items
    ).toHaveLength(1)
    expect(
      transactions.listPage({
        excludedFromSpending: true,
        sortBy: 'transactionDate',
        sortDirection: 'desc',
        limit: 50,
        offset: 0
      }).items
    ).toHaveLength(1)
    expect(
      transactions
        .listPage({
          search: 'FUENCARRAL',
          confirmationFilter: 'all',
          sortBy: 'transactionDate',
          sortDirection: 'desc',
          limit: 50,
          offset: 0
        })
        .items.map((transaction) => transaction.originalDescription)
    ).toEqual(['Synthetic market fuencarral'])
    expect(
      transactions
        .listPage({
          search: 'iberdrola',
          confirmationFilter: 'all',
          sortBy: 'transactionDate',
          sortDirection: 'desc',
          limit: 50,
          offset: 0
        })
        .items.map((transaction) => transaction.id)
    ).toEqual([firstImport.transactions[1].id])
    expect(
      transactions.listPage({
        search: 'expjuan',
        confirmationFilter: 'needs_confirmation',
        sortBy: 'transactionDate',
        sortDirection: 'desc',
        limit: 50,
        offset: 0
      }).items
    ).toHaveLength(1)
    expect(
      transactions.listPage({
        confirmationFilter: 'confirmed',
        categoryId: utilities.id,
        sortBy: 'transactionDate',
        sortDirection: 'desc',
        limit: 50,
        offset: 0
      }).items
    ).toHaveLength(1)
    expect(
      transactions.listPage({
        confirmationFilter: 'needs_confirmation',
        sortBy: 'transactionDate',
        sortDirection: 'desc',
        limit: 50,
        offset: 0
      }).total
    ).toBe(3)
  })

  it('filters transactions by text search and authoritative confirmation state', () => {
    const imported = service.commitPreparedImport(
      makePreparedImport(account.id, [
        makeTransaction(account.id, {
          sourceRowIndex: 0,
          transactionDate: '2026-03-01',
          originalDescription: 'IBERDROLA synthetic bill',
          amountCents: -4100
        }),
        makeTransaction(account.id, {
          sourceRowIndex: 1,
          transactionDate: '2026-03-02',
          originalDescription: 'Synthetic power charge',
          amountCents: -4200
        }),
        makeTransaction(account.id, {
          sourceRowIndex: 2,
          transactionDate: '2026-03-03',
          originalDescription: 'Synthetic fully confirmed',
          amountCents: -4300
        }),
        makeTransaction(account.id, {
          sourceRowIndex: 3,
          transactionDate: '2026-03-04',
          originalDescription: 'Synthetic detected proposal',
          amountCents: -4400
        }),
        makeTransaction(account.id, {
          sourceRowIndex: 4,
          transactionDate: '2026-03-05',
          originalDescription: 'Synthetic partial classification',
          amountCents: -4500
        }),
        makeTransaction(account.id, {
          sourceRowIndex: 5,
          transactionDate: '2026-03-06',
          originalDescription: 'Synthetic unrelated transaction',
          amountCents: -4600
        })
      ])
    )
    const categories = new CategoryRepository(database.connection)
    const merchants = new MerchantRepository(database.connection)
    const classifications = new TransactionClassificationRepository(database.connection)
    const utilities = categories.create({ name: 'Synthetic Utilities' })
    const iberdrola = merchants.create({ name: 'Iberdrola Synthetic' })
    const confirmedMerchant = merchants.create({ name: 'Synthetic Confirmed Merchant' })
    const detectedMerchant = merchants.create({ name: 'Synthetic Detected Merchant' })
    const partialMerchant = merchants.create({ name: 'Synthetic Partial Merchant' })

    classifications.save({
      transactionId: imported.transactions[1].id,
      merchantId: iberdrola.id,
      categoryId: utilities.id,
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    classifications.save({
      transactionId: imported.transactions[2].id,
      merchantId: confirmedMerchant.id,
      categoryId: utilities.id,
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })
    classifications.save({
      transactionId: imported.transactions[3].id,
      merchantId: detectedMerchant.id,
      categoryId: utilities.id,
      classificationSource: 'rule',
      classificationStatus: 'needs_review'
    })
    classifications.save({
      transactionId: imported.transactions[4].id,
      merchantId: partialMerchant.id,
      classificationSource: 'manual',
      classificationStatus: 'confirmed'
    })

    expect(
      transactions
        .listPage({
          search: 'iberdrola',
          confirmationFilter: 'all',
          sortBy: 'transactionDate',
          sortDirection: 'asc',
          limit: 50,
          offset: 0
        })
        .items.map((transaction) => transaction.id)
    ).toEqual([imported.transactions[0].id, imported.transactions[1].id])
    expect(
      transactions
        .listPage({
          search: 'IBERDROLA',
          confirmationFilter: 'all',
          sortBy: 'transactionDate',
          sortDirection: 'asc',
          limit: 50,
          offset: 0
        })
        .items.map((transaction) => transaction.id)
    ).toEqual([imported.transactions[0].id, imported.transactions[1].id])
    expect(
      transactions.listPage({
        search: 'does-not-match',
        confirmationFilter: 'all',
        sortBy: 'transactionDate',
        sortDirection: 'asc',
        limit: 50,
        offset: 0
      }).items
    ).toHaveLength(0)

    expect(
      transactions
        .listPage({
          confirmationFilter: 'confirmed',
          sortBy: 'transactionDate',
          sortDirection: 'asc',
          limit: 50,
          offset: 0
        })
        .items.map((transaction) => transaction.id)
    ).toEqual([imported.transactions[1].id, imported.transactions[2].id])
    expect(
      transactions
        .listPage({
          confirmationFilter: 'needs_confirmation',
          sortBy: 'transactionDate',
          sortDirection: 'asc',
          limit: 50,
          offset: 0
        })
        .items.map((transaction) => transaction.id)
    ).toEqual([
      imported.transactions[0].id,
      imported.transactions[3].id,
      imported.transactions[4].id,
      imported.transactions[5].id
    ])
    expect(
      transactions.listPage({
        confirmationFilter: 'all',
        sortBy: 'transactionDate',
        sortDirection: 'asc',
        limit: 50,
        offset: 0
      }).total
    ).toBe(6)

    const filteredPage = transactions.listPage({
      search: 'synthetic',
      confirmationFilter: 'needs_confirmation',
      sortBy: 'transactionDate',
      sortDirection: 'asc',
      limit: 2,
      offset: 1
    })
    expect(filteredPage.total).toBe(4)
    expect(filteredPage.items.map((transaction) => transaction.id)).toEqual([
      imported.transactions[3].id,
      imported.transactions[4].id
    ])
  })

  it('creates, retrieves, lists, deletes, and validates transaction links', () => {
    const result = service.commitPreparedImport(
      makePreparedImport(account.id, [
        makeTransaction(account.id, { sourceRowIndex: 0 }),
        makeTransaction(account.id, {
          sourceRowIndex: 1,
          amountCents: 900,
          transactionType: 'refund'
        })
      ])
    )
    const [from, to] = result.transactions
    const link = links.create({
      fromTransactionId: from.id,
      toTransactionId: to.id,
      kind: 'related'
    })

    expect(links.findById(link.id)).toMatchObject({
      fromTransactionId: from.id,
      toTransactionId: to.id,
      kind: 'related'
    })
    expect(links.listForTransaction(from.id)).toHaveLength(1)
    expect(() =>
      links.create({
        fromTransactionId: from.id,
        toTransactionId: from.id,
        kind: 'related'
      })
    ).toThrow()
    expect(() =>
      links.create({
        fromTransactionId: from.id,
        toTransactionId: to.id,
        kind: 'related'
      })
    ).toThrow()

    links.delete(link.id)
    expect(links.listForTransaction(from.id)).toHaveLength(0)
  })
})

describe('money helpers', () => {
  it('converts plain display amounts without floating-point totals', () => {
    expect(eurosToCents('12.34')).toBe(1234)
    expect(eurosToCents('-12.3')).toBe(-1230)
    expect(centsToDisplayAmount(-1234)).toBe('-12.34')
    expect(() => eurosToCents('1,234.56')).toThrow()
  })
})
