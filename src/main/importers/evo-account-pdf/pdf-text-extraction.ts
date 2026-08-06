import { readFileSync } from 'fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  EncryptedPdfError,
  MissingPdfTextLayerError,
  PdfParseError,
  UnsupportedPdfFormatError
} from '../../domain/errors'

export type PositionedText = {
  pageNumber: number
  text: string
  x: number
  y: number
  width: number
  height: number
}

export type ExtractedPdfText = {
  pageCount: number
  items: PositionedText[]
}

type PdfTextItem = {
  str: string
  transform: number[]
  width: number
  height: number
}

export async function extractPositionedTextFromPdf(filePath: string): Promise<ExtractedPdfText> {
  const buffer = readFileSync(filePath, { encoding: null, flag: 'r' })

  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new UnsupportedPdfFormatError('File does not have a PDF signature')
  }

  let document: pdfjs.PDFDocumentProxy

  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      useSystemFonts: false,
      isEvalSupported: false,
      stopAtErrors: true
    }).promise
  } catch (error) {
    if (isPdfPasswordError(error)) {
      throw new EncryptedPdfError(undefined, error)
    }

    throw new PdfParseError(undefined, error)
  }

  const items: PositionedText[] = []

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent({ disableNormalization: false })

    for (const item of content.items) {
      if (!isTextItem(item)) {
        continue
      }

      const text = normalizePdfText(item.str)

      if (!text) {
        continue
      }

      const [, , , , x, y] = item.transform

      items.push({
        pageNumber,
        text,
        x,
        y,
        width: item.width,
        height: item.height
      })
    }
  }

  if (items.length === 0) {
    throw new MissingPdfTextLayerError()
  }

  return {
    pageCount: document.numPages,
    items
  }
}

export function normalizePdfText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTextItem(value: unknown): value is PdfTextItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'str' in value &&
    'transform' in value &&
    'width' in value &&
    'height' in value &&
    typeof (value as PdfTextItem).str === 'string' &&
    Array.isArray((value as PdfTextItem).transform) &&
    typeof (value as PdfTextItem).width === 'number' &&
    typeof (value as PdfTextItem).height === 'number'
  )
}

function isPdfPasswordError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    String((error as { name: unknown }).name) === 'PasswordException'
  )
}
