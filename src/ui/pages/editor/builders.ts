import { asQuote, createEmptyInvoice, effectiveVatScheme, newId, withVatScheme, type Client, type CompanyProfile, type Invoice } from '../../../domain'
import { addDaysISO, buyerFromClient, daysBetween, nowISO } from '../../util'

/** New in-memory draft for the profile (and optional client); a quote with `type: 'quote'`. */
export function newDraft(profile: CompanyProfile, client?: Client, type: 'invoice' | 'quote' = 'invoice'): Invoice {
  let inv = createEmptyInvoice(profile, client)
  if (client && inv.buyer.clientId !== client.id) {
    inv = withVatScheme(
      { ...inv, buyer: buyerFromClient(client), language: client.defaultLanguage ?? inv.language },
      effectiveVatScheme(profile, client.defaultVatScheme ?? inv.vatScheme),
      profile.defaults.defaultVatRate,
    )
  }
  return type === 'quote' ? asQuote(inv) : inv
}

/** Links that belong to the original document only (conversion, recurrence, acceptance). */
function withoutLinks(inv: Invoice): Invoice {
  const out = { ...inv }
  delete out.convertedFromQuoteId
  delete out.convertedToInvoiceId
  delete out.quoteAcceptedAt
  delete out.recurringRuleId
  return out
}

/** Copy of an invoice as a fresh draft dated today (same buyer, lines and settings). */
export function duplicateInvoice(src: Invoice, profile: CompanyProfile): Invoice {
  const base = createEmptyInvoice(profile)
  const now = nowISO()
  const term = Math.max(0, daysBetween(src.issueDate, src.dueDate))
  const copy: Invoice = {
    ...withoutLinks(src),
    id: base.id,
    number: '',
    status: 'draft',
    type: src.type === 'credit-note' ? 'invoice' : src.type,
    creditedInvoiceNumber: undefined,
    issueDate: base.issueDate,
    dueDate: addDaysISO(base.issueDate, term),
    supplyDate: undefined,
    periodStart: undefined,
    periodEnd: undefined,
    seller: base.seller,
    referenceNumber: undefined,
    lines: src.lines.map((l) => ({ ...l, id: newId(), quantity: src.type === 'credit-note' ? Math.abs(l.quantity) : l.quantity })),
    issuedAt: undefined,
    paidAt: undefined,
    createdAt: now,
    updatedAt: now,
  }
  if (src.type !== 'quote') return copy
  // A copied quote is valid for as long as the original was.
  const validity = src.validUntil ? Math.max(0, daysBetween(src.issueDate, src.validUntil)) : undefined
  return asQuote({ ...copy, validUntil: validity === undefined ? undefined : addDaysISO(base.issueDate, validity) })
}

/** Draft credit note reversing an issued invoice in full (negative quantities); the user may edit lines for a partial credit. */
export function creditNoteFor(src: Invoice, profile: CompanyProfile): Invoice {
  const base = createEmptyInvoice(profile)
  const now = nowISO()
  return {
    ...withoutLinks(src),
    id: base.id,
    number: '',
    status: 'draft',
    type: 'credit-note',
    creditedInvoiceNumber: src.number,
    issueDate: base.issueDate,
    dueDate: base.issueDate,
    supplyDate: src.supplyDate ?? src.issueDate,
    seller: base.seller,
    referenceNumber: undefined,
    lines: src.lines.map((l) => ({ ...l, id: newId(), quantity: -Math.abs(l.quantity) })),
    issuedAt: undefined,
    paidAt: undefined,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Move the issue date (e.g. a stale draft to today): the due date keeps the payment term, and the supply date
 * moves only if it equalled the old issue date.
 */
export function redateInvoice(inv: Invoice, issueDate: string): Invoice {
  const term = Math.max(0, daysBetween(inv.issueDate, inv.dueDate))
  const next: Invoice = { ...inv, issueDate, dueDate: addDaysISO(issueDate, term) }
  if (inv.supplyDate && inv.supplyDate === inv.issueDate) next.supplyDate = issueDate
  if (inv.type === 'quote' && inv.validUntil) {
    // The validity period keeps its length; the due date of a quote mirrors it.
    next.validUntil = addDaysISO(issueDate, Math.max(0, daysBetween(inv.issueDate, inv.validUntil)))
    next.dueDate = next.validUntil
  }
  return next
}
