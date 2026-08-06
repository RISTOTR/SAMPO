import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BalanceValidationError, ImportParseError } from '../../domain/errors'
import type { PositionedText } from '../evo-account-pdf/pdf-text-extraction'
import { parseEuropeanDate, parseEuropeanMoneyCents } from '../evo-account-pdf/normalization'
import { groupVisualRows, parseAccountPdfText } from '../evo-account-pdf/statement-parser'
import { EvoAccountPdfImporter } from '../evo-account-pdf/evo-account-pdf-importer'
import { AccountRepository } from '../../storage/accounts'
import { createDatabase } from '../../storage/database'
import { ImportService } from '../../services/import-service'
import { TransactionRepository } from '../../storage/transactions'
import { DuplicateImportError } from '../../domain/errors'

const accountId = '11111111-1111-4111-8111-111111111111'

describe('EVO account PDF normalisation', () => {
  it('parses short European dates with deterministic century expansion', () => {
    expect(parseEuropeanDate('31-01-26')).toBe('2026-01-31')
    expect(parseEuropeanDate('01/02/26')).toBe('2026-02-01')
    expect(parseEuropeanDate('31-12-25', 2026)).toBe('2025-12-31')
    expect(parseEuropeanDate('01-01-26', 2025)).toBe('2026-01-01')
    expect(parseEuropeanDate('29-02-24')).toBe('2024-02-29')
    expect(() => parseEuropeanDate('31-02-26')).toThrow(ImportParseError)
    expect(() => parseEuropeanDate('01-13-26')).toThrow(ImportParseError)
    expect(parseEuropeanDate('01-01-70')).toBe('2070-01-01')
  })

  it('parses European integer cents strictly without floating point arithmetic', () => {
    expect(parseEuropeanMoneyCents('12,00')).toBe(1200)
    expect(parseEuropeanMoneyCents('12,34')).toBe(1234)
    expect(parseEuropeanMoneyCents('1.234,56')).toBe(123456)
    expect(parseEuropeanMoneyCents('123.456,78')).toBe(12345678)
    expect(parseEuropeanMoneyCents('12,34-')).toBe(-1234)
    expect(parseEuropeanMoneyCents('12,34 -'.replace(' ', ''))).toBe(-1234)
    expect(() => parseEuropeanMoneyCents('12.34')).toThrow(ImportParseError)
    expect(() => parseEuropeanMoneyCents('1.23,45')).toThrow(ImportParseError)
    expect(() => parseEuropeanMoneyCents('')).toThrow(ImportParseError)
    expect(() => parseEuropeanMoneyCents('1,00--')).toThrow(ImportParseError)
    expect(() => parseEuropeanMoneyCents('0,00')).toThrow(ImportParseError)
  })
})

describe('EVO account PDF positioned text parser', () => {
  it('groups visual rows deterministically while tolerating small coordinate shifts', () => {
    const rows = groupVisualRows([
      item(1, 'B', 20, 100),
      item(1, 'A', 10, 100.7),
      item(1, 'C', 10, 95),
      item(2, 'D', 10, 100)
    ])

    expect(rows).toHaveLength(3)
    expect(rows[0]?.items.map((text) => text.text)).toEqual(['A', 'B'])
    expect(rows[1]?.items.map((text) => text.text)).toEqual(['C'])
    expect(rows[2]?.pageNumber).toBe(2)
  })

  it('assigns columns, validates balances, and maps Visa settlement for synthetic positioned items', () => {
    const parsed = parseAccountPdfText(2, validPositionedStatement())

    expect(parsed.tableHeaderDetected).toBe(true)
    expect(parsed.openingBalanceFound).toBe(true)
    expect(parsed.finalBalanceFound).toBe(true)
    expect(parsed.balanceContinuityPassed).toBe(true)
    expect(parsed.warnings.filter((warning) => warning.blocking)).toHaveLength(0)
    expect(parsed.transactions).toHaveLength(6)
    expect(parsed.transactions.map((transaction) => transaction.amountCents)).toEqual([
      -1500, -2500, 5000, -3000, -5200, 9000
    ])
    expect(parsed.transactions.at(-2)).toMatchObject({
      transactionType: 'card_settlement',
      reviewStatus: 'needs_review',
      excludedFromSpending: false
    })
    expect(parsed.transactions.at(-1)).toMatchObject({
      balanceCents: -8200,
      transactionType: 'income'
    })
  })

  it('blocks invalid amount columns and balance mismatches', () => {
    const bothColumns = validPositionedStatement()
    bothColumns.push(item(1, '9,99', 420, 184))
    const invalidAmount = parseAccountPdfText(2, bothColumns)

    expect(invalidAmount.warnings.map((warning) => warning.code)).toContain(
      'ambiguous_amount_column'
    )

    const mismatch = validPositionedStatement({ finalBalance: '1,00' })
    const invalidBalance = parseAccountPdfText(2, mismatch)

    expect(invalidBalance.warnings.map((warning) => warning.code)).toContain(
      'final_balance_mismatch'
    )
  })
})

