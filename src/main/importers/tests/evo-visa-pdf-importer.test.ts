import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as XLSX from '@e965/xlsx'
import { EvoVisaPdfImporter } from '../evo-visa-pdf/evo-visa-pdf-importer'
import { EvoVisaXlsImporter } from '../evo-visa/evo-visa-xls-importer'
import { EvoAccountPdfImporter } from '../evo-account-pdf/evo-account-pdf-importer'
import { toOperationError } from '../../workflows/errors'
import { ImportParseError } from '../../domain/errors'
import { createDatabase } from '../../storage/database'
import { AccountRepository } from '../../storage/accounts'
import { TransactionRepository } from '../../storage/transactions'
import { ImportService } from '../../services/import-service'
import { ImportPreviewWorkflow } from '../../workflows/import-preview-workflow'
import { VisaSettlementReconciliationService } from '../../reconciliation/visa-settlement-reconciliation-service'
import Database from 'better-sqlite3'
import { migrations, runMigrations } from '../../storage/migrations'
import { ImportBatchRepository } from '../../storage/import-batches'
import { parseVisaPdfText } from '../evo-visa-pdf/statement-parser'
import type { PositionedText } from '../evo-account-pdf/pdf-text-extraction'

const accountId = '11111111-1111-4111-8111-111111111111'
type Options = {
  commission?: string
  wrongCommissionTotal?: boolean
  unknownAppendix?: boolean
  wrongTotal?: boolean
  noTotal?: boolean
  missingPage?: boolean
  reversedPages?: boolean
  malformedDate?: boolean
  ambiguousAmount?: boolean
  signedAmount?: boolean
  missingAmount?: boolean
  multipleCards?: boolean
  pending?: boolean
  wrongCurrency?: boolean
  unknownRow?: boolean
}

// All transactions, identifiers, dates and amounts here are synthetic.
function syntheticItems(options: Options = {}): PositionedText[] {
  const items: PositionedText[] = []
  const add = (pageNumber: number, x: number, y: number, text: string): void => {
    items.push({ pageNumber, x, y, text, width: text.length * 4, height: 8 })
  }
  for (const page of [1, 2]) {
    const y = page === 1 ? 354 : 710
    add(page, 395, y + 22, options.wrongCurrency ? 'CARGOS ($)' : 'CARGOS (€)')
    add(page, 484, y + 22, 'ABONOS (€)')
    add(page, 54, y + 10, 'FECHA')
    add(page, 110, y + 10, 'Nº TARJETA')
    add(page, 46, y, 'OPERACIÓN')
    add(page, 96, y, 'ÚLTIMOS DÍGITOS')
    add(page, 250, y, 'CONCEPTO')
    add(page, 404, y, 'IMPORTE')
    add(page, 495, y, 'IMPORTE')
    add(page, 541, 17, `${page} de 2`)
  }
  add(1, 36, 740, 'Synthetic Visa statement')
  if (options.pending) add(1, 36, 400, 'MOVIMIENTOS PENDIENTES')
  const movement = (
    page: number,
    y: number,
    description: string,
    charge?: string,
    credit?: string
  ): void => {
    add(page, 46, y, options.malformedDate && page === 1 ? '31/02/2026' : '01/03/2026')
    add(page, 121, y, options.multipleCards && page === 2 ? '9002' : '9001')
    add(page, 172, y, description)
    if (charge) add(page, 430, y, charge)
    if (credit) add(page, 520, y, credit)
  }
  movement(
    1,
    330,
    'SYNTHETIC MARKET',
    options.missingAmount ? undefined : options.signedAmount ? '-12,00' : '12,00',
    options.ambiguousAmount ? '1,00' : undefined
  )
  movement(1, 310, 'SYNTHETIC MARKET', '12,00')
  movement(2, 690, 'SYNTHETIC WRAPPED', '23,00')
  add(2, 172, 680, 'DESCRIPTION')
  movement(2, 660, 'SYNTHETIC REFUND', undefined, '5,00')
  if (options.unknownRow) add(2, 172, 630, 'UNKNOWN ROW')
  if (!options.noTotal) {
    add(2, 323, 599, 'SUMA TOTAL')
    add(2, 430, 599, options.wrongTotal ? '47,01' : '47,00')
    add(2, 520, 599, '5,00')
  }
  add(2, 303, 584, 'IMPORTE A PAGAR')
  add(2, 444, 584, '42,00 €')
  add(2, 36, 530, 'Synthetic interest summary')
  if (options.commission !== undefined) {
    const repeatedHeader = items.filter((item) => item.pageNumber === 2 && item.y >= 710)
    for (const item of repeatedHeader) items.push({ ...item, y: item.y - 484 })
    add(2, 120, 273, 'Cargos y abonos del mes correspondientes a su tarjeta por comisiones')
    movement(2, 209, 'SYNTHETIC COMMISSION', options.commission || undefined)
    add(2, 323, 191, 'SUMA TOTAL')
    if (options.commission || options.wrongCommissionTotal)
      add(2, 430, 191, options.wrongCommissionTotal ? '9,99' : options.commission!)
    for (const item of items) {
      if (item.y === 17) item.text = `${item.pageNumber} de 3`
    }
    add(
      3,
      179,
      737,
      options.unknownAppendix
        ? 'UNKNOWN APPENDIX'
        : 'Detalle de importes recobrados a cierre del mes'
    )
    add(3, 54, 680, '01/03/2026')
    add(3, 227, 680, '123,45')
    add(3, 541, 17, '3 de 3')
  }
  let result = options.missingPage
    ? items.filter((item) => item.pageNumber === 2).map((item) => ({ ...item, pageNumber: 1 }))
    : items
  if (options.reversedPages)
    result = result.map((item) => ({ ...item, pageNumber: item.pageNumber === 1 ? 2 : 1 }))
  return result
}

