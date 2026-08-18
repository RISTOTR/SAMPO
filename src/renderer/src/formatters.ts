export function formatCents(value: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency
  }).format(value / 100)
}

export function formatDate(value?: string): string {
  if (!value) {
    return ''
  }

  const [year, month, day] = value.split('-')

  return `${day}/${month}/${year}`
}

export function formatDateTime(value?: string): string {
  if (!value) {
    return ''
  }

  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value))
}

export function sourceLabel(value: string): string {
  if (value === 'evo_visa_xls') {
    return 'Visa XLS'
  }

  if (value === 'evo_account_pdf') {
    return 'Account PDF'
  }

  if (value === 'evo_account_excel') {
    return 'Account Excel'
  }

  return 'Unknown'
}
