import { computeTotals, fromCents, lineNetCents, toCents } from './calc'
import type { Invoice, InvoiceLine } from './types'

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

const lineKey = (l: InvoiceLine) => [l.description.trim(), l.unit, toCents(l.unitPrice), l.discountPercent ?? 0, l.vatRate].join('\u0000')

function grossCents(invoice: Settleable, lines: InvoiceLine[]): number {
  return toCents(computeTotals({ ...invoice, lines }).gross)
}

/**
 * Lines of a credit note that credits what is still open on `invoice` after earlier credit notes (all of it
 * when there are none). Credited lines are matched by description, unit, price, discount and VAT rate; if an
 * earlier credit note does not match the lines (prices changed by hand), one line per VAT rate carries the
 * remaining net amount, labelled with `remainderLabel`. Quantities are negative; ids are left to the caller.
 */
export function remainingCreditLines(
  invoice: Settleable,
  allInvoices: readonly CreditNote[],
  remainderLabel: (vatRate: number) => string,
): Omit<InvoiceLine, 'id'>[] {
  const strip = ({ id: _id, ...rest }: InvoiceLine) => rest
  const credits = creditNotesFor(invoice, allInvoices)
  const full = invoice.lines.map((l) => ({ ...strip(l), quantity: -Math.abs(l.quantity) }))
  if (credits.length === 0) return full
  const target = -(grossCents(invoice, invoice.lines) + credits.reduce((acc, cn) => acc + grossCents(cn, cn.lines), 0))
  if (target >= 0) return []

  // Remaining quantity per original line, after the matching credited quantities.
  const remaining = invoice.lines.map((l) => ({ line: l, key: lineKey(l), qty: l.quantity }))
  let matched = true
  for (const cl of credits.flatMap((cn) => cn.lines)) {
    const key = lineKey(cl)
    let left = -cl.quantity
    for (const r of remaining) {
      if (left <= 0) break
      if (r.key !== key || r.qty <= 0) continue
      const take = Math.min(r.qty, left)
      r.qty = Math.round((r.qty - take) * 1e6) / 1e6
      left = Math.round((left - take) * 1e6) / 1e6
    }
    if (left > 0) matched = false
  }
  if (matched) {
    const lines = remaining.filter((r) => r.qty > 0).map((r) => ({ ...strip(r.line), quantity: -r.qty }))
    const probe = lines.map((l, i) => ({ ...l, id: String(i) }))
    if (grossCents(invoice, probe) === target) return lines
  }

  const netByRate = new Map<number, number>()
  const add = (l: InvoiceLine) => netByRate.set(l.vatRate, (netByRate.get(l.vatRate) ?? 0) + lineNetCents(l))
  invoice.lines.forEach(add)
  credits.forEach((cn) => cn.lines.forEach(add))
  return [...netByRate.entries()]
    .filter(([, cents]) => cents > 0)
    .map(([vatRate, cents]) => ({ description: remainderLabel(vatRate), quantity: -1, unit: '', unitPrice: fromCents(cents), vatRate }))
}
