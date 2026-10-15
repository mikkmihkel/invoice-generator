import { creditNotesFor, outstandingAmount, type Invoice } from '../../../domain'
import type { QuoteStatus } from '../../../domain/quote'
import { formatDate, formatMoney } from '../../format'
import type { Translate } from '../../i18n'
import { daysBetween, isUnpaid, type DisplayStatus } from '../../util'

export type Tone = 'muted' | 'neutral' | 'warn' | 'danger' | 'success'

/** Due within this many days reads as "due soon" (amber). */
export const DUE_SOON_DAYS = 3

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Calendar day of a timestamp in the user's time zone (late evening UTC is already the next day in Tallinn). */
export function localDateOf(ts: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The document type in lower case for running text: "arve", "kreeditarve", "hinnapakkumine". */
export function docNoun(t: Translate, invoice: Pick<Invoice, 'type'>): string {
  return t(`invoice.type.${invoice.type}`).toLocaleLowerCase()
}

/** Days from today to the due date (negative when overdue), or null without a usable date. */
export function daysToDue(inv: Invoice, today: string): number | null {
  return isDate(inv.dueDate) ? daysBetween(today, inv.dueDate) : null
}

/** How credit notes settle an issued invoice: which ones apply, what is still owed, whether nothing is. */
export interface Settlement {
  creditNotes: Invoice[]
  outstanding: number
  /** Fully offset by credit notes: not unpaid, never overdue. */
  settled: boolean
}

export function settlementOf(inv: Invoice, allInvoices: readonly Invoice[]): Settlement {
  const creditNotes = creditNotesFor(inv, allInvoices)
  const outstanding = outstandingAmount(inv, allInvoices)
  return { creditNotes, outstanding, settled: inv.status === 'issued' && creditNotes.length > 0 && outstanding === 0 }
}

/** "kreeditarve 2026-0005 arvesse võetud" for a partially credited invoice. */
export function creditsApplied(creditNotes: Invoice[], t: Translate): string {
  const numbers = creditNotes.map((c) => c.number).join(', ')
  return t(creditNotes.length > 1 ? 'detail.creditsApplied' : 'detail.creditApplied', { numbers })
}

/** The coloured status word of a list row: "Tasutud 15.08.2026", "Tähtaeg ületatud 10 päeva", "Mustand"... */
export function rowStatus(inv: Invoice, status: DisplayStatus, today: string, t: Translate, settle?: Settlement): { text: string; tone: Tone } {
  if (settle?.settled) return { text: t('list.credited'), tone: 'muted' }
  if (status === 'draft') return { text: t('status.draft'), tone: 'muted' }
  if (status === 'cancelled') return { text: t('status.cancelled'), tone: 'muted' }
  if (inv.type === 'credit-note') {
    return { text: inv.creditedInvoiceNumber ? t('list.creditFor', { number: inv.creditedInvoiceNumber }) : t('invoice.type.credit-note'), tone: 'muted' }
  }
  if (status === 'paid') return { text: inv.paidAt ? t('list.paidOn', { date: formatDate(inv.paidAt) }) : t('status.paid'), tone: 'success' }
  const d = daysToDue(inv, today)
  if (!isUnpaid(inv) || d === null) return { text: t(`status.${status}`), tone: 'neutral' }
  if (d < 0) return { text: d === -1 ? t('list.overdueDayOne') : t('list.overdueDays', { days: -d }), tone: 'danger' }
  const tone: Tone = d <= DUE_SOON_DAYS ? 'warn' : 'muted'
  if (d === 0) return { text: t('list.dueToday'), tone }
  if (d === 1) return { text: t('list.dueTomorrow'), tone }
  return { text: t('list.daysToDue', { days: d }), tone }
}

/**
 * First part of the detail's status sentence: "Tasumata, tähtaeg homme", "Tasutud 15.08.2026"...
 * A partially credited invoice states what is still owed: "Tasumata 600,00 € (kreeditarve 2026-0005 arvesse võetud), tähtaeg homme".
 * (A fully credited one gets a sentence with links, composed by the detail itself.)
 */
export function detailStatus(inv: Invoice, status: DisplayStatus, today: string, t: Translate, settle?: Settlement): { text: string; tone: Tone } {
  if (status === 'draft') return { text: t('detail.statusDraft', { date: formatDate(inv.updatedAt?.slice(0, 10)) }), tone: 'muted' }
  if (status === 'cancelled') return { text: t('status.cancelled'), tone: 'muted' }
  if (status === 'paid') return { text: inv.paidAt ? t('list.paidOn', { date: formatDate(inv.paidAt) }) : t('status.paid'), tone: 'success' }
  if (inv.type === 'credit-note') return { text: rowStatus(inv, status, today, t).text, tone: 'neutral' }
  if (settle?.settled) return { text: t('list.credited'), tone: 'muted' }
  const d = daysToDue(inv, today)
  const partial = settle && settle.creditNotes.length > 0 ? t('detail.statusOutstanding', { amount: formatMoney(settle.outstanding, inv.currency), credits: creditsApplied(settle.creditNotes, t) }) : null
  if (d === null) return { text: partial ?? t(`status.${status}`), tone: 'neutral' }
  if (d < 0) {
    if (partial) return { text: `${partial}, ${d === -1 ? t('list.overdueDayOne') : t('list.overdueDays', { days: -d })}`, tone: 'danger' }
    return { text: d === -1 ? t('detail.statusOverdueOne') : t('detail.statusOverdue', { days: -d }), tone: 'danger' }
  }
  const due = d === 0 ? t('detail.today') : d === 1 ? t('detail.tomorrow') : formatDate(inv.dueDate)
  const tone: Tone = d <= DUE_SOON_DAYS ? 'warn' : 'neutral'
  if (partial) return { text: `${partial}, ${t('detail.dueOn', { due })}`, tone }
  return { text: t('detail.statusUnpaid', { due }), tone }
}

/** Status sentence of a quote: "Kehtib kuni 29.10.2026", "Aegunud 01.10.2026", "Aktsepteeritud 12.10.2026"... */
export function quoteDetailStatus(quote: Invoice, status: QuoteStatus, today: string, t: Translate): { text: string; tone: Tone } {
  if (status === 'draft') return detailStatus(quote, 'draft', today, t)
  if (status === 'cancelled') return { text: t('status.cancelled'), tone: 'muted' }
  if (status === 'accepted') {
    return { text: quote.quoteAcceptedAt ? t('detail.quoteAcceptedOn', { date: formatDate(localDateOf(quote.quoteAcceptedAt)) }) : t('detail.quoteAccepted'), tone: 'success' }
  }
  if (status === 'expired') return { text: t('detail.quoteExpired', { date: formatDate(quote.validUntil) }), tone: 'warn' }
  if (!isDate(quote.validUntil)) return { text: t('status.issued'), tone: 'neutral' }
  const d = daysBetween(today, quote.validUntil)
  return { text: t('detail.quoteValid', { date: formatDate(quote.validUntil) }), tone: d <= DUE_SOON_DAYS ? 'warn' : 'neutral' }
}
