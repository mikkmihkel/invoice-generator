import { createEmptyInvoice, newId, type Client, type CompanyProfile, type Invoice } from '../../../domain'
import { addDaysISO, buyerFromClient, daysBetween, nowISO } from '../../util'

/** New in-memory draft for the profile (and optional client). */
export function newDraft(profile: CompanyProfile, client?: Client): Invoice {
  let inv = createEmptyInvoice(profile, client)
  if (client && inv.buyer.clientId !== client.id) {
    inv = {
      ...inv,
      buyer: buyerFromClient(client),
      language: client.defaultLanguage ?? inv.language,
      vatScheme: client.defaultVatScheme ?? inv.vatScheme,
    }
  }
  return inv
}

/** Copy of an invoice as a fresh draft dated today (same buyer, lines and settings). */
export function duplicateInvoice(src: Invoice, profile: CompanyProfile): Invoice {
  const base = createEmptyInvoice(profile)
  const now = nowISO()
  const term = Math.max(0, daysBetween(src.issueDate, src.dueDate))
  return {
    ...src,
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
}

/** Draft credit note reversing an issued invoice in full (negative quantities); the user may edit lines for a partial credit. */
export function creditNoteFor(src: Invoice, profile: CompanyProfile): Invoice {
  const base = createEmptyInvoice(profile)
  const now = nowISO()
  return {
    ...src,
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
