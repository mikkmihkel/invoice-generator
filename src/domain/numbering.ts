import type { CompanyProfile, ISODate, Invoice, InvoiceType, NumberingReset, NumberingSettings } from './types'

/** Date tokens accepted in a numbering prefix, replaced from the document's issue date. */
export const NUMBERING_TOKENS = ['{YYYY}', '{YY}', '{MM}', '{DD}', '{YYYYMMDD}'] as const

export const NUMBERING_RESETS: readonly NumberingReset[] = ['never', 'yearly', 'monthly', 'daily']

/** Built-in quote (hinnapakkumine) series, used while `CompanyProfile.quoteNumbering` is not set. */
export const DEFAULT_QUOTE_NUMBERING: NumberingSettings = { prefix: 'HP-{YYYY}-', nextNumber: 1, padding: 3, reset: 'yearly', counters: {} }

export type NumberingPresetId = 'yearly' | 'daily' | 'monthly' | 'plain'

export interface NumberingPreset {
  id: NumberingPresetId
  prefix: string
  padding: number
  reset: NumberingReset
}

/** Ready-made formats offered in the settings; anything else is a custom format. */
export const NUMBERING_PRESETS: readonly NumberingPreset[] = [
  { id: 'yearly', prefix: '{YYYY}-', padding: 4, reset: 'yearly' },
  { id: 'daily', prefix: '{YYYYMMDD}', padding: 3, reset: 'daily' },
  { id: 'monthly', prefix: '{YYYY}-{MM}-', padding: 3, reset: 'monthly' },
  { id: 'plain', prefix: 'ARVE-', padding: 4, reset: 'never' },
]

/** Same series for quotes, with the quote prefix. */
export const QUOTE_NUMBERING_PRESETS: readonly NumberingPreset[] = [
  { id: 'yearly', prefix: 'HP-{YYYY}-', padding: 3, reset: 'yearly' },
  { id: 'daily', prefix: 'HP-{YYYYMMDD}', padding: 3, reset: 'daily' },
  { id: 'monthly', prefix: 'HP-{YYYY}-{MM}-', padding: 3, reset: 'monthly' },
  { id: 'plain', prefix: 'HP-', padding: 4, reset: 'never' },
]

/** The preset matching the format of `settings`, or 'custom'. */
export function matchPreset(settings: NumberingSettings, presets: readonly NumberingPreset[] = NUMBERING_PRESETS): NumberingPresetId | 'custom' {
  const reset = resetOf(settings)
  const p = presets.find((x) => x.prefix === settings.prefix && x.padding === settings.padding && x.reset === reset)
  return p ? p.id : 'custom'
}

export function resetOf(settings: NumberingSettings): NumberingReset {
  return settings.reset && NUMBERING_RESETS.includes(settings.reset) ? settings.reset : 'never'
}

/** The number series a document of this type is numbered from: quotes have their own. */
export function numberingFor(profile: Pick<CompanyProfile, 'numbering' | 'quoteNumbering'>, type: InvoiceType): NumberingSettings {
  return type === 'quote' ? (profile.quoteNumbering ?? DEFAULT_QUOTE_NUMBERING) : profile.numbering
}

/** Profile patch that stores `settings` as the series for `type`. */
export function withNumberingFor<P extends Pick<CompanyProfile, 'numbering' | 'quoteNumbering'>>(profile: P, type: InvoiceType, settings: NumberingSettings): P {
  return type === 'quote' ? { ...profile, quoteNumbering: settings } : { ...profile, numbering: settings }
}

interface DateParts {
  yyyy: string
  mm: string
  dd: string
}

function localToday(): ISODate {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Parts of an ISO date; an invalid date falls back to today (a plain year means 1 January of that year). */
function dateParts(date: ISODate | number): DateParts {
  if (typeof date === 'number') {
    const y = Number.isFinite(date) && date > 0 ? String(Math.trunc(date)).padStart(4, '0') : localToday().slice(0, 4)
    return { yyyy: y, mm: '01', dd: '01' }
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '')
  const [yyyy, mm, dd] = m ? [m[1], m[2], m[3]] : localToday().split('-')
  return { yyyy, mm, dd }
}

/** The prefix with its date tokens filled in from `date`. */
export function formatPrefix(prefix: string, date: ISODate | number): string {
  const { yyyy, mm, dd } = dateParts(date)
  return (prefix ?? '')
    .replace(/\{YYYYMMDD\}/g, yyyy + mm + dd)
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yyyy.slice(-2))
    .replace(/\{MM\}/g, mm)
    .replace(/\{DD\}/g, dd)
}

