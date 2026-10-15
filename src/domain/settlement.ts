import { computeTotals, fromCents, toCents } from './calc'
import type { Invoice } from './types'

type Settleable = Pick<Invoice, 'id' | 'number' | 'type' | 'status' | 'currency' | 'lines' | 'vatScheme'>
type CreditNote = Settleable & Pick<Invoice, 'creditedInvoiceNumber'>

/**
 * Issued (or settled), non-cancelled credit notes that credit `invoice`, matched by invoice number and currency.
 * Credit notes themselves and invoices without a number have none.
 */
export function creditNotesFor<T extends CreditNote>(invoice: Settleable, allInvoices: readonly T[]): T[] {
  const number = invoice.number?.trim()
  if (!number || invoice.type === 'credit-note') return []
  return allInvoices.filter(
    (i) =>
      i.type === 'credit-note' &&
      i.id !== invoice.id &&
      (i.status === 'issued' || i.status === 'paid') &&
      i.creditedInvoiceNumber?.trim() === number &&
      (i.currency || 'EUR') === (invoice.currency || 'EUR'),
  )
}

/** Sum of the credit notes issued against `invoice` (≤ 0: credit notes carry negative amounts). */
export function creditedAmount(invoice: Settleable, allInvoices: readonly CreditNote[]): number {
  const cents = creditNotesFor(invoice, allInvoices).reduce((acc, cn) => acc + toCents(computeTotals(cn).gross), 0)
  return fromCents(cents)
}

/** What the buyer still owes: gross + credited (credit notes are negative), never below zero. */
export function outstandingAmount(invoice: Settleable, allInvoices: readonly CreditNote[]): number {
  const cents = toCents(computeTotals(invoice).gross) + toCents(creditedAmount(invoice, allInvoices))
  return fromCents(Math.max(0, cents))
}
