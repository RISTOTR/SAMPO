import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createDatabase, type SampoDatabase } from '../storage/database'
import { getSchemaVersion, latestMigrationVersion } from '../storage/migrations'
import { AccountRepository } from '../storage/accounts'
import { ImportBatchRepository } from '../storage/import-batches'
import { TransactionRepository } from '../storage/transactions'
import { TransactionLinkRepository } from '../storage/transaction-links'
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
  transactions: NewTransaction[] = [makeTransaction(accountId)]
): PreparedImport {
  return {
    accountId,
    sourceKind: 'unknown',
    sourceFileName: 'synthetic-source.txt',
    fileSha256: syntheticHash,
    transactions
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
    service.commitPreparedImport(
      makePreparedImport(account.id, [
        makeTransaction(account.id, {
          sourceRowIndex: 0,
          transactionDate: '2026-01-10',
          amountCents: -3000,
          originalDescription: 'Synthetic groceries'
        }),
        makeTransaction(account.id, {
          sourceRowIndex: 1,
          transactionDate: '2026-01-12',
          amountCents: 500,
          transactionType: 'refund',
          isPending: true,
          originalDescription: 'Synthetic refund'
        }),
        makeTransaction(account.id, {
          sourceRowIndex: 2,
          transactionDate: '2026-02-01',
          amountCents: -900,
          excludedFromSpending: true,
          originalDescription: 'Synthetic excluded movement'
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
