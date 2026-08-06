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
  },
  {
    version: 3,
    name: 'add_ui_query_indexes',
    up: (database) => {
      database.exec(`
        CREATE INDEX transactions_date_created_idx
          ON transactions(transaction_date, created_at);

        CREATE INDEX transactions_type_pending_exclusion_idx
          ON transactions(transaction_type, is_pending, excluded_from_spending);
      `)
    }
  },
  {
    version: 4,
    name: 'add_categorisation_tables',
    up: (database) => {
      database.exec(`
        CREATE TABLE categories (
          id TEXT PRIMARY KEY,
          key TEXT UNIQUE,
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          parent_id TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (parent_id IS NULL OR parent_id != id),
          FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE RESTRICT
        );

        CREATE UNIQUE INDEX categories_sibling_name_idx
          ON categories(COALESCE(parent_id, ''), lower(name));

        CREATE INDEX categories_parent_sort_idx
          ON categories(parent_id, sort_order, lower(name));

        CREATE TABLE merchants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX merchants_name_normalised_idx
          ON merchants(lower(trim(name)));

        CREATE TABLE merchant_aliases (
          id TEXT PRIMARY KEY,
          merchant_id TEXT NOT NULL,
          match_kind TEXT NOT NULL CHECK (match_kind IN ('exact', 'starts_with', 'contains')),
          pattern TEXT NOT NULL CHECK (length(trim(pattern)) > 0),
          normalised_pattern TEXT NOT NULL CHECK (length(trim(normalised_pattern)) > 0),
          priority INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT
        );

        CREATE INDEX merchant_aliases_active_match_idx
          ON merchant_aliases(is_active, match_kind, priority, normalised_pattern);

        CREATE UNIQUE INDEX merchant_aliases_unique_active_pattern_idx
          ON merchant_aliases(match_kind, normalised_pattern, merchant_id)
          WHERE is_active = 1;

        CREATE TABLE categorisation_rules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          merchant_id TEXT,
          description_match_kind TEXT CHECK (
            description_match_kind IN ('exact', 'starts_with', 'contains')
          ),
          description_pattern TEXT,
          normalised_description_pattern TEXT,
          category_id TEXT,
          usage_type TEXT NOT NULL DEFAULT 'unspecified' CHECK (
            usage_type IN ('personal', 'business', 'mixed', 'unspecified')
          ),
          cost_behaviour TEXT NOT NULL DEFAULT 'unspecified' CHECK (
            cost_behaviour IN ('fixed', 'variable', 'unspecified')
          ),
          necessity TEXT NOT NULL DEFAULT 'unspecified' CHECK (
            necessity IN ('essential', 'discretionary', 'unspecified')
          ),
          priority INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            merchant_id IS NOT NULL
            OR (
              description_match_kind IS NOT NULL
              AND length(trim(description_pattern)) > 0
              AND length(trim(normalised_description_pattern)) > 0
            )
          ),
          CHECK (
            category_id IS NOT NULL
            OR usage_type != 'unspecified'
            OR cost_behaviour != 'unspecified'
            OR necessity != 'unspecified'
            OR merchant_id IS NOT NULL
          ),
          FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
        );

        CREATE INDEX categorisation_rules_active_priority_idx
          ON categorisation_rules(is_active, priority, merchant_id, description_match_kind);

        CREATE TABLE transaction_classifications (
          transaction_id TEXT PRIMARY KEY,
          merchant_id TEXT,
          category_id TEXT,
          usage_type TEXT NOT NULL DEFAULT 'unspecified' CHECK (
            usage_type IN ('personal', 'business', 'mixed', 'unspecified')
          ),
          cost_behaviour TEXT NOT NULL DEFAULT 'unspecified' CHECK (
            cost_behaviour IN ('fixed', 'variable', 'unspecified')
          ),
          necessity TEXT NOT NULL DEFAULT 'unspecified' CHECK (
            necessity IN ('essential', 'discretionary', 'unspecified')
          ),
          classification_source TEXT NOT NULL CHECK (
            classification_source IN ('manual', 'rule', 'unclassified')
          ),
          classification_status TEXT NOT NULL CHECK (
            classification_status IN ('confirmed', 'needs_review', 'ambiguous')
          ),
          applied_rule_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
          FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
          FOREIGN KEY (applied_rule_id) REFERENCES categorisation_rules(id) ON DELETE SET NULL
        );

        CREATE INDEX transaction_classifications_category_idx
          ON transaction_classifications(category_id);

        CREATE INDEX transaction_classifications_merchant_idx
          ON transaction_classifications(merchant_id);

        CREATE INDEX transaction_classifications_status_idx
          ON transaction_classifications(classification_status, classification_source);
      `)

      seedCategories(database)
    }
  }
]