/**
 * Format a document number, e.g. {prefix:'{YYYY}-', padding:4}, n=7, issue date 2026-10-15 → "2026-0007";
 * {prefix:'{YYYYMMDD}', padding:3}, n=1 → "20261015001". Tokens: {YYYY} {YY} {MM} {DD} {YYYYMMDD}.
 * A plain year as the third argument is still accepted (month and day are then 01).
 */
export function formatInvoiceNumber(settings: NumberingSettings, n: number, issueDate: ISODate | number): string {
  const seq = String(Math.max(0, Math.trunc(n)))
  return formatPrefix(settings.prefix, issueDate) + seq.padStart(Math.max(0, Math.trunc(settings.padding || 0)), '0')
}

/** Counter key of the reset period containing `date`: '2026', '2026-10', '2026-10-15', or null for 'never'. */
export function periodKey(reset: NumberingReset, date: ISODate): string | null {
  const { yyyy, mm, dd } = dateParts(date)
  switch (reset) {
    case 'yearly':
      return yyyy
    case 'monthly':
      return `${yyyy}-${mm}`
    case 'daily':
      return `${yyyy}-${mm}-${dd}`
    default:
      return null
  }
}

const validSeq = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1

function counterValue(counters: Record<string, number> | undefined, key: string): number | undefined {
  if (!counters || !Object.prototype.hasOwnProperty.call(counters, key)) return undefined
  const v = counters[key]
  return validSeq(v) ? v : undefined
}

/** Next sequence number for a document issued on `issueDate`, and the counter it comes from (null = nextNumber). */
export function nextSequence(settings: NumberingSettings, issueDate: ISODate): { n: number; key: string | null } {
  const key = periodKey(resetOf(settings), issueDate)
  if (key === null) return { n: validSeq(Math.floor(settings.nextNumber)) ? Math.floor(settings.nextNumber) : 1, key }
  return { n: counterValue(settings.counters, key) ?? 1, key }
}

/** Set the next sequence number of the period containing `issueDate` (or nextNumber for 'never'). */
export function setNextSequence(settings: NumberingSettings, issueDate: ISODate, n: number): NumberingSettings {
  const next = validSeq(Math.floor(n)) ? Math.floor(n) : 1
  const key = periodKey(resetOf(settings), issueDate)
  if (key === null) return { ...settings, nextNumber: next }
  return { ...settings, counters: { ...settings.counters, [key]: next } }
}

/**
 * Settings after allocating a number for a document issued on `issueDate`. `used` is the sequence number actually
 * taken (it may be higher than nextSequence when numbers were skipped); the counter moves to used + 1.
 */
export function advanceNumbering(settings: NumberingSettings, issueDate: ISODate, used?: number): NumberingSettings {
  const n = used ?? nextSequence(settings, issueDate).n
  return setNextSequence(settings, issueDate, n + 1)
}

/** The next `count` numbers for documents issued on `issueDate` (without checking for numbers already used). */
export function previewNumbers(settings: NumberingSettings, issueDate: ISODate, count = 3): string[] {
  const { n } = nextSequence(settings, issueDate)
  return Array.from({ length: Math.max(0, count) }, (_, i) => formatInvoiceNumber(settings, n + i, issueDate))
}

/** The number the next document issued on `issueDate` would get. */
export function predictNumber(settings: NumberingSettings, issueDate: ISODate): string {
  return formatInvoiceNumber(settings, nextSequence(settings, issueDate).n, issueDate)
}

/** Whether the prefix has date tokens that make numbers of different periods distinct. */
export function prefixHasDate(prefix: string): boolean {
  return NUMBERING_TOKENS.some((t) => (prefix ?? '').includes(t))
}

