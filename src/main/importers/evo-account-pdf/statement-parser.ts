import { ImportParseError } from '../../domain/errors'
import type { NewTransaction } from '../../domain/schemas'
import type { ImportWarning } from '../types'
import type { PositionedText } from './pdf-text-extraction'
import {
  compactSpacedLetters,
  normalizeLabel,
  parseEuropeanDate,
  parseEuropeanMoneyCents
} from './normalization'

export type AccountPdfParseResult = {
  detectedFormat: string
  pageCount: number
  transactions: Omit<NewTransaction, 'accountId'>[]
  warnings: ImportWarning[]
  openingBalanceFound: boolean
  finalBalanceFound: boolean
  balanceContinuityPassed: boolean
  tableHeaderDetected: boolean
  statementPeriodStart?: string
  statementPeriodEnd?: string
}

export type VisualRow = {
  pageNumber: number
  visualRowNumber: number
  y: number
  items: PositionedText[]
}

type StatementMovement = {
  sourceRowIndex: number
  pageNumber: number
  visualRowNumber: number
  transactionDate: string
  valueDate: string
  reference?: string
  description: string
  amountCents: number
  balanceCents: number
}

type BalanceMarker = {
  kind: 'opening' | 'carried' | 'final'
  pageNumber: number
  visualRowNumber: number
  balanceCents: number
}

type ParseState = {
  movements: StatementMovement[]
  balanceMarkers: BalanceMarker[]
  warnings: ImportWarning[]
  tableHeaderDetected: boolean
}

const detectedFormat = 'evo_bankinter_account_pdf_text_v1'
const rowYTolerance = 1.8
const headerYTolerance = 3
const tableBottomY = 85
const dateColumn = { min: 20, max: 70 }
const referenceColumn = { min: 70, max: 125 }
const valueDateColumn = { min: 120, max: 180 }
const descriptionColumn = { min: 175, max: 345 }
const debitColumn = { min: 345, max: 400 }
const creditColumn = { min: 400, max: 480 }
const balanceColumn = { min: 495, max: 560 }

export function parseAccountPdfText(
  pageCount: number,
  items: PositionedText[]
): AccountPdfParseResult {
  const rows = groupVisualRows(items)
  const state: ParseState = {
    movements: [],
    balanceMarkers: [],
    warnings: [],
    tableHeaderDetected: false
  }

  for (const row of rows) {
    const label = normalizedRowText(row)

    if (isTableHeader(row)) {
      state.tableHeaderDetected = true
      continue
    }

    if (!isInsideTransactionTable(row, rows)) {
      continue
    }

    if (isKnownFooterOrMetadata(label) || isBlankRow(row)) {
      continue
    }

    const balanceKind = classifyBalanceRow(label)

    if (balanceKind) {
      parseBalanceMarker(row, balanceKind, state)
      continue
    }

    if (!looksLikeTransactionRow(row)) {
      if (hasNonEmptyTableContent(row)) {
        state.warnings.push(
          safeWarning(row, 'unknown_table_row', 'Unknown row inside the table.', true)
        )
      }
      continue
    }

    const movement = parseMovement(row, state.movements.length)

    if (movement.movement) {
      state.movements.push(movement.movement)
    }

    state.warnings.push(...movement.warnings)
  }

  state.warnings.push(...validateStructureAndBalances(state))

  const blockingWarnings = state.warnings.filter((warning) => warning.blocking)
  const transactionDates = state.movements.map((movement) => movement.transactionDate).sort()

  return {
    detectedFormat,
    pageCount,
    transactions: state.movements.map(mapMovementToTransaction),
    warnings: state.warnings,
    openingBalanceFound: state.balanceMarkers.some((marker) => marker.kind === 'opening'),
    finalBalanceFound: state.balanceMarkers.some((marker) => marker.kind === 'final'),
    balanceContinuityPassed:
      blockingWarnings.every(
        (warning) =>
          ![
            'carried_balance_mismatch',
            'transaction_balance_mismatch',
            'final_balance_mismatch'
          ].includes(warning.code)
      ) && state.movements.length > 0,
    tableHeaderDetected: state.tableHeaderDetected,
    statementPeriodStart: transactionDates[0],
    statementPeriodEnd: transactionDates.at(-1)
  }
}

