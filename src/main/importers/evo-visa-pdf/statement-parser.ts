import type { NewTransaction } from '../../domain/schemas'
import type { ImportWarning } from '../types'
import type { PositionedText } from '../evo-account-pdf/pdf-text-extraction'
import { groupVisualRows, type VisualRow } from '../evo-account-pdf/statement-parser'
import { normalizeLabel, parseEuropeanDate } from '../evo-account-pdf/normalization'

export const visaPdfFormat = 'bankinter_visa_pdf_charges_credits_v1'
export type VisaPdfParseResult = {
  recognized: boolean
  pageCount: number
  transactions: Omit<NewTransaction, 'accountId'>[]
  warnings: ImportWarning[]
  totalsVerified: boolean
  statementPeriodStart?: string
  statementPeriodEnd?: string
}

// The observed portrait statement has a date, masked card identifier, concept,
// charges (EUR) and credits (EUR). Column signs are authoritative, never guessed.
const dateMin = 38
const cardMin = 92
const conceptMin = 168
const chargeMin = 390
const creditMin = 478
const tableRight = 555
const footerTop = 40

export function parseVisaPdfText(pageCount: number, items: PositionedText[]): VisaPdfParseResult {
  const rows = groupVisualRows(items)
  const warnings: ImportWarning[] = []
  const transactions: Omit<NewTransaction, 'accountId'>[] = []
  let recognized = false
  let commissionSection = false
  let totalFound = false
  let totalsVerified = false
  let charges = 0
  let credits = 0
  const cards = new Set<string>()
  let sourceRowIndex = 0
  let lastMovement: { row: VisualRow; transaction: Omit<NewTransaction, 'accountId'> } | undefined
  const warn = (code: ImportWarning['code'], message: string, row?: VisualRow): void => {
    warnings.push({
      code,
      message,
      blocking: true,
      pageNumber: row?.pageNumber,
      visualRowNumber: row?.visualRowNumber
    })
  }

  for (let page = 1; page <= pageCount; page++) {
    const pageRows = rows.filter((row) => row.pageNumber === page)
    const headers = pageRows.filter((row) => isHeader(row, pageRows))
    const repaymentAppendix =
      totalFound &&
      headers.length === 0 &&
      pageRows.some(
        (row) => normalizeLabel(rowText(row)) === 'DETALLE DE IMPORTES RECOBRADOS A CIERRE DEL MES'
      )
    if (!headers.length && !repaymentAppendix) {
      warn(
        'unsupported_layout',
        'A Visa PDF page has no supported movement table or repayment appendix.'
      )
    }
    if (headers.length) recognized = true
    const header = headers[0]
    const pageMarkers = pageRows
      .filter((row) => row.y < footerTop)
      .flatMap((row) => row.items)
      .map((item) => /^(\d+)\s+de\s+(\d+)$/i.exec(item.text.trim()))
      .filter((match) => match !== null)
    if (
      pageMarkers.length !== 1 ||
      Number(pageMarkers[0]![1]) !== page ||
      Number(pageMarkers[0]![2]) !== pageCount
    ) {
      warn('unsupported_layout', 'Visa PDF page numbering is missing, incomplete or out of order.')
    }
    if (pageRows.some((row) => normalizeLabel(rowText(row)).includes('MOVIMIENTOS PENDIENTES'))) {
      warn(
        'unsupported_layout',
        'Pending movement sections are not supported by this settled-statement PDF layout.'
      )
    }
    if (repaymentAppendix || !header) continue
    lastMovement = undefined
    for (const row of pageRows) {
      const dateText = column(row, dateMin, cardMin)
      if (row.y > header.y) continue
      if (headers.includes(row)) {
        if (totalFound) {
          const isCommission = pageRows.some(
            (title) =>
              title.y > row.y &&
              title.y <= row.y + 65 &&
              normalizeLabel(rowText(title)) ===
                'CARGOS Y ABONOS DEL MES CORRESPONDIENTES A SU TARJETA POR COMISIONES'
          )
          if (!isCommission || commissionSection) {
            warn('unsupported_layout', 'An unsupported additional movement section was found.', row)
          }
          commissionSection = isCommission
          totalFound = false
          totalsVerified = false
          charges = 0
          credits = 0
        } else if (row !== header) {
          warn('missing_final_balance', 'A movement section is missing its total.', row)
        }
        lastMovement = undefined
        continue
      }
      if (row.y < footerTop) {
        if (/^\d{2}[-/]\d{2}[-/]\d{2,4}$/.test(dateText))
          warn('unsupported_layout', 'A movement extends outside the supported table.', row)
        continue
      }
      const concept = column(row, conceptMin, chargeMin)
      const total = normalizeLabel(concept) === 'SUMA TOTAL'
      if (totalFound) {
        // Payment/interest summaries below the final total are not card movements.
        if (total || /^\d{2}[-/]\d{2}[-/]\d{2,4}$/.test(dateText)) {
          warn(
            'unsupported_layout',
            'Additional movement tables or totals after the final total are not supported.',
            row
          )
        }
        continue
      }
      if (total) {
        totalFound = true
        try {
          const chargeTotal = unsignedCents(column(row, chargeMin, creditMin), true)
          const creditTotal = unsignedCents(column(row, creditMin, tableRight), true)
          totalsVerified = charges === chargeTotal && credits === creditTotal
          if (!totalsVerified)
            warn(
              'final_balance_mismatch',
              'Visa charge/credit totals do not match the parsed movements.',
              row
            )
        } catch {
          warn('invalid_amount', 'Visa statement totals are missing or invalid.', row)
        }
        lastMovement = undefined
        continue
      }
      if (
        row.items.some(
          (item) => item.x < dateMin || item.x >= tableRight || item.x + item.width > tableRight + 3
        )
      ) {
        warn('unsupported_layout', 'Unexpected content outside the Visa movement columns.', row)
        continue
      }
      const charge = column(row, chargeMin, creditMin)
      const credit = column(row, creditMin, tableRight)
      const card = column(row, cardMin, conceptMin)
      if (
        !dateText &&
        !card &&
        !charge &&
        !credit &&
        concept &&
        lastMovement &&
        lastMovement.row.pageNumber === row.pageNumber &&
        lastMovement.row.y - row.y <= 16
      ) {
        lastMovement.transaction.originalDescription += ` ${concept}`
        lastMovement.row = row
        continue
      }
      if (
        !dateText ||
        !concept ||
        !/^\d{4}$/.test(card) ||
        (Boolean(charge) === Boolean(credit) && !(commissionSection && !charge && !credit))
      ) {
        warn(
          'unknown_table_row',
          'A Visa movement has missing or ambiguous date, concept, card or amount columns.',
          row
        )
        lastMovement = undefined
        continue
      }
      let transactionDate: string
      let amountCents: number
      try {
        transactionDate = parseEuropeanDate(dateText)
      } catch {
        warn('invalid_date', 'Visa movement date is invalid.', row)
        continue
      }
      cards.add(card)
      // The bank prints uncharged commissions with blank amount cells.
      // They contribute zero to the separately verified commission totals.
      if (commissionSection && !charge && !credit) {
        lastMovement = undefined
        continue
      }
      try {
        const magnitude = unsignedCents(charge || credit)
        amountCents = charge ? -magnitude : magnitude
      } catch {
        warn('invalid_amount', 'Visa movement amount is invalid or has an ambiguous sign.', row)
        continue
      }
      cards.add(card)
      charges += charge ? -amountCents : 0
      credits += credit ? amountCents : 0
      if (!Number.isSafeInteger(charges) || !Number.isSafeInteger(credits)) {
        warn('invalid_amount', 'Visa movement total exceeds the supported integer-cent range.', row)
      }
      const transaction: Omit<NewTransaction, 'accountId'> = {
        sourceRowIndex: sourceRowIndex++,
        transactionDate,
        originalDescription: concept,
        amountCents,
        currency: 'EUR',
        transactionType: charge ? 'expense' : 'refund',
        isPending: false,
        excludedFromSpending: false,
        reviewStatus: 'confirmed'
      }
      transactions.push(transaction)
      lastMovement = { row, transaction }
    }
  }
  if (cards.size > 1)
    warn(
      'unsupported_layout',
      'This PDF contains multiple card identifiers; import a statement for one card.'
    )
  if (!totalFound) warn('missing_final_balance', 'The final Visa movement total was not found.')
  if (!transactions.length) warn('missing_section', 'No completed Visa movements were found.')
  const dates = transactions.map((transaction) => transaction.transactionDate).sort()
  return {
    recognized,
    pageCount,
    transactions,
    warnings,
    totalsVerified,
    statementPeriodStart: dates[0],
    statementPeriodEnd: dates.at(-1)
  }
}