describe('EvoAccountPdfImporter', () => {
  let directory: string
  let importer: EvoAccountPdfImporter

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sampo-evo-account-pdf-'))
    importer = new EvoAccountPdfImporter()
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('recognises, inspects, and prepares a generated multi-page synthetic statement', async () => {
    const filePath = await writeSyntheticStatementPdf(directory, 'synthetic-account.pdf')

    await expect(importer.canHandle(input(filePath))).resolves.toBe(true)
    const inspection = await importer.inspect(input(filePath))

    expect(inspection).toMatchObject({
      sourceKind: 'evo_account_pdf',
      detectedFormat: 'evo_bankinter_account_pdf_text_v1',
      completedCount: 6,
      pendingCount: 0,
      invalidRowCount: 0,
      canImport: true,
      details: {
        pageCount: 2,
        transactionCount: 6,
        openingBalanceFound: true,
        finalBalanceFound: true,
        balanceContinuityPassed: true,
        tableHeaderDetected: true
      }
    })

    const prepared = await importer.prepare(input(filePath), { accountId })

    expect(prepared.sourceFileName).toBe('synthetic-account.pdf')
    expect(prepared.statementPeriodStart).toBe('2026-01-31')
    expect(prepared.statementPeriodEnd).toBe('2026-02-04')
    expect(prepared.transactions).toHaveLength(6)
    expect(prepared.transactions[0]).toMatchObject({
      sourceRowIndex: 0,
      transactionDate: '2026-01-31',
      valueDate: '2026-01-31',
      amountCents: -1500,
      balanceCents: -11500,
      transactionType: 'expense',
      isPending: false,
      reviewStatus: 'confirmed'
    })
    expect(prepared.transactions[4]).toMatchObject({
      transactionType: 'card_settlement',
      reviewStatus: 'needs_review',
      excludedFromSpending: false
    })
  })

  it('rejects non-PDF and unsupported text PDFs', async () => {
    const nonPdf = join(directory, 'renamed.pdf')
    writeFileSync(nonPdf, 'not a PDF')
    const unsupported = await writeUnsupportedPdf(directory, 'unsupported.pdf')

    await expect(importer.canHandle(input(nonPdf))).resolves.toBe(false)
    await expect(importer.canHandle(input(unsupported))).resolves.toBe(false)

    const inspection = await importer.inspect(input(unsupported))
    expect(inspection.canImport).toBe(false)
    expect(inspection.warnings.some((warning) => warning.blocking)).toBe(true)
  })

  it('does not write during preparation and integrates with the Phase 1 import service', async () => {
    const filePath = await writeSyntheticStatementPdf(directory, 'integration.pdf')
    const database = createDatabase({ path: join(directory, 'integration.sqlite3'), useWal: false })
    const accounts = new AccountRepository(database.connection)
    const service = new ImportService(database.connection)
    const transactions = new TransactionRepository(database.connection)
    const account = accounts.create({ name: 'Synthetic account', kind: 'current' })

    const prepared = await importer.prepare(input(filePath), { accountId: account.id })
    expect(transactions.listForAccount(account.id)).toHaveLength(0)

    const first = service.commitPreparedImport(prepared)
    expect(first.batch.transactionCount).toBe(6)
    expect(first.transactions).toHaveLength(6)
    expect(
      first.transactions.some((transaction) => transaction.originalDescription.includes('SALDO'))
    ).toBe(false)
    expect(first.transactions[0]?.amountCents).toBe(-1500)
    expect(first.transactions[4]).toMatchObject({
      transactionType: 'card_settlement',
      excludedFromSpending: false
    })
    expect(() => service.commitPreparedImport(prepared)).toThrow(DuplicateImportError)

    const rolledBack = service.rollbackCommittedBatch(first.batch.id)
    expect(rolledBack.status).toBe('rolled_back')
    expect(transactions.listForAccount(account.id)).toHaveLength(0)

    const second = service.commitPreparedImport(prepared)
    expect(second.batch.status).toBe('committed')

    database.close()
  })

  it('blocks preparation when balance continuity fails', async () => {
    const filePath = await writeSyntheticStatementPdf(directory, 'bad-balance.pdf', {
      finalBalance: '1,00'
    })

    await expect(importer.prepare(input(filePath), { accountId })).rejects.toThrow(
      BalanceValidationError
    )
  })
})

