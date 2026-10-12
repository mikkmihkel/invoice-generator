import type { NumberingSettings } from './types'

/**
 * Format e.g. {prefix:'{YYYY}-', padding:4}, n=7, year 2026 → "2026-0007".
 * Placeholders in the prefix: {YYYY} (4-digit issue year), {YY} (2-digit year).
 */
export function formatInvoiceNumber(settings: NumberingSettings, n: number, issueYear: number): string {
  const year = String(issueYear)
  const prefix = (settings.prefix ?? '').replace(/\{YYYY\}/g, year).replace(/\{YY\}/g, year.slice(-2))
  const seq = String(Math.max(0, Math.trunc(n)))
  return prefix + seq.padStart(Math.max(0, Math.trunc(settings.padding || 0)), '0')
}

/** 7-3-1 check digit (Pangaliit): weights 7,3,1,… from the rightmost digit; check = (10 − sum mod 10) mod 10. */
export function referenceCheckDigit(base: string): number {
  const weights = [7, 3, 1]
  let sum = 0
  for (let i = 0; i < base.length; i++) sum += Number(base[base.length - 1 - i]) * weights[i % 3]
  return (10 - (sum % 10)) % 10
}

/**
 * Estonian viitenumber with 7-3-1 check digit, derived from a numeric base (e.g. digits of the invoice number).
 * Non-digits are dropped, as are leading zeros; the base must have 1–19 digits (result 2–20 digits).
 */
export function generateReferenceNumber(base: string): string {
  const digits = (base ?? '').replace(/\D/g, '').replace(/^0+/, '')
  if (digits.length === 0) throw new Error('Reference number base must contain a non-zero digit')
  if (digits.length > 19) throw new Error('Reference number base must have at most 19 digits')
  return digits + referenceCheckDigit(digits)
}

/** 2–20 digits (spaces allowed for readability), last digit is the 7-3-1 check digit. */
export function isValidReferenceNumber(ref: string): boolean {
  const r = (ref ?? '').replace(/\s+/g, '')
  if (!/^\d{2,20}$/.test(r)) return false
  return referenceCheckDigit(r.slice(0, -1)) === Number(r[r.length - 1])
}

