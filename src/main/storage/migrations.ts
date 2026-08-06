import type { Database } from 'better-sqlite3'
import { MigrationVersionIncompatibilityError } from '../domain/errors'

export type Migration = {
  version: number
  name: string
  up: (database: Database) => void
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'create_financial_core_tables',
    up: (database) => {
      database.exec(`
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
          source_kind TEXT NOT NULL CHECK (source_kind IN ('evo_visa_xls', 'evo_account_pdf', 'unknown')),
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
          value_date TEXT,
          reference TEXT,
          original_description TEXT NOT NULL CHECK (length(trim(original_description)) > 0),
          normalized_merchant TEXT,
          amount_cents INTEGER NOT NULL CHECK (amount_cents != 0),
          balance_cents INTEGER,
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

        CREATE INDEX transactions_import_batch_id_idx ON transactions(import_batch_id);
        CREATE INDEX transactions_account_id_idx ON transactions(account_id);

        CREATE TABLE transaction_links (
          id TEXT PRIMARY KEY,
          from_transaction_id TEXT NOT NULL,
          to_transaction_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (
            kind IN ('card_settlement', 'own_account_transfer', 'refund', 'related')
          ),
          created_at TEXT NOT NULL,
          CHECK (from_transaction_id != to_transaction_id),
          FOREIGN KEY (from_transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
          FOREIGN KEY (to_transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX transaction_links_directional_unique_idx
          ON transaction_links(from_transaction_id, to_transaction_id, kind);

        CREATE INDEX transaction_links_from_transaction_id_idx
          ON transaction_links(from_transaction_id);

        CREATE INDEX transaction_links_to_transaction_id_idx
          ON transaction_links(to_transaction_id);
      `)
    }
  },
  {
    version: 2,
    name: 'add_card_settlement_reconciliation_indexes',
    up: (database) => {
      database.exec(`
        CREATE INDEX transaction_links_card_settlement_from_idx
          ON transaction_links(from_transaction_id)
          WHERE kind = 'card_settlement';

        CREATE INDEX transaction_links_card_settlement_to_idx
          ON transaction_links(to_transaction_id)
          WHERE kind = 'card_settlement';

        CREATE UNIQUE INDEX transaction_links_card_settlement_unique_destination_idx
          ON transaction_links(to_transaction_id)
          WHERE kind = 'card_settlement';
      `)
    }
  }
]

export const latestMigrationVersion = migrations.at(-1)?.version ?? 0

export function runMigrations(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  const currentVersion = getSchemaVersion(database)

  if (currentVersion > latestMigrationVersion) {
    throw new MigrationVersionIncompatibilityError(currentVersion, latestMigrationVersion)
  }

  for (const migration of migrations) {
    const applied = database
      .prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(migration.version)

    if (applied) {
      continue
    }

    const applyMigration = database.transaction(() => {
      migration.up(database)
      database
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString())
    })

    applyMigration()
  }
}

export function getSchemaVersion(database: Database): number {
  const table = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get()

  if (!table) {
    return 0
  }

  const row = database
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number } | undefined

  return row?.version ?? 0
}
