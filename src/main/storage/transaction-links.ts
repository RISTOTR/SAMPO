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

  listCardSettlementLinksFromSettlement(settlementTransactionId: string): TransactionLink[] {
    return this.database
      .prepare(
        `
          SELECT * FROM transaction_links
          WHERE from_transaction_id = ? AND kind = 'card_settlement'
          ORDER BY created_at ASC
        `
      )
      .all(settlementTransactionId)
      .map((row) => transactionLinkSchema.parse(mapTransactionLink(row as never)))
  }

  findCardSettlementLinkForDestination(transactionId: string): TransactionLink | undefined {
    const row = this.database
      .prepare(
        `
          SELECT * FROM transaction_links
          WHERE to_transaction_id = ? AND kind = 'card_settlement'
        `
      )
      .get(transactionId)

    return row ? transactionLinkSchema.parse(mapTransactionLink(row as never)) : undefined
  }

  listCardSettlementLinkedDestinationIds(transactionIds: string[]): Set<string> {
    if (transactionIds.length === 0) {
      return new Set()
    }

    const placeholders = transactionIds.map(() => '?').join(', ')
    const rows = this.database
      .prepare(
        `
          SELECT to_transaction_id AS id
          FROM transaction_links
          WHERE kind = 'card_settlement'
            AND to_transaction_id IN (${placeholders})
        `
      )
      .all(...transactionIds) as Array<{ id: string }>

    return new Set(rows.map((row) => row.id))
  }

  createMany(inputs: NewTransactionLink[]): TransactionLink[] {
    return inputs.map((input) => this.create(input))
  }

  deleteCardSettlementLinksFromSettlement(settlementTransactionId: string): number {
    const result = this.database
      .prepare(
        `
          DELETE FROM transaction_links
          WHERE from_transaction_id = ? AND kind = 'card_settlement'
        `
      )
      .run(settlementTransactionId)

    return result.changes
  }

  importBatchParticipatesInCardSettlementLinks(importBatchId: string): boolean {
    const row = this.database
      .prepare(
        `
          SELECT 1
          FROM transaction_links links
          JOIN transactions source ON source.id = links.from_transaction_id
          JOIN transactions destination ON destination.id = links.to_transaction_id
          WHERE links.kind = 'card_settlement'
            AND (
              source.import_batch_id = @importBatchId OR destination.import_batch_id = @importBatchId
            )
          LIMIT 1
        `
      )
      .get({ importBatchId })

    return Boolean(row)
  }

  delete(id: string): void {
    this.findById(id)
    this.database.prepare('DELETE FROM transaction_links WHERE id = ?').run(id)
  }
}
