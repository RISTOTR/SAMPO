export function normaliseMatchText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-ES')
}

export function isValidMatchPattern(value: string): boolean {
  const normalised = normaliseMatchText(value)
  return /[\p{L}\p{N}]/u.test(normalised)
}
