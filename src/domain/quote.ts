// Quotes (hinnapakkumised): offers with their own number series, no payment details, and a validity date.
// An accepted quote is turned into an invoice draft in one step.
import { addDays, createEmptyInvoice, isValidISODate, newId, todayISO } from './factory'
import type { Client, CompanyProfile, ISODate, ISODateTime, Invoice } from './types'

/** Default validity of a new quote, in days from its date. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 14

export function isQuote(inv: Pick<Invoice, 'type'> | null | undefined): boolean {
  return inv?.type === 'quote'
}

/**
 * List status of a quote: 'sent' once it has a number (issued), 'accepted' when an invoice was made from it,
 * 'expired' when the validity date has passed without that.
 */
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'expired' | 'cancelled'

/** The invoice created from `quote`, if it still exists (looked up both ways, so either link is enough). */
export function invoiceFromQuote(quote: Pick<Invoice, 'id' | 'convertedToInvoiceId'>, invoices: readonly Invoice[]): Invoice | undefined {
  return (
    (quote.convertedToInvoiceId ? invoices.find((i) => i.id === quote.convertedToInvoiceId) : undefined) ??
    invoices.find((i) => i.convertedFromQuoteId === quote.id && i.type !== 'quote')
  )
}

export function isQuoteAccepted(quote: Pick<Invoice, 'id' | 'quoteAcceptedAt' | 'convertedToInvoiceId'>, invoices?: readonly Invoice[]): boolean {
  if (quote.quoteAcceptedAt || quote.convertedToInvoiceId) return true
  return !!invoices && invoices.some((i) => i.convertedFromQuoteId === quote.id && i.type !== 'quote')
}

export function quoteStatus(
  quote: Pick<Invoice, 'id' | 'status' | 'validUntil' | 'quoteAcceptedAt' | 'convertedToInvoiceId'>,
  today: ISODate = todayISO(),
  invoices?: readonly Invoice[],
): QuoteStatus {
  if (quote.status === 'cancelled') return 'cancelled'
  if (isQuoteAccepted(quote, invoices)) return 'accepted'
  if (quote.status === 'draft') return 'draft'
  if (quote.validUntil && isValidISODate(quote.validUntil) && quote.validUntil < today) return 'expired'
  return 'sent'
}

/** Validity date for a quote dated `issueDate`. */
export function quoteValidUntil(issueDate: ISODate, days = DEFAULT_QUOTE_VALIDITY_DAYS): ISODate {
  return addDays(issueDate, Math.max(0, Math.round(days)))
}

/**
 * Make a document a quote: number series and payment fields do not apply, so the reference number, late
 * interest and payment QR are dropped, and the validity date is set (kept if already valid). The due date
 * mirrors the validity date so that code reading `dueDate` never sees a stale payment deadline.
 */
export function asQuote(inv: Invoice): Invoice {
  const validUntil = inv.validUntil && isValidISODate(inv.validUntil) && inv.validUntil >= inv.issueDate ? inv.validUntil : quoteValidUntil(inv.issueDate)
  const out: Invoice = { ...inv, type: 'quote', validUntil, dueDate: validUntil }
  delete out.referenceNumber
  delete out.lateInterestPercentPerDay
  delete out.paymentQr
  delete out.creditedInvoiceNumber
  delete out.recurringRuleId
  return out
}

/** New quote draft from the profile defaults (and client overrides, if given). */
export function createEmptyQuote(profile: CompanyProfile, client?: Client, today: ISODate = todayISO()): Invoice {
  const inv = createEmptyInvoice(profile, client)
  return asQuote({ ...inv, issueDate: today, validUntil: quoteValidUntil(today) })
}

/**
 * Invoice draft from an accepted quote: buyer, lines, currency, VAT treatment, notes, free-text rows, order
 * reference and design are copied (not the exchange rate); dates are today's with the profile's payment term; seller, bank accounts,
 * late interest, payment QR and footer come from the current profile like on any new draft. The draft links back
 * to the quote (convertedFromQuoteId); use `markQuoteAccepted` for the link on the quote itself.
 */
export function quoteToInvoiceDraft(quote: Invoice, profile: CompanyProfile, today: ISODate = todayISO(), now: ISODateTime = new Date().toISOString()): Invoice {
  const base = createEmptyInvoice(profile)
  const draft: Invoice = {
    ...base,
    type: 'invoice',
    issueDate: today,
    dueDate: addDays(today, Math.max(0, profile.defaults.paymentTermDays)),
    buyer: clone(quote.buyer),
    lines: quote.lines.map((l) => ({ ...l, id: newId() })),
    currency: quote.currency,
    vatScheme: quote.vatScheme,
    language: quote.language,
    templateId: quote.templateId,
    accentColor: quote.accentColor,
    convertedFromQuoteId: quote.id,
    createdAt: now,
    updatedAt: now,
  }
  // The exchange rate is not copied: VAT in euros needs the rate of the invoice's own supply date.
  for (const key of ['vatExemptionNote', 'orderReference', 'notes', 'textBefore', 'textAfter', 'secondaryColor', 'colorMode'] as const) {
    if (quote[key] !== undefined) draft[key] = clone(quote[key]) as never
    else delete draft[key]
  }
  return draft
}

/** The quote with its conversion recorded: accepted at `at`, pointing to the new invoice. */
export function markQuoteAccepted(quote: Invoice, invoiceId: string, at: ISODateTime = new Date().toISOString()): Invoice {
  return { ...quote, convertedToInvoiceId: invoiceId, quoteAcceptedAt: quote.quoteAcceptedAt ?? at }
}

function clone<T>(v: T): T {
  if (v === undefined || v === null || typeof v !== 'object') return v
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))
}