function validPositionedStatement(options: { finalBalance?: string } = {}): PositionedText[] {
  const items: PositionedText[] = []

  addHeader(items, 1)
  addBalance(items, 1, '**SALDO ANTERIOR EN EUROS**', '100,00-', 191)
  addMovement(items, 1, 184, [
    '31-01-26',
    '1001',
    '31-01-26',
    'SAMPLE BANK STATEMENT',
    '15,00',
    '',
    '115,00-'
  ])
  addMovement(items, 1, 177, [
    '01-02-26',
    '1002',
    '01-02-26',
    'EXAMPLE SERVICES',
    '25,00',
    '',
    '140,00-'
  ])
  addMovement(items, 1, 170, [
    '01-02-26',
    '1003',
    '01-02-26',
    'SAMPLE CREDIT',
    '',
    '50,00',
    '90,00-'
  ])
  items.push(item(1, 'Footer', 28, 79))
  items.push(item(1, '000', 156, 79))
  addHeader(items, 2)
  addBalance(items, 2, 'S A L D O A N T E R( E U R )', '90,00-', 191)
  addMovement(items, 2, 184, [
    '02-02-26',
    '1004',
    '02-02-26',
    'NORTH UTILITIES',
    '30,00',
    '',
    '120,00-'
  ])
  addMovement(items, 2, 177, [
    '03-02-26',
    '1005',
    '03-02-26',
    'RECIBO VISA CLASICA TEST',
    '52,00',
    '',
    '172,00-'
  ])
  addMovement(items, 2, 170, [
    '04-02-26',
    '1006',
    '04-02-26',
    'CITY TRANSFER',
    '',
    '90,00',
    '82,00-'
  ])
  items.push(item(2, 'Footer', 28, 72))
  addBalance(items, 2, '**SALDO FINAL EN EUROS**', options.finalBalance ?? '82,00-', 93)

  return items
}

async function writeSyntheticStatementPdf(
  directory: string,
  fileName: string,
  options: { finalBalance?: string } = {}
): Promise<string> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)

  for (const pageNumber of [1, 2]) {
    const page = pdf.addPage([595, 281])
    page.drawText('Movimientos y saldo de su cuenta', { x: 28.4, y: 211, size: 10, font })
    drawHeader(page, font)

    if (pageNumber === 1) {
      drawText(page, font, '**SALDO ANTERIOR EN EUROS**', 182.3, 191)
      drawText(page, font, '100,00-', 508, 191)
      drawMovement(page, font, 184, [
        '31-01-26',
        '1001',
        '31-01-26',
        'SAMPLE BANK',
        '15,00',
        '',
        '115,00-'
      ])
      drawText(page, font, 'STATEMENT', 255, 184.4)
      drawMovement(page, font, 177, [
        '01-02-26',
        '1002',
        '01-02-26',
        'EXAMPLE SERVICES',
        '25,00',
        '',
        '140,00-'
      ])
      drawMovement(page, font, 170, [
        '01-02-26',
        '1003',
        '01-02-26',
        'SAMPLE CREDIT',
        '',
        '50,00',
        '90,00-'
      ])
    } else {
      drawText(page, font, 'S A L D O', 182.3, 191)
      drawText(page, font, 'A N T E R( E U R )', 218.2, 191)
      drawText(page, font, '90,00-', 508, 191)
      drawMovement(page, font, 184.2, [
        '02-02-26',
        '1004',
        '02-02-26',
        'NORTH UTILITIES',
        '30,00',
        '',
        '120,00-'
      ])
      drawMovement(page, font, 177, [
        '03-02-26',
        '1005',
        '03-02-26',
        'RECIBO VISA CLASICA TEST',
        '52,00',
        '',
        '172,00-'
      ])
      drawMovement(page, font, 170, [
        '04-02-26',
        '1006',
        '04-02-26',
        'CITY TRANSFER',
        '',
        '90,00',
        '82,00'
      ])
      drawText(page, font, '-', 545, 170)
      drawText(page, font, '**SALDO FINAL EN EUROS**', 182.3, 93)
      drawText(page, font, options.finalBalance ?? '82,00-', 508, 93)
    }
  }

  const filePath = join(directory, fileName)
  writeFileSync(filePath, await pdf.save())

  return filePath
}