function isHeader(row: VisualRow, rows: VisualRow[]): boolean {
  const nearby = rows.filter((other) => other.y >= row.y && other.y <= row.y + 25)
  const above = nearby.flatMap((other) => other.items)
  return (
    normalizeLabel(column(row, dateMin, cardMin)) === 'OPERACION' &&
    normalizeLabel(column(row, conceptMin, chargeMin)) === 'CONCEPTO' &&
    normalizeLabel(column(row, chargeMin, creditMin)) === 'IMPORTE' &&
    normalizeLabel(column(row, creditMin, tableRight)) === 'IMPORTE' &&
    above.some(
      (item) => item.x >= dateMin && item.x < cardMin && normalizeLabel(item.text) === 'FECHA'
    ) &&
    above.some(
      (item) =>
        item.x >= cardMin && item.x < conceptMin && normalizeLabel(item.text).includes('TARJETA')
    ) &&
    above.some(
      (item) =>
        item.x >= chargeMin &&
        item.x < creditMin &&
        /^CARGOS\s*\(€\)$/.test(item.text.trim().toUpperCase())
    ) &&
    above.some(
      (item) =>
        item.x >= creditMin &&
        item.x < tableRight &&
        /^ABONOS\s*\(€\)$/.test(item.text.trim().toUpperCase())
    )
  )
}

function column(row: VisualRow, min: number, max: number): string {
  return row.items
    .filter((item) => item.x >= min && item.x < max)
    .map((item) => item.text.trim())
    .join(' ')
    .trim()
}
function rowText(row: VisualRow): string {
  return row.items.map((item) => item.text).join(' ')
}
function unsignedCents(value: string, allowZero = false): number {
  if (!value && allowZero) return 0
  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/.test(value))
    throw new Error('Invalid unsigned EUR amount')
  const [whole, fractional] = value.split(',')
  const cents = Number(whole!.replace(/\./g, '')) * 100 + Number(fractional)
  if (!Number.isSafeInteger(cents) || (!allowZero && cents === 0))
    throw new Error('Invalid EUR cents')
  return cents
}
