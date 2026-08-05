import * as XLSX from '@e965/xlsx'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DuplicateImportError, ImportParseError } from '../../domain/errors'
import { AccountRepository } from '../../storage/accounts'
import { createDatabase } from '../../storage/database'
import { ImportService } from '../../services/import-service'
import { TransactionRepository } from '../../storage/transactions'
import { EvoVisaXlsImporter } from '../evo-visa/evo-visa-xls-importer'
import { excelSerialDateToIsoDate, parseVisaAmountCents } from '../evo-visa/normalization'
import { createPendingCandidateKey } from '../shared/candidate-key'

const accountId = '11111111-1111-4111-8111-111111111111'

describe('EvoVisaXlsImporter', () => {
  let directory: string
  let importer: EvoVisaXlsImporter

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-evo-visa-'))
    importer = new EvoVisaXlsImporter()
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('recognises the supported legacy BIFF EVO Visa export shape', async () => {
    const filePath = writeVisaWorkbook(directory, 'valid.xls', validRows())

    await expect(importer.canHandle(input(filePath))).resolves.toBe(true)
  })

  it('rejects unrelated, corrupt, and unsupported files', async () => {
    const unrelatedPath = join(directory, 'unrelated.xls')
    const corruptPath = join(directory, 'corrupt.xls')
    const unsupportedPath = writeVisaWorkbook(directory, 'unsupported.xls', [
      ['SYNTHETIC'],
      ['NO TABLE']
    ])

    writeFileSync(unrelatedPath, 'not a workbook')
    writeFileSync(corruptPath, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x00]))

    await expect(importer.canHandle(input(unrelatedPath))).resolves.toBe(false)
    await expect(importer.canHandle(input(corruptPath))).resolves.toBe(false)
    await expect(importer.canHandle(input(unsupportedPath))).resolves.toBe(false)
  })

  it('inspects completed and pending sections without raw descriptions in warnings', async () => {
    const filePath = writeVisaWorkbook(directory, 'valid.xls', validRows())
    const inspection = await importer.inspect(input(filePath))

    expect(inspection).toMatchObject({
      detectedFormat: 'legacy_excel_biff_cfb',
      completedCount: 4,
      pendingCount: 1,
      invalidRowCount: 0,
      canImport: true
    })
    expect(inspection.warningCount).toBe(0)
  })

  it('reports blocking warnings for missing columns and invalid movement rows', async () => {
    const missingColumnPath = writeVisaWorkbook(directory, 'missing-column.xls', [
      ['Synthetic heading'],
      ['FECHA', 'COMERCIO/CAJERO'],
      [excelSerial('2026-01-31'), 'NORTH MARKET', -1234]
    ])
    const malformedPath = writeVisaWorkbook(directory, 'malformed.xls', [
      ['Synthetic heading'],
      ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE'],
      [excelSerial('2026-01-31'), 'NORTH MARKET', -1234],
      ['unknown movement-like row'],
      ['MOVIMIENTOS PENDIENTES'],
      ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE'],
      [excelSerial('2026-02-01'), 'CITY TRANSIT', -250]
    ])

    const missingColumnInspection = await importer.inspect(input(missingColumnPath))
    const malformedInspection = await importer.inspect(input(malformedPath))

    expect(missingColumnInspection.canImport).toBe(false)
    expect(missingColumnInspection.warnings.some((warning) => warning.blocking)).toBe(true)
    expect(malformedInspection.canImport).toBe(false)
    expect(malformedInspection.invalidRowCount).toBeGreaterThan(0)
    expect(malformedInspection.warnings.map((warning) => warning.code)).toContain(
      'unrecognised_row'
    )
    expect(JSON.stringify(malformedInspection.warnings)).not.toContain('NORTH MARKET')
  })

  it('normalises dates, amounts, pending review status, and stable source row indexes', async () => {
    const filePath = writeVisaWorkbook(directory, 'valid.xls', validRows())
    const preparedImport = await importer.prepare(input(filePath), { accountId })

    expect(preparedImport.sourceKind).toBe('evo_visa_xls')
    expect(preparedImport.sourceFileName).toBe('valid.xls')
    expect(preparedImport.transactions).toHaveLength(5)
    expect(preparedImport.transactions[0]).toMatchObject({
      transactionDate: '2026-01-31',
      amountCents: -123456,
      transactionType: 'expense',
      isPending: false,
      reviewStatus: 'confirmed',
      currency: 'EUR',
      sourceRowIndex: 6
    })
    expect(preparedImport.transactions[2]).toMatchObject({
      transactionDate: '2026-02-01',
      amountCents: 1234,
      transactionType: 'refund'
    })
    expect(preparedImport.transactions[4]).toMatchObject({
      isPending: true,
      reviewStatus: 'needs_review'
    })
  })

  it('blocks preparation when any transaction-like row is invalid', async () => {
    const filePath = writeVisaWorkbook(directory, 'invalid-row.xls', [
      ['Synthetic heading'],
      ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE'],
      [excelSerial('2026-01-31'), 'NORTH MARKET', -1234],
      [excelSerial('2026-02-01'), ' ', -500],
      ['MOVIMIENTOS PENDIENTES'],
      ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE'],
      [excelSerial('2026-02-02'), 'CITY TRANSIT', -250]
    ])

    await expect(importer.prepare(input(filePath), { accountId })).rejects.toThrow(ImportParseError)
  })

  it('prepares without writing to the database and integrates with the import service', async () => {
    const filePath = writeVisaWorkbook(directory, 'valid.xls', validRows())
    const database = createDatabase({ path: join(directory, 'integration.sqlite3'), useWal: false })
    const accounts = new AccountRepository(database.connection)
    const service = new ImportService(database.connection)
    const transactions = new TransactionRepository(database.connection)
    const account = accounts.create({ name: 'Synthetic Visa', kind: 'credit_card' })

    const preparedImport = await importer.prepare(input(filePath), { accountId: account.id })
    expect(transactions.listForAccount(account.id)).toHaveLength(0)

    const first = service.commitPreparedImport(preparedImport)
    expect(first.batch.transactionCount).toBe(preparedImport.transactions.length)
    expect(transactions.listForAccount(account.id)).toHaveLength(preparedImport.transactions.length)
    expect(() => service.commitPreparedImport(preparedImport)).toThrow(DuplicateImportError)

    const rolledBack = service.rollbackCommittedBatch(first.batch.id)
    expect(rolledBack.status).toBe('rolled_back')
    expect(transactions.listForAccount(account.id)).toHaveLength(0)

    const second = service.commitPreparedImport(preparedImport)
    expect(second.batch.status).toBe('committed')

    database.close()
  })
})

