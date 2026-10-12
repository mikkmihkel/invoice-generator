import type { InvoiceLanguage, VatScheme } from './types'

/**
 * Estonian VAT rates in percent valid for 2026 (standard first).
 * 24% standard since 1 July 2025 (made permanent in 2025), 13% accommodation since 1 Jan 2025,
 * 9% books, medicines, press etc., 0% for zero-rated supplies. See docs/legal-requirements.md.
 */
export const ESTONIAN_VAT_RATES: readonly number[] = [24, 13, 9, 0]
export const STANDARD_VAT_RATE = 24
/** Rates that were valid earlier and may still appear on corrections of old supplies (warning, not error). */
export const HISTORICAL_VAT_RATES: readonly number[] = [22, 20, 5]

/** EU member state prefixes as used in VAT numbers (Greece = EL, Northern Ireland = XI). */
export const EU_VAT_PREFIXES: readonly string[] = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI',
]

/** EU member states as ISO 3166-1 alpha-2 country codes (Greece = GR). */
export const EU_COUNTRIES: readonly string[] = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]

export function isEuCountry(country: string | undefined): boolean {
  return !!country && EU_COUNTRIES.includes(country.trim().toUpperCase())
}

/** Country code (ISO alpha-2) a VAT number prefix belongs to: EL → GR, XI → GB. */
export function vatPrefixToCountry(prefix: string): string {
  const p = prefix.toUpperCase()
  if (p === 'EL') return 'GR'
  if (p === 'XI') return 'GB'
  return p
}

interface SchemeNote {
  et: string
  en: string
}

const SCHEME_NOTES: Record<VatScheme, SchemeNote | null> = {
  'not-registered': {
    et: 'Müüja ei ole käibemaksukohustuslasena registreeritud, käibemaksu ei lisandu.',
    en: 'The seller is not registered for VAT; no VAT is charged.',
  },
  domestic: null,
  'eu-reverse-charge': {
    et: 'Pöördmaksustamine. Teenuse käibe tekkimise koht on teenuse saaja asukohariik (KMS § 10; direktiivi 2006/112/EÜ art 44 ja 196).',
    en: 'Reverse charge. Place of supply is the customer\'s Member State (Estonian VAT Act § 10; Directive 2006/112/EC Art. 44 and 196).',
  },
  'eu-goods': {
    et: 'Kauba ühendusesisene käive, käibemaksumäär 0% (KMS § 15 lg 3 p 2; direktiivi 2006/112/EÜ art 138).',
    en: 'Intra-Community supply of goods, VAT rate 0% (Estonian VAT Act § 15(3)(2); Directive 2006/112/EC Art. 138).',
  },
  export: {
    et: 'Kauba eksport, käibemaksumäär 0% (KMS § 15 lg 3 p 1; direktiivi 2006/112/EÜ art 146).',
    en: 'Export of goods, VAT rate 0% (Estonian VAT Act § 15(3)(1); Directive 2006/112/EC Art. 146).',
  },
  'non-eu-services': {
    et: 'Käive ei ole Eestis maksustatav – teenuse käibe tekkimise koht on väljaspool Eestit (KMS § 10; direktiivi 2006/112/EÜ art 44).',
    en: 'Not subject to Estonian VAT – the place of supply of the service is outside Estonia (Estonian VAT Act § 10; Directive 2006/112/EC Art. 44).',
  },
  exempt: {
    et: 'Käibemaksuvaba käive (KMS § 16).',
    en: 'VAT-exempt supply (Estonian VAT Act § 16).',
  },
  'domestic-reverse-charge': {
    et: 'Pöördmaksustamine (KMS § 41¹).',
    en: 'Reverse charge (Estonian VAT Act § 41¹).',
  },
}

/** Schemes where the custom note replaces the default wording (the legal basis depends on the actual supply). */
const NOTE_REPLACEABLE: readonly VatScheme[] = ['exempt', 'export', 'domestic', 'not-registered']

function pick(note: SchemeNote, language: InvoiceLanguage): string {
  if (language === 'et') return note.et
  if (language === 'en') return note.en
  return `${note.et} / ${note.en}`
}

/**
 * Mandatory note printed on the invoice for the scheme (e.g. reverse charge wording + legal reference), or null.
 * `customNote` (Invoice.vatExemptionNote) replaces the default for 'exempt', 'export', 'domestic' and
 * 'not-registered'; for reverse-charge and intra-Community schemes it is appended, because the statutory
 * wording ("pöördmaksustamine") must stay on the invoice.
 */
