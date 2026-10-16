import { asQuote, createEmptyInvoice, effectiveVatScheme, newId, withVatScheme, type Client, type CompanyProfile, type Invoice, type InvoiceLine } from '../../../domain'
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

/** Links and state that belong to the original document only (conversion, recurrence, acceptance, reopening). */
function withoutLinks(inv: Invoice): Invoice {
  const out = { ...inv }
  delete out.convertedFromQuoteId
  delete out.convertedToInvoiceId
  delete out.quoteAcceptedAt
  delete out.recurringRuleId
  delete out.reopenedAt
  delete out.reopenedIssueDate
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

/** Whether nothing has been entered in the lines yet (no description, price or discount on any line). */
export function linesAreBlank(lines: readonly InvoiceLine[]): boolean {
  return lines.every((l) => !l.description?.trim() && !l.unitPrice && !l.discountPercent)
}

/**
 * The lines of an earlier invoice for a new draft: new ids, same descriptions, quantities, units, prices and
 * discounts. VAT rates are kept only when both documents are domestic; otherwise they follow the draft's scheme.
 */
export function copyLines(src: Invoice, target: Pick<Invoice, 'vatScheme'>, profile: CompanyProfile): InvoiceLine[] {
  const rate = (l: InvoiceLine) => (target.vatScheme !== 'domestic' ? 0 : src.vatScheme === 'domestic' ? l.vatRate : profile.defaults.defaultVatRate)
  return src.lines
    .filter((l) => l.description?.trim() || l.unitPrice)
    .map((l) => {
      const copy: InvoiceLine = { ...l, id: newId(), quantity: Math.abs(l.quantity), vatRate: rate(l) }
      if (!copy.discountPercent) delete copy.discountPercent
      return copy
    })
}

/** Month of a date for short references, e.g. "september" (ET) or "September 2025" (EN, another year). */
export function monthLabel(iso: string, lang: 'et' | 'en', today: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? '')
  if (!m) return ''
  const sameYear = today.slice(0, 4) === m[1]
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15))
  return new Intl.DateTimeFormat(lang === 'et' ? 'et-EE' : 'en-GB', { month: 'long', year: sameYear ? undefined : 'numeric', timeZone: 'UTC' }).format(date)
}

/** The saved client a document's buyer refers to (by client id, else registry code), if it still exists. */
export function savedClientOf(inv: Pick<Invoice, 'buyer'>, clients: readonly Client[]): Client | undefined {
  const buyer = inv.buyer
  if (!buyer) return undefined
  if (buyer.clientId) {
    const byId = clients.find((c) => c.id === buyer.clientId)
    if (byId) return byId
  }
  const code = buyer.registryCode?.trim()
  return code ? clients.find((c) => c.registryCode?.trim() === code) : undefined
}

/** Copy recipients from the client card, for the CC field when e-mailing this document ('' when none). */
export function clientEmailCc(inv: Pick<Invoice, 'buyer'>, clients: readonly Client[]): string {
  return savedClientOf(inv, clients)?.emailCc?.trim() ?? ''
}
