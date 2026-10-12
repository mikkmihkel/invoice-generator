import type { InvoiceLanguage, VatScheme } from './types'

/** Estonian VAT rates in percent valid for 2026 (standard first). */
export const ESTONIAN_VAT_RATES: readonly number[] = []

/** Mandatory note printed on the invoice for the scheme (e.g. reverse charge wording + legal reference), or null. */
export function vatSchemeNote(_scheme: VatScheme, _language: InvoiceLanguage, _customNote?: string): string | null {
  throw new Error('not implemented')
}
export function vatSchemeAllowsRates(_scheme: VatScheme): boolean {
  throw new Error('not implemented')
}
export function vatSchemeRequiresBuyerVat(_scheme: VatScheme): boolean {
  throw new Error('not implemented')
}
export function isValidEstonianRegistryCode(_code: string): boolean {
  throw new Error('not implemented')
}
export function isValidVatNumber(_vat: string): boolean {
  throw new Error('not implemented')
}
export function isValidIban(_iban: string): boolean {
  throw new Error('not implemented')
}