async function writePdf(directory: string, options: Options = {}): Promise<string> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const items = syntheticItems(options)
  const count = options.missingPage ? 1 : options.commission !== undefined ? 3 : 2
  for (let p = 1; p <= count; p++) {
    const page = pdf.addPage([595.22, 841.82])
    for (const item of items.filter((item) => item.pageNumber === p)) {
      page.drawText(item.text, { x: item.x, y: item.y, size: 8, font })
    }
  }
  const path = join(directory, 'synthetic-visa.pdf')
  writeFileSync(path, await pdf.save())
  return path
}
function input(filePath: string): { filePath: string; originalFileName: string } {
  return { filePath, originalFileName: 'synthetic-statement.pdf' }
}

describe('Bankinter Visa PDF adapter', () => {
  it('reports validation failures without exposing statement contents', () => {
    expect(toOperationError(new ImportParseError('private details'))).toMatchObject({
      code: 'unsupported_file',
      message: expect.stringContaining('Nothing was imported.')
    })
    expect(toOperationError(new ImportParseError('private details')).message).not.toContain(
      'private details'
    )
  })
  let directory: string
  const importer = new EvoVisaPdfImporter()
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-visa-pdf-'))
  })
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it.each(['', '2,50'])(
    'accepts a separate commission section (%s) and repayment appendix',
    async (commission) => {
      const path = await writePdf(directory, { commission })
      expect(await importer.inspect(input(path))).toMatchObject({ canImport: true, warnings: [] })
      const prepared = await importer.prepare(input(path), { accountId })
      expect(prepared.transactions.map((row) => row.amountCents)).toEqual(
        commission ? [-1200, -1200, -2300, 500, -250] : [-1200, -1200, -2300, 500]
      )
    }
  )

  it.each([
    { commission: '', wrongCommissionTotal: true },
    { commission: '2,50', wrongTotal: true },
    { commission: '', unknownAppendix: true }
  ])('rejects invalid section totals and unknown appendices: %j', async (options) => {
    const path = await writePdf(directory, options)
    expect((await importer.inspect(input(path))).canImport).toBe(false)
    await expect(importer.prepare(input(path), { accountId })).rejects.toThrow(ImportParseError)
  })

  it('reads a multipage PDF, uses column signs, joins wrapped concepts and excludes summaries', async () => {
    const path = await writePdf(directory)
    const inspection = await importer.inspect(input(path))
    expect(inspection).toMatchObject({
      sourceKind: 'evo_visa_pdf',
      canImport: true,
      completedCount: 4,
      pendingCount: 0,
      invalidRowCount: 0
    })
    const prepared = await importer.prepare(input(path), { accountId })
    expect(prepared.transactions.map((row) => row.amountCents)).toEqual([-1200, -1200, -2300, 500])
    expect(prepared.transactions[2]?.originalDescription).toBe('SYNTHETIC WRAPPED DESCRIPTION')
    expect(prepared.transactions[3]?.transactionType).toBe('refund')
    expect(prepared.transactions.every((row) => row.currency === 'EUR' && !row.isPending)).toBe(
      true
    )
    expect(prepared.statementPeriodStart).toBe('2026-03-01')
    await expect(new EvoAccountPdfImporter().canHandle(input(path))).resolves.toBe(false)
    await expect(new EvoVisaXlsImporter().canHandle(input(path))).resolves.toBe(false)
  })

  it.each<keyof Options>([
    'wrongTotal',
    'noTotal',
    'missingPage',
    'reversedPages',
    'malformedDate',
    'ambiguousAmount',
    'signedAmount',
    'missingAmount',
    'multipleCards',
    'pending',
    'wrongCurrency',
    'unknownRow'
  ])('blocks unsafe %s statements without leaking row contents', async (option) => {
    const options = { [option]: true }
    const parsed = parseVisaPdfText(option === 'missingPage' ? 1 : 2, syntheticItems(options))
    expect(parsed.warnings.some((warning) => warning.blocking)).toBe(true)
    expect(JSON.stringify(parsed.warnings)).not.toContain('SYNTHETIC')
    const path = await writePdf(directory, options)
    expect((await importer.inspect(input(path))).canImport).toBe(false)
    await expect(importer.prepare(input(path), { accountId })).rejects.toThrow(ImportParseError)
  })

  it('rejects corrupt, image-only and unrelated PDFs', async () => {
    const path = join(directory, 'bad.pdf')
    writeFileSync(path, 'not a PDF')
    await expect(importer.canHandle(input(path))).resolves.toBe(false)
    const blank = await PDFDocument.create()
    blank.addPage()
    writeFileSync(path, await blank.save())
    expect((await importer.inspect(input(path))).warnings[0]?.code).toBe('missing_text_layer')
    const page = blank.getPage(0)
    page.drawText('Unrelated synthetic document')
    writeFileSync(path, await blank.save())
    await expect(importer.canHandle(input(path))).resolves.toBe(false)
  })

  it('detects PDF in preview, restricts it to card accounts, commits and reconciles exact signed totals', async () => {
    const path = await writePdf(directory)
    const db = createDatabase({ path: join(directory, 'test.sqlite3'), useWal: false })
    try {
      const accounts = new AccountRepository(db.connection)
      const card = accounts.create({ name: 'Synthetic card', kind: 'credit_card' })
      const current = accounts.create({ name: 'Synthetic current', kind: 'current' })
      const workflow = new ImportPreviewWorkflow(db.connection, {
        selectImportFile: async () => path
      })
      await expect(workflow.selectAndInspectImport(current.id)).rejects.toThrow()
      const preview = await workflow.selectAndInspectImport(card.id)
      expect(preview?.sourceKind).toBe('evo_visa_pdf')
      expect(preview?.inspection.canImport).toBe(true)
      const committed = await workflow.commitImportPreview(preview!.id)
      expect(committed.transactionCount).toBe(4)
      const service = new ImportService(db.connection)
      const settlement = service.commitPreparedImport({
        accountId: current.id,
        sourceKind: 'evo_account_pdf',
        sourceFileName: 'synthetic-account.pdf',
        fileSha256: 'd'.repeat(64),
        transactions: [
          {
            accountId: current.id,
            sourceRowIndex: 0,
            transactionDate: '2026-03-03',
            originalDescription: 'SYNTHETIC SETTLEMENT',
            amountCents: -4200,
            transactionType: 'card_settlement'
          }
        ]
      }).transactions[0]!
      const reconciliation = new VisaSettlementReconciliationService(db.connection)
      expect(reconciliation.findVisaSettlementCandidates(settlement.id)).toHaveLength(1)
      expect(
        reconciliation.previewVisaSettlementReconciliation(settlement.id, committed.batchId)
          .canCommit
      ).toBe(true)
      reconciliation.commitVisaSettlementReconciliation(settlement.id, committed.batchId)
      expect(
        new TransactionRepository(db.connection).findById(settlement.id).excludedFromSpending
      ).toBe(true)
    } finally {
      db.close()
    }
  })

  it('deduplicates identical movements across XLS and PDF while retaining genuine repeated purchases', async () => {
    const path = await writePdf(directory)
    const db = createDatabase({ path: join(directory, 'test.sqlite3'), useWal: false })
    try {
      const card = new AccountRepository(db.connection).create({
        name: 'Synthetic card',
        kind: 'credit_card'
      })
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['Fecha', 'Comercio/Cajero', 'Importe'],
          [46082, 'SYNTHETIC MARKET', -12],
          [46082, 'SYNTHETIC MARKET', -12],
          [46082, 'SYNTHETIC WRAPPED DESCRIPTION', -23],
          [46082, 'SYNTHETIC REFUND', 5]
        ]),
        'Synthetic'
      )
      const xls = join(directory, 'synthetic.xls')
      writeFileSync(xls, XLSX.write(workbook, { bookType: 'biff8', type: 'buffer' }))
      const preparedXls = await new EvoVisaXlsImporter().prepare(
        { filePath: xls, originalFileName: 'synthetic.xls' },
        { accountId: card.id }
      )
      const service = new ImportService(db.connection)
      expect(service.commitPreparedImport(preparedXls).transactions).toHaveLength(4)
      const preparedPdf = await importer.prepare(input(path), { accountId: card.id })
      const duplicates = service.previewPreparedImportDeduplication(preparedPdf)
      expect(duplicates).toMatchObject({ newTransactionCount: 0, duplicateTransactionCount: 4 })
      expect(service.commitPreparedImport(preparedPdf).transactions).toHaveLength(0)
      expect(
        new TransactionRepository(db.connection).listCommittedForAccount(card.id)
      ).toHaveLength(4)
    } finally {
      db.close()
    }
  })
  it('blocks a partial PDF batch even when the remaining movements exactly match a settlement', async () => {
    const path = await writePdf(directory)
    const db = createDatabase({ path: join(directory, 'test.sqlite3'), useWal: false })
    try {
      const accounts = new AccountRepository(db.connection)
      const card = accounts.create({ name: 'Synthetic card', kind: 'credit_card' })
      const current = accounts.create({ name: 'Synthetic account', kind: 'current' })
      const prepared = await importer.prepare(input(path), { accountId: card.id })
      const service = new ImportService(db.connection)
      service.commitPreparedImport({
        ...prepared,
        sourceKind: 'evo_visa_xls',
        fileSha256: 'a'.repeat(64),
        transactions: [prepared.transactions[0]!]
      })
      const workflow = new ImportPreviewWorkflow(db.connection, {
        selectImportFile: async () => path
      })
      const preview = await workflow.selectAndInspectImport(card.id)
      expect(preview?.inspection.duplicateTransactionCount).toBe(1)
      const batch = await workflow.commitImportPreview(preview!.id)
      expect(new ImportBatchRepository(db.connection).findById(batch.batchId)).toMatchObject({
        statementTransactionCount: 4,
        transactionCount: 3
      })
      const settlement = service.commitPreparedImport({
        accountId: current.id,
        sourceKind: 'evo_account_pdf',
        sourceFileName: 'synthetic.pdf',
        fileSha256: 'b'.repeat(64),
        transactions: [
          {
            accountId: current.id,
            sourceRowIndex: 0,
            transactionDate: '2026-03-03',
            originalDescription: 'SYNTHETIC SETTLEMENT',
            amountCents: -3000,
            transactionType: 'card_settlement'
          }
        ]
      }).transactions[0]!
      const reconciliation = new VisaSettlementReconciliationService(db.connection)
      const result = reconciliation.previewVisaSettlementReconciliation(
        settlement.id,
        batch.batchId
      )
      expect(result.canCommit).toBe(false)
      expect(result.warnings.some((warning) => warning.code === 'visa_batch_incomplete')).toBe(true)
      expect(
        reconciliation
          .findVisaSettlementCandidates(settlement.id, { includeBlocked: true })
          .find((candidate) => candidate.visaImportBatchId === batch.batchId)?.warnings
      ).toContainEqual(expect.objectContaining({ code: 'visa_batch_incomplete', blocking: true }))

      expect(
        reconciliation
          .findVisaSettlementCandidates(settlement.id)
          .some((candidate) => candidate.visaImportBatchId === batch.batchId)
      ).toBe(false)
      expect(() =>
        reconciliation.commitVisaSettlementReconciliation(settlement.id, batch.batchId)
      ).toThrow()
    } finally {
      db.close()
    }
  })

  it('upgrades existing batches without losing transaction links or rollback cascades', () => {
    const path = join(directory, 'migration.sqlite3')
    const db = new Database(path)
    try {
      db.pragma('foreign_keys = ON')
      db.exec(
        'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
      )
      for (const migration of migrations.filter((item) => item.version <= 12)) {
        if (migration.disableForeignKeys) db.pragma('foreign_keys = OFF')
        db.transaction(() => {
          migration.up(db)
          db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(
            migration.version,
            migration.name,
            new Date().toISOString()
          )
        })()
        if (migration.disableForeignKeys) db.pragma('foreign_keys = ON')
      }
      const now = new Date().toISOString()
      const batchId = '22222222-2222-4222-8222-222222222222'
      db.prepare(
        'INSERT INTO accounts(id,name,kind,currency,created_at,updated_at) VALUES(?,?,?,?,?,?)'
      ).run(accountId, 'Synthetic account', 'credit_card', 'EUR', now, now)
      db.prepare(
        "INSERT INTO import_batches(id,account_id,source_kind,source_file_name,file_sha256,status,created_at) VALUES(?,?,'evo_visa_xls','synthetic.xls',?,'committed',?)"
      ).run(batchId, accountId, 'a'.repeat(64), now)
      const row = new TransactionRepository(db).insertForImportBatch({
        importBatchId: batchId,
        batchAccountId: accountId,
        transaction: {
          accountId,
          sourceRowIndex: 0,
          transactionDate: '2026-03-01',
          originalDescription: 'SYNTHETIC MIGRATION',
          amountCents: -100,
          transactionType: 'expense'
        }
      })
      runMigrations(db)
      expect(new TransactionRepository(db).findById(row.id).importBatchId).toBe(batchId)
      expect(db.pragma('foreign_key_check')).toEqual([])
      expect(
        new ImportBatchRepository(db).createPending({
          accountId,
          sourceKind: 'evo_visa_pdf',
          sourceFileName: 'synthetic.pdf',
          fileSha256: 'b'.repeat(64),
          statementTransactionCount: 4
        }).sourceKind
      ).toBe('evo_visa_pdf')
      new ImportService(db).rollbackCommittedBatch(batchId)
      expect(new TransactionRepository(db).listCommittedForAccount(accountId)).toHaveLength(0)
    } finally {
      db.close()
    }
  })
})
