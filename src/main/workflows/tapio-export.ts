import type { Database } from 'better-sqlite3'
import { dialog, type BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { z } from 'zod'
import { tapioExportInputSchema, type TapioExportResult } from '../../shared/dtos'

const rowSchema = z.object({
  transaction_date: z.string(),
  merchant: z.string(),
  description: z.string(),
  amount_cents: z.number().int().safe(),
  currency: z.string(),
  sampo_category: z.string(),
  source_account: z.string(),
  source_transaction_id: z.string().uuid()
})
type ExportRow = z.infer<typeof rowSchema>
const headers = [
  'transaction_date',
  'merchant',
  'description',
  'amount',
  'currency',
  'sampo_category',
  'source_account',
  'source_transaction_id',
  'source_system'
]

// Export eligibility only: these checks never classify or modify a transaction.
function eligible(row: ExportRow): boolean {
  const text = `${row.merchant} ${row.description} ${row.sampo_category}`
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
  if (
    /\b(hotels?|hostels?|hostal|accommodation|alojamiento|airbnb|booking\.com|hospedaje)\b/.test(
      text
    )
  )
    return false
  if (/\bhsl\b/.test(text)) return false
  const merchant = row.merchant.trim().toLowerCase()
  if (/\b(airport|aeropuerto|avolta|parking|taxi|autopista)\b/.test(merchant)) return false
  if (
    [
      'finnair',
      'iberia',
      'vr',
      'vr matkalla',
      'trainline',
      'onnibus',
      'matkahuolto',
      'alsa'
    ].includes(merchant)
  )
    return true
  // A broad Travel/Public transport category alone does not establish a mode.
  return /^(flights?|trains?|bus|buses)$/i.test(row.sampo_category.trim())
}
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}
function amount(cents: number): string {
  const magnitude = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`
}
export type TapioExportIo = {
  choosePath: () => Promise<string | undefined>
  write: (path: string, csv: string) => Promise<void>
}
export async function exportSelectedForTapio(
  database: Database,
  input: unknown,
  window?: BrowserWindow,
  io?: TapioExportIo
): Promise<TapioExportResult> {
  const ids = [...new Set(tapioExportInputSchema.parse(input).transactionIds)]
  const rows = rowSchema.array().parse(
    database
      .prepare(
        `
    SELECT t.transaction_date, coalesce(m.name, '') AS merchant,
      t.original_description AS description, t.amount_cents, t.currency,
      coalesce(c.name, '') AS sampo_category, a.name AS source_account,
      t.id AS source_transaction_id
    FROM transactions t
    JOIN accounts a ON a.id=t.account_id
    JOIN import_batches b ON b.id=t.import_batch_id
    LEFT JOIN transaction_classifications cl ON cl.transaction_id=t.id
    LEFT JOIN merchants m ON m.id=cl.merchant_id
    LEFT JOIN categories c ON c.id=cl.category_id
    WHERE t.id IN (${ids.map(() => '?').join(',')}) AND b.status='committed'
  `
      )
      .all(...ids)
  )
  const byId = new Map(rows.map((row) => [row.source_transaction_id, row]))
  const selected = ids.flatMap((id) => {
    const row = byId.get(id)
    return row && eligible(row) ? [row] : []
  })
  const skippedCount = ids.length - selected.length
  if (!selected.length) return { exportedCount: 0, skippedCount, cancelled: false }
  const csv =
    [
      headers.join(','),
      ...selected.map((row) =>
        [
          row.transaction_date,
          row.merchant,
          row.description,
          amount(row.amount_cents),
          row.currency,
          row.sampo_category,
          row.source_account,
          row.source_transaction_id,
          'SAMPO'
        ]
          .map(csvCell)
          .join(',')
      )
    ].join('\r\n') + '\r\n'
  const options = {
    title: 'Export selected for Tapio',
    defaultPath: 'sampo-tapio.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  }
  const path = io
    ? await io.choosePath()
    : await (window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)).then(
        (result) => (result.canceled ? undefined : result.filePath)
      )
  if (!path) return { exportedCount: 0, skippedCount, cancelled: true }
  if (io) await io.write(path, csv)
  else await writeFile(path, csv, { encoding: 'utf8', mode: 0o600 })
  return { exportedCount: selected.length, skippedCount, cancelled: false }
}
