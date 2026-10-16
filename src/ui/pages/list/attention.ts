// "Needs attention": what the owner should do today, worked out from the documents and their sent/reminder history.
import { holdsNumber, quoteStatus, type Invoice, type InvoiceEvent } from '../../../domain'
import { daysBetween, displayStatus, isCreditSettled } from '../../util'
import { eventDate } from '../invoice-detail/events'
import { localDateOf, REMIND_AGAIN_DAYS } from '../invoice-detail/status'

/** A quote whose validity ends within this many days (today included) is about to expire. */
export const QUOTE_EXPIRY_DAYS = 3

export type AttentionKey = 'overdue' | 'unsent' | 'quotes' | 'drafts'

export interface AttentionGroup {
  key: AttentionKey
  /** The documents, most urgent first. */
  docs: Invoice[]
  /** Drafts only: how many were prepared today from a recurring rule. */
  recurringToday?: number
}

const ORDER: AttentionKey[] = ['overdue', 'unsent', 'quotes', 'drafts']

/**
 * The groups that need the owner's attention (empty groups left out):
 * - overdue invoices without a reminder in the last REMIND_AGAIN_DAYS days, longest overdue first;
 * - issued invoices and credit notes not sent yet (not overdue, not fully credited);
 * - open quotes whose validity ends within QUOTE_EXPIRY_DAYS days;
 * - invoice drafts, with the number prepared today from recurring rules.
 */
export function attentionGroups(invoices: readonly Invoice[], events: readonly Pick<InvoiceEvent, 'invoiceId' | 'kind' | 'at'>[], today: string): AttentionGroup[] {
  const sent = new Set<string>()
  const lastReminder = new Map<string, string>()
  for (const e of events) {
    if (e.kind === 'sent') sent.add(e.invoiceId)
    else {
      const d = eventDate(e.at)
      if ((lastReminder.get(e.invoiceId) ?? '') < d) lastReminder.set(e.invoiceId, d)
    }
  }
  const groups: Record<AttentionKey, Invoice[]> = { overdue: [], unsent: [], quotes: [], drafts: [] }
  let recurringToday = 0
  for (const inv of invoices) {
    if (inv.type === 'quote') {
      if (quoteStatus(inv, today, invoices) !== 'sent' || !inv.validUntil) continue
      const left = daysBetween(today, inv.validUntil)
      if (left >= 0 && left <= QUOTE_EXPIRY_DAYS) groups.quotes.push(inv)
      continue
    }
    if (inv.status === 'draft') {
      groups.drafts.push(inv)
      if (inv.recurringRuleId && inv.createdAt && localDateOf(inv.createdAt) === today) recurringToday++
      continue
    }
    const status = displayStatus(inv, today, invoices)
    if (status === 'overdue') {
      const reminded = lastReminder.get(inv.id)
      if (!reminded || daysBetween(reminded, today) >= REMIND_AGAIN_DAYS) groups.overdue.push(inv)
    } else if (inv.status === 'issued' && holdsNumber(inv) && !sent.has(inv.id) && !isCreditSettled(inv, invoices)) {
      groups.unsent.push(inv)
    }
  }
  groups.overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  groups.unsent.sort((a, b) => a.issueDate.localeCompare(b.issueDate))
  groups.quotes.sort((a, b) => (a.validUntil ?? '').localeCompare(b.validUntil ?? ''))
  groups.drafts.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  return ORDER.filter((key) => groups[key].length > 0).map((key) => ({ key, docs: groups[key], ...(key === 'drafts' ? { recurringToday } : {}) }))
}

/** Ids of everything listed, for remembering what the user already dismissed. */
export function attentionIds(groups: readonly AttentionGroup[]): string[] {
  return groups.flatMap((g) => g.docs.map((d) => `${g.key}:${d.id}`))
}
