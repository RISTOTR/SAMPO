export function eurosToCents(amount: string | number): number {
  const value = typeof amount === 'number' ? amount.toFixed(2) : amount
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value)

  if (!match) {
    throw new Error('Amount must be a plain decimal value with up to two fractional digits')
  }

  const [, sign, euros, cents = ''] = match
  const normalizedCents = cents.padEnd(2, '0')
  const absolute = Number(euros) * 100 + Number(normalizedCents)

  return sign === '-' ? -absolute : absolute
}

export function centsToDisplayAmount(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error('Cent amount must be an integer')
  }

  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const euros = Math.floor(absolute / 100)
  const remainder = String(absolute % 100).padStart(2, '0')

  return `${sign}${euros}.${remainder}`
}
