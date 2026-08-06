import { ImportParseError } from '../../domain/errors'

const minStatementYear = 2000
const maxStatementYear = 2100

export function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9()+*/ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

export function compactSpacedLetters(value: string): string {
  const words = value.split(/\s+/)
  const compacted: string[] = []
  let index = 0

  while (index < words.length) {
    if (/^[A-Z]$/.test(words[index] ?? '')) {
      const letters: string[] = []

      while (/^[A-Z]$/.test(words[index] ?? '')) {
        letters.push(words[index] ?? '')
        index += 1
      }

      compacted.push(letters.join(''))
    } else {
      compacted.push(words[index] ?? '')
      index += 1
    }
  }

  return compacted.join(' ')
}

export function parseEuropeanDate(value: string, statementYear?: number): string {
  const match = /^(\d{2})[-/](\d{2})[-/](\d{2}|\d{4})$/.exec(value.trim())

  if (!match) {
    throw new ImportParseError('Invalid account statement date')
  }

  const [, dayText, monthText, yearText] = match
  const day = Number(dayText)
  const month = Number(monthText)
  const year =
    yearText.length === 4 ? Number(yearText) : expandTwoDigitYear(Number(yearText), statementYear)

  if (year < minStatementYear || year > maxStatementYear) {
    throw new ImportParseError('Account statement date is outside the supported range')
  }

  const utc = Date.UTC(year, month - 1, day)
  const date = new Date(utc)

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ImportParseError('Impossible account statement date')
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseEuropeanMoneyCents(value: string): number {
  const trimmed = value.trim().replace(/\s*€$/, '')

  if (!trimmed) {
    throw new ImportParseError('Missing amount')
  }

  const signCount = (trimmed.match(/-/g) ?? []).length

  if (signCount > 1) {
    throw new ImportParseError('Ambiguous amount sign')
  }

  const negative = trimmed.startsWith('-') || trimmed.endsWith('-')
  const unsigned = trimmed.replace(/^-/, '').replace(/-$/, '')

  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/.test(unsigned)) {
    throw new ImportParseError('Malformed European amount')
  }

  const [eurosText, centsText] = unsigned.split(',')
  const euros = eurosText.replace(/\./g, '')
  const cents = Number(euros) * 100 + Number(centsText)
  const signed = negative ? -cents : cents

  if (signed === 0) {
    throw new ImportParseError('Zero amount')
  }

  return signed
}

function expandTwoDigitYear(twoDigitYear: number, statementYear?: number): number {
  if (statementYear && statementYear >= minStatementYear && statementYear <= maxStatementYear) {
    const century = Math.trunc(statementYear / 100) * 100
    const candidates = [
      century - 100 + twoDigitYear,
      century + twoDigitYear,
      century + 100 + twoDigitYear
    ]
    const closest = candidates
      .filter((year) => year >= minStatementYear && year <= maxStatementYear)
      .sort((left, right) => Math.abs(left - statementYear) - Math.abs(right - statementYear))[0]

    if (closest) {
      return closest
    }
  }

  return 2000 + twoDigitYear
}
