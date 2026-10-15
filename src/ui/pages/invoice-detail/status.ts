import type { Invoice } from '../../../domain'
import { formatDate } from '../../format'
import type { Translate } from '../../i18n'
import { daysBetween, isUnpaid, type DisplayStatus } from '../../util'

export type Tone = 'muted' | 'neutral' | 'warn' | 'danger' | 'success'

/** Due within this many days reads as "due soon" (amber). */
export const DUE_SOON_DAYS = 3

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Days from today to the due date (negative when overdue), or null without a usable date. */
export function daysToDue(inv: Invoice, today: string): number | null {
  return isDate(inv.dueDate) ? daysBetween(today, inv.dueDate) : null
}

/** The coloured status word of a list row: "Tasutud 15.08.2026", "Tähtaeg ületatud 10 päeva", "Mustand"... */
export function rowStatus(inv: Invoice, status: DisplayStatus, today: string, t: Translate): { text: string; tone: Tone } {
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

/** First part of the detail's status sentence: "Tasumata, tähtaeg homme", "Tasutud 15.08.2026"... */
export function detailStatus(inv: Invoice, status: DisplayStatus, today: string, t: Translate): { text: string; tone: Tone } {
  if (status === 'draft') return { text: t('detail.statusDraft', { date: formatDate(inv.updatedAt?.slice(0, 10)) }), tone: 'muted' }
  if (status === 'cancelled') return { text: t('status.cancelled'), tone: 'muted' }
  if (status === 'paid') return { text: inv.paidAt ? t('list.paidOn', { date: formatDate(inv.paidAt) }) : t('status.paid'), tone: 'success' }
  if (inv.type === 'credit-note') return { text: rowStatus(inv, status, today, t).text, tone: 'neutral' }
  const d = daysToDue(inv, today)
  if (d === null) return { text: t(`status.${status}`), tone: 'neutral' }
  if (d < 0) return { text: d === -1 ? t('detail.statusOverdueOne') : t('detail.statusOverdue', { days: -d }), tone: 'danger' }
  const due = d === 0 ? t('detail.today') : d === 1 ? t('detail.tomorrow') : formatDate(inv.dueDate)
  return { text: t('detail.statusUnpaid', { due }), tone: d <= DUE_SOON_DAYS ? 'warn' : 'neutral' }
}
