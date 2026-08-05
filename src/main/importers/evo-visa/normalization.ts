import { ImportParseError } from '../../domain/errors'

const excelEpoch = Date.UTC(1899, 11, 30)
const dayMs = 24 * 60 * 60 * 1000

export function excelSerialDateToIsoDate(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ImportParseError('Invalid Excel serial date')
  }

  const wholeDays = Math.trunc(value)

  if (wholeDays <= 0) {
    throw new ImportParseError('Invalid Excel serial date')
  }

  const date = new Date(excelEpoch + wholeDays * dayMs)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()

  if (year < 2000 || year > 2100) {
    throw new ImportParseError('Excel serial date is outside the supported range')
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseVisaAmountCents(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ImportParseError('Invalid amount')
    }

    return decimalStringToCents(String(value))
  }

  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/\s*€$/, '')

    if (!trimmed) {
      throw new ImportParseError('Invalid amount')
    }

    const normalized = normalizeAmountString(trimmed)
    return decimalStringToCents(normalized)
  }

  throw new ImportParseError('Invalid amount')
}

function normalizeAmountString(value: string): string {
  const negative = value.startsWith('-') || value.endsWith('-')
  const unsigned = value.replace(/^-/, '').replace(/-$/, '')

  if (!/^\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?$|^\d+(?:[.,]\d{1,2})?$/.test(unsigned)) {
    throw new ImportParseError('Malformed amount')
  }

  const lastComma = unsigned.lastIndexOf(',')
  const lastDot = unsigned.lastIndexOf('.')
  const decimalSeparator = lastComma > lastDot ? ',' : '.'
  const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
  const withoutThousands = unsigned.split(thousandsSeparator).join('')
  const normalized = withoutThousands.replace(decimalSeparator, '.')

  return `${negative ? '-' : ''}${normalized}`
}

function decimalStringToCents(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value)

  if (!match) {
    throw new ImportParseError('Malformed amount')
  }

  const [, sign, euros, cents = ''] = match
  const amount = Number(euros) * 100 + Number(cents.padEnd(2, '0'))
  const signedAmount = sign === '-' ? -amount : amount

  if (signedAmount === 0) {
    throw new ImportParseError('Zero amount')
  }

  return signedAmount
}
