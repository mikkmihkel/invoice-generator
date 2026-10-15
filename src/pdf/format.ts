// Deterministic number/date formatting for invoice documents (no Intl, so output is identical everywhere).
import type { InvoiceLanguage, ISODate } from '../domain/types'

const NBSP = '\u00a0'
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Estonian conventions for `et` and `et-en`; English conventions for `en`. */
export function usesEnglishFormat(lang: InvoiceLanguage): boolean {
  return lang === 'en'
}

function groupThousands(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
}

/**
 * Format a decimal number. `minDecimals`/`maxDecimals` control the fraction digits.
 * ET: "1 234,56" (non-breaking space grouping); EN: "1,234.56".
 */
export function formatDecimal(value: number, lang: InvoiceLanguage, minDecimals = 2, maxDecimals = minDecimals): string {
  if (!Number.isFinite(value)) return ''
  const en = usesEnglishFormat(lang)
  const negative = value < 0
  let fixed = Math.abs(value).toFixed(maxDecimals)
  if (maxDecimals > minDecimals) {
    // Trim trailing zeros down to minDecimals.
    const [i, f = ''] = fixed.split('.')
    let frac = f
    while (frac.length > minDecimals && frac.endsWith('0')) frac = frac.slice(0, -1)
    fixed = frac ? `${i}.${frac}` : i
  }
  const [intPart, fracPart] = fixed.split('.')
  const grouped = groupThousands(intPart, en ? ',' : NBSP)
  const body = fracPart ? `${grouped}${en ? '.' : ','}${fracPart}` : grouped
  // Avoid "-0,00" for values that round to zero.
  return negative && /[1-9]/.test(body) ? `-${body}` : body
}

/** Money amount without currency, always 2 decimals. */
export function formatAmount(value: number, lang: InvoiceLanguage): string {
  return formatDecimal(value, lang, 2, 2)
}

export function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'EUR':
      return '€'
    case 'USD':
      return '$'
    case 'GBP':
      return '£'
    default:
      return currency.toUpperCase()
  }
}

/** Money with currency: ET "1 234,56 €", EN "€1,234.56" (codes other than €/$/£ are written out, e.g. "SEK 1,234.56"). */
export function formatMoney(value: number, currency: string, lang: InvoiceLanguage): string {
  const amount = formatAmount(value, lang)
  const sym = currencySymbol(currency)
  if (usesEnglishFormat(lang)) {
    const isSymbol = sym.length === 1
    const neg = amount.startsWith('-')
    const abs = neg ? amount.slice(1) : amount
    return `${neg ? '-' : ''}${sym}${isSymbol ? '' : NBSP}${abs}`
  }
  return `${amount}${NBSP}${sym}`
}

/** Unit price with currency, same placement as `formatMoney` but with up to 4 decimals: "0,1235 €" / "€0.1235". */
export function formatUnitMoney(value: number, currency: string, lang: InvoiceLanguage): string {
  const amount = formatUnitPrice(value, lang)
  const sym = currencySymbol(currency)
  if (usesEnglishFormat(lang)) {
    const neg = amount.startsWith('-')
    return `${neg ? '-' : ''}${sym}${sym.length === 1 ? '' : NBSP}${neg ? amount.slice(1) : amount}`
  }
  return `${amount}${NBSP}${sym}`
}

/** Quantity: up to 3 decimals, no trailing zeros. */
export function formatQuantity(value: number, lang: InvoiceLanguage): string {
  return formatDecimal(value, lang, 0, 3)
}

/** Unit price: at least 2, up to 4 decimals. */
export function formatUnitPrice(value: number, lang: InvoiceLanguage): string {
  return formatDecimal(value, lang, 2, 4)
}

export function formatPercent(value: number, lang: InvoiceLanguage): string {
  return `${formatDecimal(value, lang, 0, 2)}%`
}

/** ET/bilingual: "12.10.2026"; EN: "12 Oct 2026". */
export function formatDate(iso: ISODate | undefined, lang: InvoiceLanguage): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  if (usesEnglishFormat(lang)) return `${Number(m[3])} ${EN_MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
  return `${m[3]}.${m[2]}.${m[1]}`
}

export function formatIban(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

const TRANSLIT: Record<string, string> = {
  õ: 'o', ä: 'a', ö: 'o', ü: 'u', š: 's', ž: 'z', Õ: 'O', Ä: 'A', Ö: 'O', Ü: 'U', Š: 'S', Ž: 'Z',
  ß: 'ss', æ: 'ae', Æ: 'AE', ø: 'o', Ø: 'O', å: 'a', Å: 'A', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D',
}

/** Transliterate to printable ASCII: Estonian letters explicitly, other accents via Unicode decomposition. */
export function toAscii(input: string): string {
  return input
    .replace(/[^ -~]/g, (ch) => TRANSLIT[ch] ?? ch.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    .replace(/[^ -~]/g, '')
}

/** ASCII-safe file name segment: "Klient OÜ" → "Klient-OU". */
export function fileNameSegment(input: string, maxLength = 60): string {
  return toAscii(input)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, maxLength)
    .replace(/[-.]+$/g, '')
}
