import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { exportSelectedForTapio } from '../tapio-export'

// Explicit disposable database; no application or real-user database is opened.
describe('selected Tapio CSV export', () => {
  let directory: string
  let db: Database.Database
  const choosePath = vi.fn(async (): Promise<string | undefined> => '/synthetic/export.csv')
  const write = vi.fn<(path: string, csv: string) => Promise<void>>().mockResolvedValue(undefined)
  function add(
    merchant: string,
    category: string,
    description = 'Synthetic ticket',
    cents = -1234
  ): string {
    const id = randomUUID()
    db.prepare('INSERT INTO merchants VALUES (?,?)').run(id, merchant)
    db.prepare('INSERT INTO categories VALUES (?,?)').run(id, category)
    db.prepare('INSERT INTO transaction_classifications VALUES (?,?,?)').run(id, id, id)
    db.prepare('INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?)').run(
      id,
      'account',
      'batch',
      '2026-02-03',
      description,
      cents,
      'EUR',
      id,
      id
    )
    return id
  }
  async function run(ids: string[]): ReturnType<typeof exportSelectedForTapio> {
    db.pragma('query_only = ON')
    return exportSelectedForTapio(db, { transactionIds: ids }, undefined, { choosePath, write })
  }
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-tapio-export-'))
    db = new Database(join(directory, 'test.sqlite3'))
    db.exec(`CREATE TABLE accounts(id TEXT,name TEXT);
      CREATE TABLE import_batches(id TEXT,status TEXT);
      CREATE TABLE merchants(id TEXT,name TEXT);
      CREATE TABLE categories(id TEXT,name TEXT);
      CREATE TABLE transaction_classifications(transaction_id TEXT,merchant_id TEXT,category_id TEXT);
      CREATE TABLE transactions(id TEXT,account_id TEXT,import_batch_id TEXT,transaction_date TEXT,original_description TEXT,amount_cents INTEGER,currency TEXT,unused1 TEXT,unused2 TEXT);
      INSERT INTO accounts VALUES ('account','Synthetic account');
      INSERT INTO import_batches VALUES ('batch','committed');`)
    choosePath.mockReset().mockResolvedValue('/synthetic/export.csv')
    write.mockClear()
  })
  afterEach(() => {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  it('exports only checked flight/train/bus rows and preserves raw values, order and CSV quoting', async () => {
    const description = '  Synthetic "ticket", Helsinki\nReturn journey  '
    const train = add('VR', 'Travel', description, -5)
    const flight = add('Finnair', 'Flights', 'Synthetic flight', 12345)
    const bus = add('Synthetic operator', 'BUS', 'Synthetic bus', -100)
    add('Iberia', 'Flights', 'Unchecked ticket')
    const before = db.prepare('SELECT * FROM transactions').all()
    expect(await run([flight, train, bus, train])).toEqual({
      exportedCount: 3,
      skippedCount: 0,
      cancelled: false
    })
    expect(write).toHaveBeenCalledOnce()
    const csv = write.mock.calls[0]![1]
    expect(csv).toBe(
      'transaction_date,merchant,description,amount,currency,sampo_category,source_account,source_transaction_id,source_system\r\n' +
        `2026-02-03,Finnair,Synthetic flight,123.45,EUR,Flights,Synthetic account,${flight},SAMPO\r\n` +
        `2026-02-03,VR,"  Synthetic ""ticket"", Helsinki\nReturn journey  ",-0.05,EUR,Travel,Synthetic account,${train},SAMPO\r\n` +
        `2026-02-03,Synthetic operator,Synthetic bus,-1.00,EUR,BUS,Synthetic account,${bus},SAMPO\r\n`
    )
    expect(db.prepare('SELECT * FROM transactions').all()).toEqual(before)
  })
  it.each([
    ['Finnair', 'Hotels', 'Synthetic booking'],
    ['Synthetic Hotel', 'Flights', 'Synthetic booking'],
    ['VR', 'Travel', 'Synthetic hotel booking'],
    ['Booking.com', 'Flights', 'Synthetic booking'],
    ['Synthetic shop', 'Travel', 'Synthetic shopping'],
    ['Avolta', 'Flights', 'Synthetic airport shopping'],
    ['HSL', 'BUS', 'Synthetic bus ticket'],
    ['HSL', 'Flights', 'Synthetic ticket'],
    ['Synthetic transport', 'BUS', 'HSL MOBIILI'],
    ['Metro de Madrid', 'Public transport', 'Synthetic transport']
  ])(
    'excludes selected accommodation or unsupported evidence: %s/%s',
    async (merchant, category, description) => {
      const id = add(merchant, category, description)
      expect(await run([id])).toEqual({ exportedCount: 0, skippedCount: 1, cancelled: false })
      expect(choosePath).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
    }
  )
  it('reports skipped checked rows and missing IDs without adding other rows', async () => {
    const train = add('VR', 'Travel')
    const hotel = add('Synthetic lodging', 'Hotels')
    expect(await run([train, hotel, randomUUID()])).toEqual({
      exportedCount: 1,
      skippedCount: 2,
      cancelled: false
    })
  })
  it('does not write when the save dialog is cancelled', async () => {
    const train = add('VR', 'Travel')
    choosePath.mockResolvedValue(undefined)
    expect(await run([train])).toMatchObject({ cancelled: true, exportedCount: 0 })
    expect(write).not.toHaveBeenCalled()
  })
  it('validates selected IDs at the boundary', async () => {
    await expect(run([])).rejects.toThrow()
    await expect(run(['not-an-id'])).rejects.toThrow()
    expect(choosePath).not.toHaveBeenCalled()
  })
})