export function groupVisualRows(items: PositionedText[]): VisualRow[] {
  const groupedByPage = new Map<number, PositionedText[]>()

  for (const item of items) {
    groupedByPage.set(item.pageNumber, [...(groupedByPage.get(item.pageNumber) ?? []), item])
  }

  const rows: VisualRow[] = []

  for (const [pageNumber, pageItems] of [...groupedByPage.entries()].sort(
    ([left], [right]) => left - right
  )) {
    const pageRows: Array<Omit<VisualRow, 'visualRowNumber'>> = []

    for (const item of [...pageItems].sort((left, right) => right.y - left.y || left.x - right.x)) {
      const row = pageRows.find((candidate) => Math.abs(candidate.y - item.y) <= rowYTolerance)

      if (row) {
        row.items.push(item)
        row.y = averageY(row.items)
      } else {
        pageRows.push({
          pageNumber,
          y: item.y,
          items: [item]
        })
      }
    }

    pageRows
      .sort((left, right) => right.y - left.y)
      .forEach((row, index) => {
        rows.push({
          ...row,
          visualRowNumber: index + 1,
          items: row.items.sort((left, right) => left.x - right.x)
        })
      })
  }

  return rows
}

function parseMovement(
  row: VisualRow,
  transactionIndex: number
): {
  movement?: StatementMovement
  warnings: ImportWarning[]
} {
  const warnings: ImportWarning[] = []
  const cells = assignColumns(row)
  let transactionDate: string | undefined
  let valueDate: string | undefined
  let amountCents: number | undefined
  let balanceCents: number | undefined

  try {
    transactionDate = parseEuropeanDate(cells.transactionDate)
  } catch {
    warnings.push(
      safeWarning(
        row,
        'invalid_date',
        'Transaction row has an invalid date.',
        true,
        'transactionDate'
      )
    )
  }

  try {
    valueDate = parseEuropeanDate(cells.valueDate)
  } catch {
    warnings.push(
      safeWarning(
        row,
        'invalid_date',
        'Transaction row has an invalid value date.',
        true,
        'valueDate'
      )
    )
  }

  if (!cells.description) {
    warnings.push(
      safeWarning(
        row,
        'blank_description',
        'Transaction row has a blank description.',
        true,
        'originalDescription'
      )
    )
  }

  try {
    amountCents = parseSignedMovementAmount(cells.debit, cells.credit)
  } catch (error) {
    warnings.push(
      safeWarning(
        row,
        warningCodeForAmountError(error),
        'Transaction row has an invalid debit or credit amount.',
        true,
        'amountCents'
      )
    )
  }

  try {
    balanceCents = parseEuropeanMoneyCents(cells.balance)
  } catch {
    warnings.push(
      safeWarning(
        row,
        'missing_resulting_balance',
        'Transaction row is missing a valid resulting balance.',
        true,
        'balanceCents'
      )
    )
  }

  if (
    !transactionDate ||
    !valueDate ||
    !cells.description ||
    amountCents === undefined ||
    balanceCents === undefined
  ) {
    return { warnings }
  }

  return {
    movement: {
      sourceRowIndex: transactionIndex,
      pageNumber: row.pageNumber,
      visualRowNumber: row.visualRowNumber,
      transactionDate,
      valueDate,
      reference: cells.reference || undefined,
      description: cells.description,
      amountCents,
      balanceCents
    },
    warnings
  }
}

function parseBalanceMarker(row: VisualRow, kind: BalanceMarker['kind'], state: ParseState): void {
  const balanceText = row.items
    .filter((item) => item.x >= balanceColumn.min && item.x <= balanceColumn.max)
    .map((item) => item.text)
    .join('')

  try {
    state.balanceMarkers.push({
      kind,
      pageNumber: row.pageNumber,
      visualRowNumber: row.visualRowNumber,
      balanceCents: parseEuropeanMoneyCents(balanceText)
    })
  } catch {
    state.warnings.push(
      safeWarning(
        row,
        'missing_resulting_balance',
        'Balance marker has no valid balance.',
        true,
        'balanceCents'
      )
    )
  }
}