/** Placeholders in braces that are not date tokens, e.g. "{YYY}" (printed literally, probably a typo). */
export function unknownTokens(prefix: string): string[] {
  return [...new Set((prefix ?? '').match(/\{[^{}]*\}/g) ?? [])].filter((t) => !(NUMBERING_TOKENS as readonly string[]).includes(t))
}

/**
 * Whether the prefix tells periods apart for the reset: a yearly restart needs the year, monthly year and month,
 * daily the full date. Otherwise the restarted numbers would clash with earlier periods (they are then skipped).
 */
export function prefixCoversPeriod(prefix: string, reset: NumberingReset): boolean {
  const p = prefix ?? ''
  const full = p.includes('{YYYYMMDD}')
  const year = full || p.includes('{YYYY}') || p.includes('{YY}')
  const month = full || (year && p.includes('{MM}'))
  switch (reset) {
    case 'yearly':
      return year
    case 'monthly':
      return month
    case 'daily':
      return full || (month && p.includes('{DD}'))
    default:
      return true
  }
}

const TOKEN_PATTERNS: Record<string, string> = { '{YYYYMMDD}': '\\d{8}', '{YYYY}': '\\d{4}', '{YY}': '\\d{2}', '{MM}': '\\d{2}', '{DD}': '\\d{2}' }

