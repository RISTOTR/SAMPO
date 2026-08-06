import { basename } from 'path'
import { statSync } from 'fs'
import type { ImportFileInput } from '../types'
import { UnsupportedImportFormatError } from '../../domain/errors'

export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024
export const MAX_PDF_BYTES = 10 * 1024 * 1024

export function validateImportFileInput(
  input: ImportFileInput,
  options: {
    maxBytes?: number
    kindLabel?: string
  } = {}
): {
  filePath: string
  sourceFileName: string
  size: number
} {
  const maxBytes = options.maxBytes ?? MAX_WORKBOOK_BYTES
  const kindLabel = options.kindLabel ?? 'workbook'
  const sourceFileName = basename(input.originalFileName)

  if (!sourceFileName.trim()) {
    throw new UnsupportedImportFormatError('Import file name is required')
  }

  let stats

  try {
    stats = statSync(input.filePath)
  } catch (error) {
    throw new UnsupportedImportFormatError('Import file is missing or unreadable', error)
  }

  if (!stats.isFile()) {
    throw new UnsupportedImportFormatError('Import path must point to a regular file')
  }

  if (stats.size > maxBytes) {
    throw new UnsupportedImportFormatError(
      `Import file exceeds the supported ${kindLabel} size limit`
    )
  }

  return {
    filePath: input.filePath,
    sourceFileName,
    size: stats.size
  }
}