function validateStructureAndBalances(state: ParseState): ImportWarning[] {
  const warnings: ImportWarning[] = []
  const opening = state.balanceMarkers.find((marker) => marker.kind === 'opening')
  const final = [...state.balanceMarkers].reverse().find((marker) => marker.kind === 'final')

  if (!state.tableHeaderDetected) {
    warnings.push({
      code: 'unsupported_layout',
      message: 'Supported transaction table header was not found.',
      blocking: true
    })
  }

  if (!opening) {
    warnings.push({
      code: 'missing_opening_balance',
      message: 'Opening balance was not found.',
      blocking: false
    })
  }

  if (!final) {
    warnings.push({
      code: 'missing_final_balance',
      message: 'Final balance was not found.',
      blocking: false
    })
  }

  if (state.movements.length === 0) {
    warnings.push({
      code: 'unsupported_layout',
      message: 'No supported account statement transactions were found.',
      blocking: true
    })
  }

  let previousBalance = opening?.balanceCents

  for (const movement of state.movements) {
    if (
      previousBalance !== undefined &&
      previousBalance + movement.amountCents !== movement.balanceCents
    ) {
      warnings.push({
        pageNumber: movement.pageNumber,
        visualRowNumber: movement.visualRowNumber,
        sourceRowNumber: movement.sourceRowIndex + 1,
        code: 'transaction_balance_mismatch',
        message: 'Transaction balance continuity failed.',
        blocking: true
      })
    }

    previousBalance = movement.balanceCents
  }

  for (const marker of state.balanceMarkers.filter((candidate) => candidate.kind === 'carried')) {
    const previousPageMovement = [...state.movements]
      .filter((movement) => movement.pageNumber < marker.pageNumber)
      .at(-1)

    if (previousPageMovement && previousPageMovement.balanceCents !== marker.balanceCents) {
      warnings.push(
        safeWarning(
          marker,
          'carried_balance_mismatch',
          'Carried balance does not match previous page balance.',
          true
        )
      )
    }
  }

  if (final && previousBalance !== undefined && final.balanceCents !== previousBalance) {
    warnings.push(
      safeWarning(
        final,
        'final_balance_mismatch',
        'Final balance does not match last transaction balance.',
        true
      )
    )
  }

  return warnings
}

function mapMovementToTransaction(movement: StatementMovement): Omit<NewTransaction, 'accountId'> {
  const isCardSettlement = isVisaSettlementDescription(movement.description)

  return {
    sourceRowIndex: movement.sourceRowIndex,
    transactionDate: movement.transactionDate,
    valueDate: movement.valueDate,
    reference: movement.reference,
    originalDescription: movement.description,
    amountCents: movement.amountCents,
    balanceCents: movement.balanceCents,
    currency: 'EUR',
    transactionType: isCardSettlement
      ? 'card_settlement'
      : movement.amountCents > 0
        ? 'income'
        : 'expense',
    isPending: false,
    excludedFromSpending: false,
    reviewStatus: isCardSettlement ? 'needs_review' : 'confirmed'
  }
}

function assignColumns(row: VisualRow): {
  transactionDate: string
  reference: string
  valueDate: string
  description: string
  debit: string
  credit: string
  balance: string
} {
  const cells = {
    transactionDate: [] as string[],
    reference: [] as string[],
    valueDate: [] as string[],
    description: [] as string[],
    debit: [] as string[],
    credit: [] as string[],
    balance: [] as string[]
  }

  for (const item of row.items) {
    const text = item.text

    if (inColumn(item.x, dateColumn)) {
      cells.transactionDate.push(text)
    } else if (inColumn(item.x, referenceColumn)) {
      cells.reference.push(text)
    } else if (inColumn(item.x, valueDateColumn)) {
      cells.valueDate.push(text)
    } else if (inColumn(item.x, descriptionColumn)) {
      cells.description.push(text)
    } else if (inColumn(item.x, debitColumn)) {
      cells.debit.push(text)
    } else if (inColumn(item.x, creditColumn)) {
      cells.credit.push(text)
    } else if (inColumn(item.x, balanceColumn)) {
      cells.balance.push(text)
    }
  }

  return {
    transactionDate: cells.transactionDate.join(' ').trim(),
    reference: cells.reference.join(' ').trim(),
    valueDate: cells.valueDate.join(' ').trim(),
    description: cells.description.join(' ').trim(),
    debit: cells.debit.join('').trim(),
    credit: cells.credit.join('').trim(),
    balance: cells.balance.join('').trim()
  }
}