export function vatSchemeNote(scheme: VatScheme, language: InvoiceLanguage, customNote?: string): string | null {
  const custom = customNote?.trim()
  const base = SCHEME_NOTES[scheme]
  if (custom && (NOTE_REPLACEABLE.includes(scheme) || !base)) return custom
  if (!base) return null
  const text = pick(base, language)
  return custom ? `${text} ${custom}` : text
}

/** Whether lines carry real VAT rates (only domestic sales charge Estonian VAT). */
export function vatSchemeAllowsRates(scheme: VatScheme): boolean {
  return scheme === 'domestic'
}

/** KMS § 37 lg 7: buyer's VAT number is mandatory when the buyer accounts for the VAT or for intra-Community supply. */
export function vatSchemeRequiresBuyerVat(scheme: VatScheme): boolean {
  return scheme === 'eu-reverse-charge' || scheme === 'eu-goods' || scheme === 'domestic-reverse-charge'
}

/** Whether the scheme can only be used by a VAT-registered seller (everything except 'not-registered'). */
export function vatSchemeRequiresSellerVat(scheme: VatScheme): boolean {
  return scheme !== 'not-registered'
}

function digitsOnly(value: string): string {
  return value.replace(/[\s.-]/g, '')
}

/**
 * Check digit used by Estonian personal codes (isikukood) and registry codes (registrikood):
 * weights 1..9,1 mod 11; if 10, weights 3..9,1,2,3 mod 11; if 10 again, 0.
 */
export function estonianCheckDigit(digits: string): number {
  const body = digits.slice(0, -1)
  const sum = (offset: number) =>
    [...body].reduce((acc, d, i) => acc + (((i + offset) % 9) + 1) * Number(d), 0) % 11
  let check = sum(0)
  if (check === 10) check = sum(2)
  return check % 10
}

/** Estonian registry code: 8 digits, first digit 1 (companies), 7 (state), 8 (non-profits) or 9 (foundations) + check digit. */
export function isValidEstonianRegistryCode(code: string): boolean {
  const c = digitsOnly(code ?? '')
  if (!/^[1789]\d{7}$/.test(c)) return false
  return estonianCheckDigit(c) === Number(c[7])
}

/** Estonian personal identification code (isikukood): 11 digits with the same check digit algorithm. */
export function isValidEstonianPersonalCode(code: string): boolean {
  const c = digitsOnly(code ?? '')
  if (!/^[1-6]\d{10}$/.test(c)) return false
  return estonianCheckDigit(c) === Number(c[10])
}

/** VAT number body formats per prefix (VIES formats; checksums only for EE). */
const VAT_FORMATS: Record<string, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^[01]?\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-HJ-NP-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^[1-9]\d{1,9}$/,
  SE: /^\d{10}01$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
  XI: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
  // Common non-EU VAT numbers (export customers).
  GB: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
  NO: /^\d{9}(MVA)?$/,
  CH: /^E\d{9}(MWST|TVA|IVA|TPV)?$/,
}

/** Remove spaces, dots and dashes and upper-case, e.g. "ee 100 931 558" → "EE100931558". */
export function normalizeVatNumber(vat: string): string {
  return (vat ?? '').replace(/[\s.\-/]/g, '').toUpperCase()
}

/** Estonian KMKR number (9 digits, without prefix): weights 3,7,1,… with sum ≡ 0 (mod 10). */
export function isValidEstonianVatBody(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1]
  return [...digits].reduce((acc, d, i) => acc + weights[i] * Number(d), 0) % 10 === 0
}

/** VAT number including country prefix. Format check per country; EE numbers are also checksum-validated. */
export function isValidVatNumber(vat: string): boolean {
  const v = normalizeVatNumber(vat)
  const prefix = v.slice(0, 2)
  const body = v.slice(2)
  const format = VAT_FORMATS[prefix]
  if (!format || !format.test(body)) return false
  if (prefix === 'EE') return isValidEstonianVatBody(body)
  return true
}

export function isEuVatNumber(vat: string): boolean {
  return EU_VAT_PREFIXES.includes(normalizeVatNumber(vat).slice(0, 2))
}

/** IBAN lengths per country (SEPA + common). Unknown countries are accepted on mod-97 alone (15–34 chars). */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18,
  FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  UA: 29, VA: 22,
}

export function normalizeIban(iban: string): string {
  return (iban ?? '').replace(/\s+/g, '').toUpperCase()
}

/** IBAN check: country length (where known) + ISO 13616 mod-97 = 1. */
export function isValidIban(iban: string): boolean {
  const v = normalizeIban(iban)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false
  const expected = IBAN_LENGTHS[v.slice(0, 2)]
  if (expected !== undefined && v.length !== expected) return false
  const rearranged = v.slice(4) + v.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const n = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of n) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

/** Format IBAN in groups of four for printing. */
export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})(?=.)/g, '$1 ')
}
