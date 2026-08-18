import * as XLSX from '@e965/xlsx'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DuplicateImportError, ImportParseError } from '../../domain/errors'
import { ImportService } from '../../services/import-service'
import { AccountRepository } from '../../storage/accounts'
import { createDatabase } from '../../storage/database'
import { TransactionRepository } from '../../storage/transactions'
import { VisaSettlementReconciliationService } from '../../reconciliation/visa-settlement-reconciliation-service'
import { EvoVisaXlsImporter } from '../evo-visa/evo-visa-xls-importer'
import { EvoAccountExcelImporter } from '../evo-account-excel/evo-account-excel-importer'

const accountId = '11111111-1111-4111-8111-111111111111'

describe('EvoAccountExcelImporter', () => {
  let directory: string
  let importer: EvoAccountExcelImporter
  let visaImporter: EvoVisaXlsImporter

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-evo-account-excel-'))
    importer = new EvoAccountExcelImporter()
    visaImporter = new EvoVisaXlsImporter()
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('recognises the account workbook by table headers and rejects Visa workbook shape', async () => {
    const accountPath = writeAccountWorkbook(directory, 'account-movements.xlsx', validRows())
    const visaPath = writeVisaWorkbook(directory, 'visa.xls')

    await expect(importer.canHandle(input(accountPath))).resolves.toBe(true)
    await expect(importer.canHandle(input(visaPath))).resolves.toBe(false)
    await expect(visaImporter.canHandle(input(accountPath))).resolves.toBe(false)
  })

  it('ignores metadata and blank rows, preserves descriptions, and derives period from rows', async () => {
    const filePath = writeAccountWorkbook(directory, 'account-movements.xlsx', validRows())
    const inspection = await importer.inspect(input(filePath))
    const preparedImport = await importer.prepare(input(filePath), { accountId })

    expect(inspection).toMatchObject({
      sourceKind: 'evo_account_excel',
      detectedFormat: 'evo_bankinter_account_excel_xlsx_v1',
      completedCount: 4,
      pendingCount: 0,
      invalidRowCount: 0,
      statementPeriodStart: '2026-05-31',
      statementPeriodEnd: '2026-07-01',
      canImport: true
    })
    expect(preparedImport.transactions).toHaveLength(4)
    expect(preparedImport.transactions[0]).toMatchObject({
      sourceRowIndex: 0,
      transactionDate: '2026-06-01',
      valueDate: '2026-06-02',
      originalDescription: 'SAMPLE SUPERMARKET MADRID',
      amountCents: -1234,
      balanceCents: 98766,
      currency: 'EUR',
      transactionType: 'expense',
      reviewStatus: 'confirmed'
    })
    expect(preparedImport.transactions[1]).toMatchObject({
      transactionDate: '2026-05-31',
      originalDescription: 'SYNTHETIC PAYROLL',
      amountCents: 250000,
      transactionType: 'income'
    })
    expect(preparedImport.transactions[2]).toMatchObject({
      originalDescription: 'RECIBO VISA CLASICA',
      transactionType: 'card_settlement',
      reviewStatus: 'needs_review'
    })
  })

  it('fails safely for malformed transaction rows without including raw descriptions in warnings', async () => {
    const filePath = writeAccountWorkbook(directory, 'malformed.xlsx', [
      ['Synthetic metadata'],
      headerRow(),
      ['01/06/2026', '02/06/2026', 'SENSITIVE LOOKING SYNTHETIC TEXT', 'not-money', '10,00', 'EUR']
    ])
    const inspection = await importer.inspect(input(filePath))

    expect(inspection.canImport).toBe(false)
    expect(inspection.invalidRowCount).toBeGreaterThan(0)
    expect(inspection.warnings.map((warning) => warning.code)).toContain('invalid_amount')
    expect(JSON.stringify(inspection.warnings)).not.toContain('SENSITIVE LOOKING SYNTHETIC TEXT')
    await expect(importer.prepare(input(filePath), { accountId })).rejects.toThrow(ImportParseError)
  })

  it('prepares without writing and commits atomically with duplicate hash protection', async () => {
    const filePath = writeAccountWorkbook(directory, 'account-movements.xlsx', validRows())
    const database = createDatabase({ path: join(directory, 'integration.sqlite3'), useWal: false })
    const accounts = new AccountRepository(database.connection)
    const service = new ImportService(database.connection)
    const transactions = new TransactionRepository(database.connection)
    const account = accounts.create({ name: 'Synthetic current', kind: 'current' })

    const preparedImport = await importer.prepare(input(filePath), { accountId: account.id })
    expect(transactions.listForAccount(account.id)).toHaveLength(0)

    const first = service.commitPreparedImport(preparedImport)
    expect(first.batch.sourceKind).toBe('evo_account_excel')
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

  it('produces Visa settlement rows compatible with reconciliation discovery', async () => {
    const accountPath = writeAccountWorkbook(directory, 'account-movements.xlsx', [
      ['Metadata row'],
      headerRow(),
      ['05/06/2026', '05/06/2026', 'RECIBO VISA CLASICA', '-30,00', '70,00', 'EUR']
    ])
    const visaPath = writeVisaWorkbook(directory, 'visa.xls', [
      ['Synthetic Visa movements'],
      ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE'],
      [excelSerial('2026-06-01'), 'SAMPLE SHOP', -35],
      [excelSerial('2026-06-02'), 'SAMPLE REFUND', 5],
      ['MOVIMIENTOS PENDIENTES'],
      ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE']
    ])
    const database = createDatabase({
      path: join(directory, 'reconciliation.sqlite3'),
      useWal: false
    })
    const accounts = new AccountRepository(database.connection)
    const service = new ImportService(database.connection)
    const reconciliation = new VisaSettlementReconciliationService(database.connection)
    const current = accounts.create({ name: 'Synthetic current', kind: 'current' })
    const card = accounts.create({ name: 'Synthetic Visa', kind: 'credit_card' })
    const settlementResult = service.commitPreparedImport(
      await importer.prepare(input(accountPath), { accountId: current.id })
    )
    const visaResult = service.commitPreparedImport(
      await visaImporter.prepare(input(visaPath), { accountId: card.id })
    )
    const settlement = settlementResult.transactions[0]

    expect(settlement).toMatchObject({
      originalDescription: 'RECIBO VISA CLASICA',
      transactionType: 'card_settlement',
      amountCents: -3000
    })
    expect(reconciliation.findVisaSettlementCandidates(settlement.id)).toEqual([
      expect.objectContaining({
        visaImportBatchId: visaResult.batch.id,
        exactAmountMatch: true,
        differenceCents: 0
      })
    ])

    database.close()
  })
})

function validRows(): unknown[][] {
  return [
    ['Cuenta', 'Synthetic current account'],
    ['Fecha', '01/06/2026 - 30/06/2026'],
    [],
    ['Other metadata'],
    [],
    headerRow(),
    [],
    ['01/06/2026', '02/06/2026', 'SAMPLE SUPERMARKET MADRID', '-12,34', '987,66', 'EUR'],
    ['31/05/2026', '31/05/2026', 'SYNTHETIC PAYROLL', '2.500,00', '3.487,66', 'EUR'],
    ['15/06/2026', '15/06/2026', 'RECIBO VISA CLASICA', '-100,00', '3.387,66', 'EUR'],
    [],
    ['01/07/2026', '01/07/2026', 'SYNTHETIC UTILITY', '-50,00', '3.337,66', 'EUR']
  ]
}

function headerRow(): string[] {
  return ['Fecha contable', 'Fecha valor', 'Descripción', 'Importe', 'Saldo', 'Divisa']
}

function input(filePath: string): {
  filePath: string
  originalFileName: string
} {
  return {
    filePath,
    originalFileName: filePath.split('/').at(-1) ?? 'synthetic.xlsx'
  }
}

function writeAccountWorkbook(directory: string, fileName: string, rows: unknown[][]): string {
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Movimientos')
  const filePath = join(directory, fileName)
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer
  writeFileSync(filePath, buffer)

  return filePath
}

function writeVisaWorkbook(
  directory: string,
  fileName: string,
  rows: unknown[][] = [
    ['Synthetic Visa movements'],
    ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE'],
    [excelSerial('2026-02-01'), 'NORTH MARKET', -10],
    ['MOVIMIENTOS PENDIENTES'],
    ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE']
  ]
): string {
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Movimientos')
  const filePath = join(directory, fileName)
  writeFileSync(filePath, XLSX.write(workbook, { bookType: 'biff8', type: 'buffer' }) as Buffer)
  return filePath
}

function excelSerial(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  return Math.trunc((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000)
}