function seedCategories(database: Database): void {
  const now = new Date().toISOString()
  const insert = database.prepare(`
    INSERT OR IGNORE INTO categories (
      id, key, name, parent_id, sort_order, is_system, is_active, created_at, updated_at
    )
    VALUES (@id, @key, @name, @parentId, @sortOrder, 1, 1, @now, @now)
  `)
  const categories = [
    ['11111111-1111-4111-8111-000000000001', 'housing', 'Housing', null, 10],
    [
      '11111111-1111-4111-8111-000000000002',
      'housing.rent',
      'Rent',
      '11111111-1111-4111-8111-000000000001',
      10
    ],
    [
      '11111111-1111-4111-8111-000000000003',
      'housing.utilities',
      'Utilities',
      '11111111-1111-4111-8111-000000000001',
      20
    ],
    [
      '11111111-1111-4111-8111-000000000004',
      'housing.internet_phone',
      'Internet and phone',
      '11111111-1111-4111-8111-000000000001',
      30
    ],
    ['11111111-1111-4111-8111-000000000005', 'food', 'Food', null, 20],
    [
      '11111111-1111-4111-8111-000000000006',
      'food.groceries',
      'Groceries',
      '11111111-1111-4111-8111-000000000005',
      10
    ],
    [
      '11111111-1111-4111-8111-000000000007',
      'food.restaurants',
      'Restaurants and cafés',
      '11111111-1111-4111-8111-000000000005',
      20
    ],
    ['11111111-1111-4111-8111-000000000008', 'transport', 'Transport', null, 30],
    [
      '11111111-1111-4111-8111-000000000009',
      'transport.public',
      'Public transport',
      '11111111-1111-4111-8111-000000000008',
      10
    ],
    [
      '11111111-1111-4111-8111-000000000010',
      'transport.fuel',
      'Fuel',
      '11111111-1111-4111-8111-000000000008',
      20
    ],
    [
      '11111111-1111-4111-8111-000000000011',
      'transport.taxis',
      'Taxis',
      '11111111-1111-4111-8111-000000000008',
      30
    ],
    [
      '11111111-1111-4111-8111-000000000012',
      'transport.flights',
      'Flights',
      '11111111-1111-4111-8111-000000000008',
      40
    ],
    ['11111111-1111-4111-8111-000000000013', 'health_fitness', 'Health and fitness', null, 40],
    ['11111111-1111-4111-8111-000000000014', 'shopping', 'Shopping', null, 50],
    ['11111111-1111-4111-8111-000000000015', 'entertainment', 'Entertainment', null, 60],
    [
      '11111111-1111-4111-8111-000000000016',
      'software_online',
      'Software and online services',
      null,
      70
    ],
    ['11111111-1111-4111-8111-000000000017', 'travel', 'Travel', null, 80],
    ['11111111-1111-4111-8111-000000000018', 'taxes_government', 'Taxes and government', null, 90],
    ['11111111-1111-4111-8111-000000000019', 'bank_fees', 'Bank fees', null, 100],
    ['11111111-1111-4111-8111-000000000020', 'cash_withdrawals', 'Cash withdrawals', null, 110],
    ['11111111-1111-4111-8111-000000000021', 'income', 'Income', null, 120],
    ['11111111-1111-4111-8111-000000000022', 'other', 'Other', null, 130]
  ] as const

  for (const [id, key, name, parentId, sortOrder] of categories) {
    insert.run({ id, key, name, parentId, sortOrder, now })
  }
}

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
