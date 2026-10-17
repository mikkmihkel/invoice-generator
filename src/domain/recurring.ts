// Recurring invoices: a rule points at a source invoice and the issue date of the next draft. Drafts are
// prepared when the app is opened; they are never issued automatically.
import { addDays, createEmptyInvoice, newId, parseISODate } from './factory'
import type { CompanyProfile, ISODate, Invoice, RecurrenceInterval, RecurringRule } from './types'

export const RECURRENCE_INTERVALS: readonly RecurrenceInterval[] = ['monthly', 'quarterly', 'yearly']

/** At most this many missed periods (the most recent ones) are caught up per rule in one run. */
export const MAX_CATCH_UP = 12

export function isRecurrenceInterval(v: unknown): v is RecurrenceInterval {
  return typeof v === 'string' && (RECURRENCE_INTERVALS as readonly string[]).includes(v)
}

export function intervalMonths(interval: RecurrenceInterval): number {
  return interval === 'yearly' ? 12 : interval === 'quarterly' ? 3 : 1
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function iso(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`
}

function parse(date: ISODate): { y: number; m: number; d: number } {
  const p = parseISODate(date)
  if (!p) throw new Error(`Invalid date: ${date}`)
  return p
}

/** Whether `date` is the last day of its month. */
export function isMonthEnd(date: ISODate): boolean {
  const p = parse(date)
  return p.d === daysInMonth(p.y, p.m)
}

/**
 * Move a date by whole months without overflowing into the next month: 2026-01-31 + 1 → 2026-02-28
 * (2028-02-29 in a leap year). `day` overrides the day of month to aim for (still clamped), so a series
 * anchored on the 31st returns to the 31st after a short month. With `keepMonthEnd`, a month-end date stays
 * on the month end (2026-02-28 + 1 → 2026-03-31), which suits the end of a service period.
 */
export function addMonths(date: ISODate, months: number, opts: { day?: number; keepMonthEnd?: boolean } = {}): ISODate {
  const p = parse(date)
  const total = p.y * 12 + (p.m - 1) + Math.trunc(months)
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  const dim = daysInMonth(y, m)
  if (opts.keepMonthEnd && p.d === daysInMonth(p.y, p.m)) return iso(y, m, dim)
  return iso(y, m, Math.min(opts.day ?? p.d, dim))
}

/** Whole calendar months from `from` to `to` (days ignored), e.g. 2026-01-31 → 2026-02-01 is 1. */
export function monthsBetween(from: ISODate, to: ISODate): number {
  const a = parse(from)
  const b = parse(to)
  return (b.y - a.y) * 12 + (b.m - a.m)
}

function daysBetween(from: ISODate, to: ISODate): number {
  const a = parse(from)
  const b = parse(to)
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
}

/**
 * The date after `date` in a series: one interval later, on the anchor's day of month when given (so a series
 * started on 31 January goes 28 February, 31 March, 30 April… instead of drifting to the 28th).
 */
export function nextOccurrence(date: ISODate, interval: RecurrenceInterval, anchor?: ISODate): ISODate {
  const day = anchor && parseISODate(anchor) ? parse(anchor).d : undefined
  return addMonths(date, intervalMonths(interval), { day })
}

/** The first draft date of a new rule for `source`: one interval after its issue date. */
export function firstOccurrence(source: Pick<Invoice, 'issueDate'>, interval: RecurrenceInterval): ISODate {
  return nextOccurrence(source.issueDate, interval, source.issueDate)
}

/**
 * The first date of `source`'s series after `today` (a rule set on an old invoice does not catch up the past; one
 * set today starts with the next period). With `includeToday`, a series date on `today` itself counts: that draft
 * is due now, not in the past (used when resuming a paused rule).
 */
export function upcomingOccurrence(source: Pick<Invoice, 'issueDate'>, interval: RecurrenceInterval, today: ISODate, opts: { includeToday?: boolean } = {}): ISODate {
  let date = firstOccurrence(source, interval)
  while (opts.includeToday ? date < today : date <= today) date = nextOccurrence(date, interval, source.issueDate)
  return date
}

/** New active rule for an issued invoice. */
export function createRecurringRule(source: Pick<Invoice, 'id' | 'issueDate'>, interval: RecurrenceInterval, now = new Date().toISOString()): RecurringRule {
  return {
    id: newId(),
    sourceInvoiceId: source.id,
    interval,
    nextDate: firstOccurrence(source, interval),
    active: true,
    createdAt: now,
    updatedAt: now,
  }
}

/** The rule whose source is `invoiceId` (an active one first), if any. */
export function ruleForInvoice(rules: readonly RecurringRule[], invoiceId: string): RecurringRule | undefined {
  const own = rules.filter((r) => r.sourceInvoiceId === invoiceId)
  return own.find((r) => r.active) ?? own[0]
}

/** The active rules repeating `invoiceId`, switched off: a cancelled invoice is not repeated any more. */
export function stopRulesFor(rules: readonly RecurringRule[], invoiceId: string, now = new Date().toISOString()): RecurringRule[] {
  return rules.filter((r) => r.sourceInvoiceId === invoiceId && r.active).map((r) => ({ ...r, active: false, updatedAt: now }))
}

/** Whether an invoice can be the source of a new rule: an issued (or paid) ordinary invoice. */
export function canRecur(inv: Pick<Invoice, 'type' | 'status'>): boolean {
  return inv.type === 'invoice' && (inv.status === 'issued' || inv.status === 'paid')
}

/**
 * Id of the draft a rule makes for one date. Being derived from the rule and the date, a draft prepared twice
 * (two tabs, or two devices whose backups are merged) is the same record. Safe as a database key and a URL segment.
 */
export function recurringDraftId(ruleId: string, date: ISODate): string {
  return `rec-${ruleId.replace(/[^A-Za-z0-9_-]/g, '_')}-${date}`
}

/**
 * Draft for one occurrence: buyer, lines, currency, VAT treatment, texts and design copied from the source; the
 * issue date is `date`, the payment term is kept, and the supply date and service period move by the same
 * number of months (a period ending on a month end keeps ending on one). Seller data and bank accounts come from
 * the current profile, like any new draft.
 */
export function recurringDraft(source: Invoice, rule: Pick<RecurringRule, 'id'>, date: ISODate, profile: CompanyProfile, now = new Date().toISOString()): Invoice {
  const base = createEmptyInvoice(profile)
  const months = parseISODate(source.issueDate) ? monthsBetween(source.issueDate, date) : 0
  const term = parseISODate(source.issueDate) && parseISODate(source.dueDate) ? Math.max(0, daysBetween(source.issueDate, source.dueDate)) : profile.defaults.paymentTermDays
  const shift = (d: ISODate | undefined, keepMonthEnd = false) => (d && parseISODate(d) ? addMonths(d, months, { keepMonthEnd }) : undefined)
  const draft: Invoice = {
    ...base,
    id: recurringDraftId(rule.id, date),
    type: source.type === 'prepayment' ? 'prepayment' : 'invoice',
    issueDate: date,
    dueDate: addDays(date, term),
    buyer: structuredCopy(source.buyer),
    lines: source.lines.map((l) => ({ ...l, id: newId() })),
    currency: source.currency,
    vatScheme: source.vatScheme,
    language: source.language,
    templateId: source.templateId,
    accentColor: source.accentColor,
    recurringRuleId: rule.id,
    createdAt: now,
    updatedAt: now,
  }
  const copy = <K extends keyof Invoice>(key: K) => {
    if (source[key] !== undefined) draft[key] = structuredCopy(source[key])
    else delete draft[key]
  }
  // The exchange rate is not copied: VAT in euros needs the rate of the new supply date.
  for (const key of ['vatExemptionNote', 'orderReference', 'notes', 'textBefore', 'textAfter', 'lateInterestPercentPerDay', 'footerNote', 'secondaryColor', 'colorMode', 'paymentQr'] as const) {
    copy(key)
  }
  const supplyDate = shift(source.supplyDate)
  if (supplyDate) draft.supplyDate = supplyDate
  const periodStart = shift(source.periodStart)
  const periodEnd = shift(source.periodEnd, true)
  if (periodStart) draft.periodStart = periodStart
  if (periodEnd) draft.periodEnd = periodEnd
  return draft
}

/** A rule with the invoice it repeats, for the overview of recurring invoices. */
export interface RecurringEntry {
  rule: RecurringRule
  source: Invoice
}

/**
 * The rules to show in the overview: active ones by the date of the next draft, then paused (inactive) ones whose
 * invoice can still be repeated. Rules whose source invoice is missing or a draft are left out, and so are
 * paused rules of a cancelled invoice (they can no longer be resumed).
 */
export function recurringOverview(rules: readonly RecurringRule[], invoices: readonly Invoice[]): { active: RecurringEntry[]; paused: RecurringEntry[] } {
  const byId = new Map(invoices.map((i) => [i.id, i]))
  const entries = rules
    .map((rule) => ({ rule, source: byId.get(rule.sourceInvoiceId) }))
    .filter((e): e is RecurringEntry => !!e.source && e.source.status !== 'draft' && isRecurrenceInterval(e.rule.interval))
  const byNext = (a: RecurringEntry, b: RecurringEntry) => a.rule.nextDate.localeCompare(b.rule.nextDate)
  return {
    active: entries.filter((e) => e.rule.active).sort(byNext),
    paused: entries.filter((e) => !e.rule.active && e.source.status !== 'cancelled').sort((a, b) => b.rule.updatedAt.localeCompare(a.rule.updatedAt)),
  }
}

/** The next draft an active rule will prepare (for an invoice that is not cancelled), if any. */
export function nextRecurring(rules: readonly RecurringRule[], invoices: readonly Invoice[]): RecurringEntry | undefined {
  return recurringOverview(rules, invoices).active.find((e) => e.source.status !== 'cancelled')
}

/**
 * A paused rule switched on again. The series goes on from its next date when that is today or still ahead (today's
 * draft is then prepared); otherwise from the first date of the series on or after `today`, so the paused periods
 * are not caught up.
 */
export function resumeRule(rule: RecurringRule, source: Pick<Invoice, 'issueDate'>, today: ISODate, now = new Date().toISOString()): RecurringRule {
  const nextDate = rule.nextDate >= today ? rule.nextDate : upcomingOccurrence(source, rule.interval, today, { includeToday: true })
  return { ...rule, active: true, nextDate, updatedAt: now }
}

// Undo of the overview's actions. Each one takes back only what its own action changed, applied to the rule as it
// is now (`rules` read afresh), so an older toast's undo never rolls back a later change. Null: nothing to take back
// (the rule changed in a way that already undid it, or was removed).

/** Undo "pause": switch the rule on again, keeping its current interval and next date. */
export function undoPause(rules: readonly RecurringRule[], paused: RecurringRule, now = new Date().toISOString()): RecurringRule | null {
  const current = rules.find((r) => r.id === paused.id)
  return current && !current.active ? { ...current, active: true, updatedAt: now } : null
}

/** Undo "resume": pause the rule again; its next date goes back too unless it was changed after resuming. */
export function undoResume(rules: readonly RecurringRule[], before: RecurringRule, resumed: RecurringRule, now = new Date().toISOString()): RecurringRule | null {
  const current = rules.find((r) => r.id === resumed.id)
  if (!current || !current.active) return null
  return { ...current, active: false, nextDate: current.nextDate === resumed.nextDate ? before.nextDate : current.nextDate, updatedAt: now }
}

/** Undo "stop" (the rule was removed): put it back, unless the invoice has been given another active rule since. */
export function undoStop(rules: readonly RecurringRule[], stopped: RecurringRule, now = new Date().toISOString()): RecurringRule | null {
  if (rules.some((r) => r.id === stopped.id || (r.sourceInvoiceId === stopped.sourceInvoiceId && r.active))) return null
  return { ...stopped, updatedAt: now }
}

function structuredCopy<T>(v: T): T {
  if (v === undefined || v === null || typeof v !== 'object') return v
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))
}

export interface RecurringRun {
  /** New drafts to save. */
  drafts: Invoice[]
  /** Rules whose nextDate moved (to save). */
  rules: RecurringRule[]
}

/**
 * Prepare the drafts that are due on `today`: for every active rule with nextDate ≤ today, one draft per missed
 * period (the latest MAX_CATCH_UP of them), then nextDate moves past today. A draft that already exists for the same rule and
 * date (same issue date or same id, e.g. created in another tab) is not created twice. Rules whose source invoice is missing or was
 * cancelled are left untouched.
 */
export function prepareRecurringDrafts(
  rules: readonly RecurringRule[],
  invoices: readonly Invoice[],
  profile: CompanyProfile,
  today: ISODate,
  now = new Date().toISOString(),
): RecurringRun {
  const out: RecurringRun = { drafts: [], rules: [] }
  const byId = new Map(invoices.map((i) => [i.id, i]))
  for (const rule of rules) {
    if (!rule.active || !isRecurrenceInterval(rule.interval) || !parseISODate(rule.nextDate) || rule.nextDate > today) continue
    const source = byId.get(rule.sourceInvoiceId)
    if (!source || source.status === 'cancelled' || source.status === 'draft') continue
    const existing = new Set(invoices.filter((i) => i.recurringRuleId === rule.id && i.id !== source.id).map((i) => i.issueDate))
    const made = (d: ISODate) => existing.has(d) || byId.has(recurringDraftId(rule.id, d))
    const due: ISODate[] = []
    let date = rule.nextDate
    while (date <= today) {
      due.push(date)
      date = nextOccurrence(date, rule.interval, source.issueDate)
    }
    let last: Invoice | undefined
    for (const d of due.slice(-MAX_CATCH_UP)) {
      if (made(d)) continue
      last = recurringDraft(source, rule, d, profile, now)
      out.drafts.push(last)
    }
    const next: RecurringRule = { ...rule, nextDate: date, updatedAt: now }
    if (last) next.lastCreatedInvoiceId = last.id
    out.rules.push(next)
  }
  return out
}