function parseSignedMovementAmount(debit: string, credit: string): number {
  const hasDebit = debit.trim().length > 0
  const hasCredit = credit.trim().length > 0

  if (hasDebit && hasCredit) {
    throw new ImportParseError('Both debit and credit are populated')
  }

  if (!hasDebit && !hasCredit) {
    throw new ImportParseError('Missing transaction amount')
  }

  const amount = parseEuropeanMoneyCents(hasDebit ? debit : credit)

  if (amount < 0) {
    throw new ImportParseError('Movement amount column contains an unexpected sign')
  }

  return hasDebit ? -amount : amount
}

function warningCodeForAmountError(error: unknown): ImportWarning['code'] {
  if (
    error instanceof ImportParseError &&
    error.message === 'Both debit and credit are populated'
  ) {
    return 'ambiguous_amount_column'
  }

  if (error instanceof ImportParseError && error.message === 'Missing transaction amount') {
    return 'missing_transaction_amount'
  }

  if (error instanceof ImportParseError && error.message === 'Zero amount') {
    return 'zero_amount'
  }

  return 'invalid_amount'
}

function isTableHeader(row: VisualRow): boolean {
  const label = normalizedRowText(row)

  return (
    Math.abs(row.items[0]?.y ?? 0) > 0 &&
    label.includes('FECHA') &&
    label.includes('REFERENCIA') &&
    label.includes('FECHA VALOR') &&
    label.includes('DESCRIPCION') &&
    label.includes('CARGOS') &&
    label.includes('ABONOS') &&
    label.includes('SALDO')
  )
}

function isInsideTransactionTable(row: VisualRow, rows: VisualRow[]): boolean {
  const pageHeaders = rows.filter(
    (candidate) => candidate.pageNumber === row.pageNumber && isTableHeader(candidate)
  )
  const header = pageHeaders.find((candidate) => row.y < candidate.y - headerYTolerance)

  return Boolean(header && row.y >= tableBottomY)
}

function classifyBalanceRow(label: string): BalanceMarker['kind'] | undefined {
  const compactLabel = compactSpacedLetters(label)
  const withoutSpaces = label.replace(/\s+/g, '')

  if (compactLabel.includes('SALDO ANTERIOR')) {
    return 'opening'
  }

  if (compactLabel.includes('SALDO FINAL')) {
    return 'final'
  }

  if (
    (compactLabel.includes('SALDO') && compactLabel.includes('ANTER')) ||
    withoutSpaces.includes('SALDOANTER')
  ) {
    return 'carried'
  }

  return undefined
}

function looksLikeTransactionRow(row: VisualRow): boolean {
  const cells = assignColumns(row)

  return Boolean(
    cells.transactionDate || cells.valueDate || cells.debit || cells.credit || cells.balance
  )
}

function hasNonEmptyTableContent(row: VisualRow): boolean {
  return row.items.some((item) => item.text.trim().length > 0)
}

function isBlankRow(row: VisualRow): boolean {
  return !hasNonEmptyTableContent(row)
}

function isKnownFooterOrMetadata(label: string): boolean {
  return (
    label.includes('PAGINA') ||
    label.includes('BANCO') ||
    label.includes('IBAN') ||
    label.includes('BIC') ||
    label.includes('ENTIDAD') ||
    label.includes('OFICINA') ||
    label.includes('DC') ||
    label.includes('CUENTA')
  )
}

function normalizedRowText(row: VisualRow): string {
  return normalizeLabel(row.items.map((item) => item.text).join(' '))
}

function isVisaSettlementDescription(description: string): boolean {
  return normalizeLabel(description).includes('RECIBO VISA CLASICA')
}

function inColumn(x: number, column: { min: number; max: number }): boolean {
  return x >= column.min && x < column.max
}

function averageY(items: PositionedText[]): number {
  return items.reduce((sum, item) => sum + item.y, 0) / items.length
}

function safeWarning(
  row: Pick<VisualRow, 'pageNumber' | 'visualRowNumber'>,
  code: ImportWarning['code'],
  message: string,
  blocking: boolean,
  field?: string
): ImportWarning {
  return {
    pageNumber: row.pageNumber,
    visualRowNumber: row.visualRowNumber,
    code,
    message,
    field,
    blocking
  }
}
