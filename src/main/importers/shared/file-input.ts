import { basename } from 'path'
import { statSync } from 'fs'
import type { ImportFileInput } from '../types'
import { UnsupportedImportFormatError } from '../../domain/errors'

export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024

export function validateImportFileInput(input: ImportFileInput): {
  filePath: string
  sourceFileName: string
  size: number
} {
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

  if (stats.size > MAX_WORKBOOK_BYTES) {
    throw new UnsupportedImportFormatError('Import file exceeds the supported workbook size limit')
  }

  return {
    filePath: input.filePath,
    sourceFileName,
    size: stats.size
  }
}