/** Regex for numbers of this series with any date: the sequence is the last group. */
function seriesPattern(prefix: string): RegExp {
  let out = ''
  const re = /\{YYYYMMDD\}|\{YYYY\}|\{YY\}|\{MM\}|\{DD\}/g
  let last = 0
  for (let m = re.exec(prefix); m; m = re.exec(prefix)) {
    out += prefix.slice(last, m.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + TOKEN_PATTERNS[m[0]]
    last = m.index + m[0].length
  }
  out += prefix.slice(last).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${out}(\\d+)$`)
}

type NumberedDoc = Pick<Invoice, 'number' | 'status' | 'issueDate'> & Partial<Pick<Invoice, 'type' | 'reopenedAt'>>

/**
 * Whether a number issued on `a` stays valid on `b`: same reset period and the same date tokens in the prefix.
 * A reopened document keeps its number, so its date may only move within this period.
 */
export function sameNumberingPeriod(settings: NumberingSettings, a: ISODate, b: ISODate): boolean {
  const reset = resetOf(settings)
  return periodKey(reset, a) === periodKey(reset, b) && formatPrefix(settings.prefix, a) === formatPrefix(settings.prefix, b)
}

/**
 * First and last day of the numbering period containing `date` (see sameNumberingPeriod), or null when the series
 * has no periods (no reset and no date in the prefix).
 */
export function numberingPeriod(settings: NumberingSettings, date: ISODate): { start: ISODate; end: ISODate } | null {
  const reset = resetOf(settings)
  const p = settings.prefix ?? ''
  const { yyyy, mm, dd } = dateParts(date)
  if (reset === 'daily' || p.includes('{DD}') || p.includes('{YYYYMMDD}')) return { start: `${yyyy}-${mm}-${dd}`, end: `${yyyy}-${mm}-${dd}` }
  if (reset === 'monthly' || p.includes('{MM}')) {
    const last = new Date(Date.UTC(Number(yyyy), Number(mm), 0)).getUTCDate()
    return { start: `${yyyy}-${mm}-01`, end: `${yyyy}-${mm}-${String(last).padStart(2, '0')}` }
  }
  if (reset === 'yearly' || p.includes('{YYYY}') || p.includes('{YY}')) return { start: `${yyyy}-01-01`, end: `${yyyy}-12-31` }
  return null
}

/** Whether the document holds its number: issued, paid or cancelled, or reopened for editing (a draft that keeps it). */
export function holdsNumber(doc: Pick<Invoice, 'number' | 'status'> & Partial<Pick<Invoice, 'reopenedAt'>>): boolean {
  return !!doc.number && (doc.status !== 'draft' || !!doc.reopenedAt)
}

/**
 * Sequence number of `number` in this series when issued on `issueDate` (the date tokens must match that date),
 * or null when the number does not belong to the series.
 */
export function sequenceOf(settings: NumberingSettings, number: string, issueDate: ISODate): number | null {
  const prefix = formatPrefix(settings.prefix, issueDate)
  if (!number.startsWith(prefix)) return null
  const rest = number.slice(prefix.length)
  if (!/^\d+$/.test(rest)) return null
  const n = Number(rest)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * Highest sequence number among numbered documents (see holdsNumber) whose number matches the prefix pattern
 * (date tokens match any date), e.g. prefix "{YYYY}-" and "2025-0042" → 42. 0 if none match.
 */
export function highestUsedNumber(documents: NumberedDoc[], numbering: NumberingSettings): number {
  const re = seriesPattern(numbering.prefix ?? '')
  let max = 0
  for (const doc of documents) {
    if (!holdsNumber(doc)) continue
    const m = re.exec(doc.number)
    const n = m ? Number(m[1]) : NaN
    if (Number.isSafeInteger(n) && n > max) max = n
  }
  return max
}

/**
 * Lowest counters that cannot hand out a number already used by `documents` (pass only the documents of this
 * series: quotes for the quote series, everything else for invoices): nextNumber and, for periodic resets, one
 * counter per period (taken from each document's issue date).
 */
export function numberingFloor(settings: NumberingSettings, documents: NumberedDoc[]): { nextNumber: number; counters: Record<string, number> } {
  const counters: Record<string, number> = {}
  const reset = resetOf(settings)
  if (reset !== 'never') {
    for (const doc of documents) {
      if (!holdsNumber(doc)) continue
      const key = periodKey(reset, doc.issueDate)
      const n = key === null ? null : sequenceOf(settings, doc.number, doc.issueDate)
      if (key !== null && n !== null && n + 1 > (counterValue(counters, key) ?? 0)) counters[key] = n + 1
    }
  }
  return { nextNumber: highestUsedNumber(documents, settings) + 1, counters }
}

/** `settings` with nextNumber and every counter raised to at least the values in `floors` (never lowered). */
export function raiseNumbering(
  settings: NumberingSettings,
  ...floors: (Partial<Pick<NumberingSettings, 'nextNumber' | 'counters'>> | null | undefined)[]
): NumberingSettings {
  let nextNumber = validSeq(settings.nextNumber) ? settings.nextNumber : 1
  const counters: Record<string, number> = {}
  const add = (src: Record<string, number> | undefined) => {
    if (!src) return
    for (const key of Object.keys(src)) {
      const v = counterValue(src, key)
      if (v !== undefined && v > (counterValue(counters, key) ?? 0)) counters[key] = v
    }
  }
  add(settings.counters)
  for (const f of floors) {
    if (!f) continue
    if (validSeq(f.nextNumber) && f.nextNumber > nextNumber) nextNumber = f.nextNumber
    add(f.counters)
  }
  const out: NumberingSettings = { ...settings, nextNumber }
  if (settings.counters || Object.keys(counters).length) out.counters = counters
  return out
}

/** The next `count` numbers for `date`, skipping numbers already in use (as issuing does). */
export function upcomingNumbers(settings: NumberingSettings, date: ISODate, used: ReadonlySet<string>, count = 3): string[] {
  const out: string[] = []
  let n = nextSequence(settings, date).n
  for (let guard = 0; out.length < count && guard < 10_000; guard++, n++) {
    const number = formatInvoiceNumber(settings, n, date)
    if (!used.has(number)) out.push(number)
  }
  return out
}

/**
 * Highest used sequence of the period containing `date` when the next number would go below it
 * (i.e. the series would restart under numbers already issued), else null.
 */
export function restartBelowUsed(settings: NumberingSettings, date: ISODate, documents: NumberedDoc[]): number | null {
  const floor = numberingFloor(settings, documents)
  const key = periodKey(resetOf(settings), date)
  const floorN = key === null ? floor.nextNumber : (floor.counters[key] ?? 1)
  return nextSequence(settings, date).n < floorN ? floorN - 1 : null
}

/** Documents that share a series with a document of `type`. */
export function sameSeries(type: InvoiceType): (doc: { type?: InvoiceType }) => boolean {
  return type === 'quote' ? (d) => d.type === 'quote' : (d) => d.type !== 'quote'
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

