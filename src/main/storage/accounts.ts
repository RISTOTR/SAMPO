import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { EntityNotFoundError } from '../domain/errors'
import { accountSchema, newAccountSchema, type Account, type NewAccount } from '../domain/schemas'
import { mapAccount } from './row-mappers'

export class AccountRepository {
  constructor(private readonly database: Database) {}

  create(input: NewAccount): Account {
    const account = newAccountSchema.parse(input)
    const now = new Date().toISOString()
    const id = randomUUID()

    this.database
      .prepare(
        `
          INSERT INTO accounts (id, name, kind, institution, currency, created_at, updated_at)
          VALUES (@id, @name, @kind, @institution, @currency, @createdAt, @updatedAt)
        `
      )
      .run({
        id,
        name: account.name,
        kind: account.kind,
        institution: account.institution ?? null,
        currency: account.currency,
        createdAt: now,
        updatedAt: now
      })

    return this.findById(id)
  }

  findById(id: string): Account {
    const row = this.database.prepare('SELECT * FROM accounts WHERE id = ?').get(id)

    if (!row) {
      throw new EntityNotFoundError('Account', id)
    }

    return accountSchema.parse(mapAccount(row as never))
  }

  list(): Account[] {
    return this.database
      .prepare('SELECT * FROM accounts ORDER BY created_at ASC')
      .all()
      .map((row) => accountSchema.parse(mapAccount(row as never)))
  }

  updateDetails(
    id: string,
    input: {
      name: string
      institution?: string
    }
  ): Account {
    const existing = this.findById(id)
    const updated = newAccountSchema
      .pick({ name: true, institution: true })
      .parse({ name: input.name, institution: input.institution })

    this.database
      .prepare(
        `
          UPDATE accounts
          SET name = @name, institution = @institution, updated_at = @updatedAt
          WHERE id = @id
        `
      )
      .run({
        id: existing.id,
        name: updated.name,
        institution: updated.institution ?? null,
        updatedAt: new Date().toISOString()
      })

    return this.findById(id)
  }

  deleteUnused(id: string): void {
    this.findById(id)

    const references = this.database
      .prepare(
        `
          SELECT
            (SELECT COUNT(*) FROM import_batches WHERE account_id = @id) AS importBatchCount,
            (SELECT COUNT(*) FROM transactions WHERE account_id = @id) AS transactionCount
        `
      )
      .get({ id }) as { importBatchCount: number; transactionCount: number }

    if (references.importBatchCount > 0 || references.transactionCount > 0) {
      throw new Error('Cannot delete an account that still has imports or transactions')
    }

    this.database.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  }
}
