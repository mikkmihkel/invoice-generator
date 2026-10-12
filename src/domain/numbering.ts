import type { NumberingSettings } from './types'

/** Format e.g. {prefix:'{YYYY}-', padding:4}, n=7, year 2026 → "2026-0007". */
export function formatInvoiceNumber(_settings: NumberingSettings, _n: number, _issueYear: number): string {
  throw new Error('not implemented')
}

/** Estonian viitenumber with 7-3-1 check digit, derived from a numeric base (e.g. digits of the invoice number). */
export function generateReferenceNumber(_base: string): string {
  throw new Error('not implemented')
}

export function isValidReferenceNumber(_ref: string): boolean {
  throw new Error('not implemented')
}
