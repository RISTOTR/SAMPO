import * as XLSX from '@e965/xlsx'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DuplicateImportError } from '../../domain/errors'
import { AccountRepository } from '../../storage/accounts'
import { createDatabase, type SampoDatabase } from '../../storage/database'
import { TransactionRepository } from '../../storage/transactions'
import { ImportPreviewWorkflow, type FileDialogAdapter } from '../import-preview-workflow'

describe('ImportPreviewWorkflow', () => {
  let directory: string
  let database: SampoDatabase
  let accounts: AccountRepository
  let transactions: TransactionRepository
  let selectedFilePath: string | undefined
  let workflow: ImportPreviewWorkflow

  const dialog: FileDialogAdapter = {
    selectImportFile: async () => selectedFilePath
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-preview-workflow-'))
    database = createDatabase({ path: join(directory, 'workflow.sqlite3'), useWal: false })
    accounts = new AccountRepository(database.connection)
    transactions = new TransactionRepository(database.connection)
    selectedFilePath = undefined
    workflow = new ImportPreviewWorkflow(database.connection, dialog)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates and commits a basename-only Visa preview without writing before commit', async () => {
    const account = accounts.create({ name: 'Synthetic Visa', kind: 'credit_card' })
    selectedFilePath = writeVisaWorkbook(directory, 'synthetic-visa.xls')

    const preview = await workflow.selectAndInspectImport(account.id)

    expect(preview).toMatchObject({
      accountId: account.id,
      sourceKind: 'evo_visa_xls',
      sourceFileName: 'synthetic-visa.xls'
    })
    expect(JSON.stringify(preview)).not.toContain(directory)
    expect(preview?.transactions).toHaveLength(2)
    expect(transactions.listForAccount(account.id)).toHaveLength(0)

    const committed = await workflow.commitImportPreview(preview?.id ?? '')
    expect(committed.transactionCount).toBe(2)
    expect(transactions.listForAccount(account.id)).toHaveLength(2)
    await expect(workflow.commitImportPreview(preview?.id ?? '')).rejects.toThrow()
  })

  it('creates an account PDF preview for current accounts', async () => {
    const account = accounts.create({ name: 'Synthetic current', kind: 'current' })
    selectedFilePath = await writeAccountPdf(directory, 'synthetic-account.pdf')

    const preview = await workflow.selectAndInspectImport(account.id)

    expect(preview).toMatchObject({
      sourceKind: 'evo_account_pdf',
      sourceFileName: 'synthetic-account.pdf'
    })
    expect(preview?.inspection.details?.balanceContinuityPassed).toBe(true)
  })

  it('handles cancellation, incompatible source, source changes, active limit, and duplicate commit', async () => {
    const current = accounts.create({ name: 'Synthetic current', kind: 'current' })
    const card = accounts.create({ name: 'Synthetic Visa', kind: 'credit_card' })

    await expect(workflow.selectAndInspectImport(card.id)).resolves.toBeNull()

    selectedFilePath = writeVisaWorkbook(directory, 'incompatible.xls')
    await expect(workflow.selectAndInspectImport(current.id)).rejects.toThrow()

    const firstFile = writeVisaWorkbook(directory, 'first.xls')
    selectedFilePath = firstFile
    const firstPreview = await workflow.selectAndInspectImport(card.id)
    writeFileSync(firstFile, 'changed')
    await expect(workflow.commitImportPreview(firstPreview?.id ?? '')).rejects.toThrow()

    selectedFilePath = writeVisaWorkbook(directory, 'duplicate.xls')
    const duplicatePreview = await workflow.selectAndInspectImport(card.id)
    await workflow.commitImportPreview(duplicatePreview?.id ?? '')
    selectedFilePath = writeVisaWorkbook(directory, 'duplicate-copy.xls')
    const duplicate = await workflow.selectAndInspectImport(card.id)
    await expect(workflow.commitImportPreview(duplicate?.id ?? '')).rejects.toThrow(
      DuplicateImportError
    )

    for (let index = 0; index < 10; index += 1) {
      selectedFilePath = writeVisaWorkbook(directory, `limit-${index}.xls`)
      await workflow.selectAndInspectImport(card.id)
    }
    expect(workflow.activeSessionCount()).toBeLessThanOrEqual(8)

    workflow.discardImportPreview('00000000-0000-4000-8000-000000000000')
    await expect(
      workflow.commitImportPreview('00000000-0000-4000-8000-000000000000')
    ).rejects.toThrow()
  })
})

function writeVisaWorkbook(directory: string, fileName: string): string {
  const rows = [
    ['Synthetic Visa movements'],
    ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE'],
    [excelSerial('2026-02-01'), 'NORTH MARKET', -10],
    [excelSerial('2026-02-02'), 'TEST REFUND', 2],
    ['Total Movimientos', -8],
    ['MOVIMIENTOS PENDIENTES'],
    ['FECHA', 'COMERCIO/CAJERO', 'IMPORTE']
  ]
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Movimientos')
  const filePath = join(directory, fileName)
  writeFileSync(filePath, XLSX.write(workbook, { bookType: 'biff8', type: 'buffer' }) as Buffer)
  return filePath
}

async function writeAccountPdf(directory: string, fileName: string): Promise<string> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([595, 281])
  const draw = (text: string, x: number, y: number): void => {
    page.drawText(text, { x, y, size: 7, font })
  }
  draw('Movimientos y saldo de su cuenta', 28, 211)
  draw('Fecha', 28, 199)
  draw('Referencia', 77, 199)
  draw('Fecha valor', 128, 199)
  draw('Descripción', 182, 199)
  draw('Cargos(-)', 348, 199)
  draw('Abonos(+)', 402, 199)
  draw('Saldo', 516, 199)
  draw('**SALDO ANTERIOR EN EUROS**', 182, 191)
  draw('100,00-', 508, 191)
  draw('01-02-26', 28, 184)
  draw('1001', 77, 184)
  draw('01-02-26', 128, 184)
  draw('TEST CARD SETTLEMENT', 182, 184)
  draw('20,00', 365, 184)
  draw('120,00-', 508, 184)
  draw('**SALDO FINAL EN EUROS**', 182, 93)
  draw('120,00-', 508, 93)
  const filePath = join(directory, fileName)
  writeFileSync(filePath, await pdf.save())
  return filePath
}

function excelSerial(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  return Math.trunc((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000)
}
