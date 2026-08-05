import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { EntityNotFoundError } from '../domain/errors'
import {
  newTransactionLinkSchema,
  transactionLinkSchema,
  type NewTransactionLink,
  type TransactionLink
} from '../domain/schemas'
import { mapTransactionLink } from './row-mappers'

export class TransactionLinkRepository {
  constructor(private readonly database: Database) {}

  create(input: NewTransactionLink): TransactionLink {
    const link = newTransactionLinkSchema.parse(input)
    const id = randomUUID()

    this.database
      .prepare(
        `
          INSERT INTO transaction_links (
            id,
            from_transaction_id,
            to_transaction_id,
            kind,
            created_at
          )
          VALUES (@id, @fromTransactionId, @toTransactionId, @kind, @createdAt)
        `
      )
      .run({
        id,
        fromTransactionId: link.fromTransactionId,
        toTransactionId: link.toTransactionId,
        kind: link.kind,
        createdAt: new Date().toISOString()
      })

    return this.findById(id)
  }

  findById(id: string): TransactionLink {
    const row = this.database.prepare('SELECT * FROM transaction_links WHERE id = ?').get(id)

    if (!row) {
      throw new EntityNotFoundError('TransactionLink', id)
    }

    return transactionLinkSchema.parse(mapTransactionLink(row as never))
  }

  listForTransaction(transactionId: string): TransactionLink[] {
    return this.database
      .prepare(
        `
          SELECT * FROM transaction_links
          WHERE from_transaction_id = ? OR to_transaction_id = ?
          ORDER BY created_at ASC
        `
      )
      .all(transactionId, transactionId)
      .map((row) => transactionLinkSchema.parse(mapTransactionLink(row as never)))
  }

  delete(id: string): void {
    this.findById(id)
    this.database.prepare('DELETE FROM transaction_links WHERE id = ?').run(id)
  }
}