describe('EVO Visa date and amount normalisation', () => {
  it('parses Excel serial dates explicitly, including leap years and month boundaries', () => {
    expect(excelSerialDateToIsoDate(excelSerial('2024-02-29'))).toBe('2024-02-29')
    expect(excelSerialDateToIsoDate(excelSerial('2026-01-31'))).toBe('2026-01-31')
    expect(excelSerialDateToIsoDate(excelSerial('2026-02-01'))).toBe('2026-02-01')
    expect(() => excelSerialDateToIsoDate('31/01/2026')).toThrow(ImportParseError)
    expect(() => excelSerialDateToIsoDate(-1)).toThrow(ImportParseError)
  })

  it('parses integer cents deterministically without accepting malformed or zero amounts', () => {
    expect(parseVisaAmountCents('-12')).toBe(-1200)
    expect(parseVisaAmountCents('-12,34')).toBe(-1234)
    expect(parseVisaAmountCents('-1.234,56')).toBe(-123456)
    expect(parseVisaAmountCents('1,234.56')).toBe(123456)
    expect(parseVisaAmountCents(12.34)).toBe(1234)
    expect(() => parseVisaAmountCents('12,3,4')).toThrow(ImportParseError)
    expect(() => parseVisaAmountCents('0,00')).toThrow(ImportParseError)
  })
})

describe('EVO Visa pending candidate key', () => {
  it('is stable for equivalent values and distinguishes clearly different values', () => {
    const first = createPendingCandidateKey({
      transactionDate: '2026-01-31',
      originalDescription: ' North   Market ',
      amountCents: -1234,
      currency: 'EUR'
    })
    const equivalent = createPendingCandidateKey({
      transactionDate: '2026-01-31',
      originalDescription: 'NORTH MARKET',
      amountCents: 1234,
      currency: 'EUR'
    })
    const different = createPendingCandidateKey({
      transactionDate: '2026-02-01',
      originalDescription: 'NORTH MARKET',
      amountCents: 1234,
      currency: 'EUR'
    })

    expect(first).toBe(equivalent)
    expect(first).not.toBe(different)
  })
})

function input(filePath: string): {
  filePath: string
  originalFileName: string
} {
  return {
    filePath,
    originalFileName: filePath.split('/').at(-1) ?? 'synthetic.xls'
  }
}

function validRows(): unknown[][] {
  return [
    ['Synthetic Visa movements'],
    ['Synthetic generated fixture'],
    [],
    [],
    ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE'],
    [],
    [excelSerial('2026-01-31'), ' NORTH MARKET ', -1234.56],
    [excelSerial('2026-02-01'), 'CITY TRANSIT', -2.5],
    [excelSerial('2026-02-01'), 'TEST REFUND', 12.34],
    [excelSerial('2024-02-29'), 'EXAMPLE STREAMING', -1000],
    ['Total Movimientos', -2224.72],
    [],
    ['MOVIMIENTOS PENDIENTES'],
    [],
    ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE'],
    [],
    [excelSerial('2026-02-02'), 'SAMPLE AIR', -1500]
  ]
}

function writeVisaWorkbook(directory: string, fileName: string, rows: unknown[][]): string {
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Movimientos')
  const filePath = join(directory, fileName)
  const buffer = XLSX.write(workbook, { bookType: 'biff8', type: 'buffer' }) as Buffer
  writeFileSync(filePath, buffer)

  return filePath
}

function excelSerial(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  const utc = Date.UTC(year, month - 1, day)
  const excelEpoch = Date.UTC(1899, 11, 30)

  return Math.trunc((utc - excelEpoch) / (24 * 60 * 60 * 1000))
}