async function writeUnsupportedPdf(directory: string, fileName: string): Promise<string> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([300, 300])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('Synthetic unrelated PDF', { x: 30, y: 250, size: 12, font })
  const filePath = join(directory, fileName)
  writeFileSync(filePath, await pdf.save())

  return filePath
}

function addHeader(items: PositionedText[], pageNumber: number): void {
  items.push(item(pageNumber, 'Fecha', 28, 199.7))
  items.push(item(pageNumber, 'Referencia', 77, 199.7))
  items.push(item(pageNumber, 'Fecha valor', 128, 199.7))
  items.push(item(pageNumber, 'Descripción', 182, 199.7))
  items.push(item(pageNumber, 'Cargos(-)', 348, 199.7))
  items.push(item(pageNumber, 'Abonos(+)', 402, 199.7))
  items.push(item(pageNumber, 'Saldo', 516, 199.7))
}

function addBalance(
  items: PositionedText[],
  pageNumber: number,
  label: string,
  balance: string,
  y: number
): void {
  items.push(item(pageNumber, label, 182, y))
  items.push(item(pageNumber, balance, 508, y))
}

function addMovement(
  items: PositionedText[],
  pageNumber: number,
  y: number,
  values: [string, string, string, string, string, string, string]
): void {
  const [transactionDate, reference, valueDate, description, debit, credit, balance] = values
  items.push(item(pageNumber, transactionDate, 28, y))
  items.push(item(pageNumber, reference, 77, y))
  items.push(item(pageNumber, valueDate, 128, y))
  items.push(item(pageNumber, description, 182, y))

  if (debit) {
    items.push(item(pageNumber, debit, 365, y))
  }

  if (credit) {
    items.push(item(pageNumber, credit, 425, y))
  }

  items.push(item(pageNumber, balance.replace('-', ''), 508, y))

  if (balance.endsWith('-')) {
    items.push(item(pageNumber, '-', 545, y))
  }
}

function item(pageNumber: number, text: string, x: number, y: number): PositionedText {
  return {
    pageNumber,
    text,
    x,
    y,
    width: text.length * 4,
    height: 7
  }
}

function input(filePath: string): {
  filePath: string
  originalFileName: string
} {
  return {
    filePath,
    originalFileName: filePath.split('/').at(-1) ?? 'synthetic.pdf'
  }
}

function drawHeader(
  page: Parameters<typeof drawText>[0],
  font: Parameters<typeof drawText>[1]
): void {
  drawText(page, font, 'Fecha', 28.4, 199.7)
  drawText(page, font, 'Referencia', 77.4, 199.7)
  drawText(page, font, 'Fecha valor', 128.4, 199.7)
  drawText(page, font, 'Descripción', 182.3, 199.7)
  drawText(page, font, 'Cargos(-)', 347.5, 199.7)
  drawText(page, font, 'Abonos(+)', 402.1, 199.7)
  drawText(page, font, 'Saldo', 516, 199.7)
}

function drawMovement(
  page: Parameters<typeof drawText>[0],
  font: Parameters<typeof drawText>[1],
  y: number,
  values: [string, string, string, string, string, string, string]
): void {
  const [transactionDate, reference, valueDate, description, debit, credit, balance] = values
  drawText(page, font, transactionDate, 28.4, y)
  drawText(page, font, reference, 77.4, y)
  drawText(page, font, valueDate, 128.4, y)
  drawText(page, font, description, 182.3, y)

  if (debit) {
    drawText(page, font, debit, 365, y)
  }

  if (credit) {
    drawText(page, font, credit, 425, y)
  }

  drawText(page, font, balance, 508, y)
}

function drawText(
  page: Parameters<PDFDocument['addPage']>[0] extends never
    ? never
    : ReturnType<PDFDocument['addPage']>,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  text: string,
  x: number,
  y: number
): void {
  page.drawText(text, { x, y, size: 7, font })
}
