// Everything a template needs to lay out an invoice: resolved totals, labels, formatters and colours.
import { computeTotals, vatSchemeNote } from '../domain'
import type { Address, BankAccount, Invoice, InvoiceLanguage, InvoiceTotals, Party } from '../domain/types'
import { formatAmount, formatDate, formatMoney, formatPercent } from './format'
import { translator, type Translator } from './labels'

export const DEFAULT_ACCENT = '#1f6feb'

export const COLORS = {
  text: '#1f2328',
  muted: '#6b7280',
  rule: '#d0d7de',
  hairline: '#e5e7eb',
  white: '#ffffff',
}

export interface DocContext {
  invoice: Invoice
  totals: InvoiceTotals
  lang: InvoiceLanguage
  t: Translator
  /** Normalised `#rrggbb`. */
  accent: string
  /** Very light tint of the accent (backgrounds). */
  accentTint: string
  /** Lighter accent for secondary elements. */
  accentSoft: string
  /** Readable text colour on an accent background. */
  onAccent: string
  /** Document title, e.g. "Arve" / "Kreeditarve / Credit note". */
  title: string
  /** Title parts for bilingual layouts: [et, en?]. */
  titleParts: [string, string?]
  /** Mandatory VAT scheme note from the domain layer (or null). */
  vatNote: string | null
  /** "Seller is not VAT registered" note when applicable and not already covered by `vatNote`. */
  notRegisteredNote: string | null
  bankAccounts: BankAccount[]
  showDiscount: boolean
  /** Print country lines in addresses (cross-border invoices). */
  showCountry: boolean
  money(value: number): string
  amount(value: number): string
  percent(value: number): string
  date(value: string | undefined): string
}

export function normalizeHex(color: string | undefined): string {
  const c = (color ?? '').trim()
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toLowerCase()
  return DEFAULT_ACCENT
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

/** Mix `hex` with white (`amount` 0 → unchanged, 1 → white). */
export function tint(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount])
}

/** Mix `hex` with black. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex([r * (1 - amount), g * (1 - amount), b * (1 - amount)])
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** White or near-black, whichever contrasts better with `hex`. */
export function contrastText(hex: string): string {
  const l = relativeLuminance(hex)
  const withWhite = 1.05 / (l + 0.05)
  const withBlack = (l + 0.05) / 0.05
  return withWhite >= withBlack ? COLORS.white : COLORS.text
}

/** Accent as used for text on white: darkened if too light to read. */
export function readableOnWhite(hex: string): string {
  let c = hex
  for (let i = 0; i < 6 && 1.05 / (relativeLuminance(c) + 0.05) < 3; i++) c = shade(c, 0.2)
  return c
}

export function selectedBankAccounts(invoice: Invoice): BankAccount[] {
  const all = invoice.seller.bankAccounts ?? []
  if (!invoice.bankAccountIds?.length) return all
  const selected = all.filter((a) => invoice.bankAccountIds.includes(a.id))
  return selected.length ? selected : all
}

const COUNTRY_FALLBACK: Record<string, { et: string; en: string }> = {
  EE: { et: 'Eesti', en: 'Estonia' },
}

export function countryName(code: string, lang: InvoiceLanguage): string {
  const upper = (code || '').toUpperCase()
  const l = lang === 'en' ? 'en' : 'et'
  try {
    const name = new Intl.DisplayNames([l], { type: 'region' }).of(upper)
    if (name && name !== upper) return name
  } catch {
    // Intl.DisplayNames unavailable — fall through.
  }
  return COUNTRY_FALLBACK[upper]?.[l] ?? upper
}

export function addressLines(address: Address | undefined, ctx: Pick<DocContext, 'lang' | 'showCountry'>): string[] {
  if (!address) return []
  const lines: string[] = []
  if (address.street?.trim()) lines.push(address.street.trim())
  const cityLine = [address.postalCode, address.city].map((s) => s?.trim()).filter(Boolean).join(' ')
  const county = address.county?.trim()
  if (cityLine || county) lines.push([cityLine, county].filter(Boolean).join(', '))
  const country = (address.country || 'EE').toUpperCase()
  if (ctx.showCountry || country !== 'EE') lines.push(countryName(country, ctx.lang))
  return lines
}

function isForeign(p: Party): boolean {
  return (p.address?.country || 'EE').toUpperCase() !== 'EE'
}

export function documentTitle(invoice: Invoice, t: Translator): { title: string; parts: [string, string?] } {
  const key = invoice.type === 'credit-note' ? 'creditNote' : invoice.type === 'prepayment' ? 'prepayment' : 'invoice'
  return { title: t(key), parts: t.parts(key) }
}

export function createContext(invoice: Invoice): DocContext {
  const lang: InvoiceLanguage = invoice.language === 'en' || invoice.language === 'et-en' ? invoice.language : 'et'
  const t = translator(lang)
  const totals = computeTotals(invoice)
  const accent = normalizeHex(invoice.accentColor)
  const vatNote = vatSchemeNote(invoice.vatScheme, lang, invoice.vatExemptionNote) || null
  const { title, parts } = documentTitle(invoice, t)
  const currency = invoice.currency || 'EUR'
  return {
    invoice,
    totals,
    lang,
    t,
    accent,
    accentTint: tint(accent, 0.9),
    accentSoft: tint(accent, 0.6),
    onAccent: contrastText(accent),
    title,
    titleParts: parts,
    vatNote,
    notRegisteredNote: invoice.vatScheme === 'not-registered' && !vatNote ? t('notVatRegistered') : null,
    bankAccounts: selectedBankAccounts(invoice),
    showDiscount: invoice.lines.some((l) => (l.discountPercent ?? 0) !== 0),
    showCountry: isForeign(invoice.seller) || isForeign(invoice.buyer),
    money: (v) => formatMoney(v, currency, lang),
    amount: (v) => formatAmount(v, lang),
    percent: (v) => formatPercent(v, lang),
    date: (v) => formatDate(v, lang),
  }
}
