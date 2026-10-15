// Everything a template needs to lay out an invoice: resolved totals, labels, formatters and colours.
import { colorModeOf, computeTotals, selectedBankAccounts, vatSchemeNote } from '../domain'
import type { Address, BankAccount, ColorMode, Invoice, InvoiceLanguage, InvoiceTotals, Party } from '../domain/types'
import { formatAmount, formatDate, formatMoney, formatPercent, formatUnitMoney } from './format'
import { translator, type LabelKey, type Translator } from './labels'

export const DEFAULT_ACCENT = '#1f6feb'

/** Neutral palette shared by all templates (contrast of `muted` on white ≥ 5.9:1, `faint` ≥ 3.3:1). */
export const COLORS = {
  ink: '#111418',
  text: '#1f2328',
  muted: '#575e69',
  faint: '#7f8690',
  rule: '#c4c9cf',
  hairline: '#e2e5e9',
  fill: '#f4f5f7',
  white: '#ffffff',
}

/** The "colour" of a monochrome invoice: a soft ink for bands, blocks and rules, and a neutral tint for fills. */
export const MONO = { ink: '#24282e', tint: COLORS.fill, soft: COLORS.rule }

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
  /**
   * How colour is used: 'accent' (the primary colour as accent), 'mono' (`accent` is then a neutral ink and
   * the tints are greys) or 'duo' (templates also use `secondary`).
   */
  colorMode: ColorMode
  /** Second brand colour, normalised `#rrggbb`. Equals `accent` unless the mode is 'duo'. */
  secondary: string
  /** Very light tint of `secondary`. */
  secondaryTint: string
  /** Document title, e.g. "Arve" / "Kreeditarve / Credit note". */
  title: string
  /** Title parts for bilingual layouts: [et, en?]. */
  titleParts: [string, string?]
  isCreditNote: boolean
  /** Label of the document number: "Arve nr" / "Kreeditarve nr". */
  numberKey: LabelKey
  /** Mandatory VAT scheme note from the domain layer (or null). */
  vatNote: string | null
  /** "Seller is not VAT registered" note when applicable and not already covered by `vatNote`. */
  notRegisteredNote: string | null
  bankAccounts: BankAccount[]
  showDiscount: boolean
  /** Print country lines in addresses (cross-border invoices). */
  showCountry: boolean
  money(value: number): string
  /** Unit price with currency (up to 4 decimals). */
  unitMoney(value: number): string
  amount(value: number): string
  percent(value: number): string
  date(value: string | undefined): string
}

/** `#rrggbb` (or `#rgb`) lower-cased; anything else becomes `fallback`. Every PDF colour sink goes through this. */
export function normalizeHex(color: string | undefined, fallback = DEFAULT_ACCENT): string {
  const c = typeof color === 'string' ? color.trim() : ''
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toLowerCase()
  return fallback
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

/** Colour as used for text on white: darkened until it reaches `minContrast` (3:1 for large text, 4.5:1 for small). */
export function readableOnWhite(hex: string, minContrast = 3): string {
  let c = hex
  for (let i = 0; i < 12 && 1.05 / (relativeLuminance(c) + 0.05) < minContrast; i++) c = shade(c, 0.2)
  return c
}

/** Text colour for a muted label on a `bg` fill (bands, blocks): a mix towards `bg` that stays readable. */
export function mutedOn(bg: string, on: string): string {
  return on === COLORS.white ? tint(bg, 0.7) : shade(bg, 0.6)
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
  // Duo without a usable second colour is printed as 'accent'.
  const requested = colorModeOf(invoice.colorMode)
  const colorMode: ColorMode = requested === 'duo' && normalizeHex(invoice.secondaryColor, '') === '' ? 'accent' : requested
  const accent = colorMode === 'mono' ? MONO.ink : normalizeHex(invoice.accentColor)
  const secondary = colorMode === 'duo' ? normalizeHex(invoice.secondaryColor) : accent
  const vatNote = vatSchemeNote(invoice.vatScheme, lang, invoice.vatExemptionNote) || null
  const { title, parts } = documentTitle(invoice, t)
  const currency = invoice.currency || 'EUR'
  return {
    invoice,
    totals,
    lang,
    t,
    accent,
    accentTint: colorMode === 'mono' ? MONO.tint : tint(accent, 0.9),
    accentSoft: colorMode === 'mono' ? MONO.soft : tint(accent, 0.6),
    onAccent: contrastText(accent),
    colorMode,
    secondary,
    secondaryTint: tint(secondary, 0.9),
    title,
    titleParts: parts,
    isCreditNote: invoice.type === 'credit-note',
    numberKey: invoice.type === 'credit-note' ? 'creditNoteNo' : 'invoiceNo',
    vatNote,
    notRegisteredNote: invoice.vatScheme === 'not-registered' && !vatNote ? t('notVatRegistered') : null,
    bankAccounts: selectedBankAccounts(invoice),
    showDiscount: invoice.lines.some((l) => (l.discountPercent ?? 0) !== 0),
    showCountry: isForeign(invoice.seller) || isForeign(invoice.buyer),
    money: (v) => formatMoney(v, currency, lang),
    unitMoney: (v) => formatUnitMoney(v, currency, lang),
    amount: (v) => formatAmount(v, lang),
    percent: (v) => formatPercent(v, lang),
    date: (v) => formatDate(v, lang),
  }
}
