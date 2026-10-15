// Deleting documents and reopening issued ones: which records go together, what happens to the number series,
// and when an issued document may still be edited.
import { holdsNumber, nextSequence, numberingFloor, numberingFor, periodKey, resetOf, sameSeries, sequenceOf, setNextSequence, withNumberingFor } from './numbering'
import type { CompanyProfile, Invoice, InvoiceEvent } from './types'

type Series = Pick<CompanyProfile, 'numbering' | 'quoteNumbering'>

/** Credit notes (of any status, drafts included) that refer to `invoice` by its number. */
export function linkedCreditNotes(invoice: Invoice, all: readonly Invoice[]): Invoice[] {
  const number = invoice.number?.trim()
  if (!number || invoice.type === 'credit-note' || invoice.type === 'quote') return []
  return all.filter((i) => i.type === 'credit-note' && i.id !== invoice.id && i.creditedInvoiceNumber?.trim() === number)
}

/** The invoice a credit note credits, if it is still there. */
export function creditedInvoiceOf(creditNote: Invoice, all: readonly Invoice[]): Invoice | undefined {
  const number = creditNote.creditedInvoiceNumber?.trim()
  if (creditNote.type !== 'credit-note' || !number) return undefined
  return all.find((i) => i.id !== creditNote.id && i.type !== 'credit-note' && i.type !== 'quote' && i.number?.trim() === number)
}

/**
 * Give numbers back to their series where possible: a removed document whose number is the last one handed out in
 * its series and period lowers that counter by one, so the next document gets the number again. Several removed
 * documents at the top of a series are all given back; any other number stays as a gap. A counter never goes
 * below a number still held by one of `remaining`.
 */
export function releaseNumbers<P extends Series>(profile: P, removed: readonly Invoice[], remaining: readonly Invoice[]): { profile: P; released: string[] } {
  let next = profile
  const released: string[] = []
  for (const type of ['invoice', 'quote'] as const) {
    const original = numberingFor(profile, type)
    const docs = removed
      .filter(sameSeries(type))
      .filter(holdsNumber)
      .map((d) => ({ d, n: sequenceOf(original, d.number, d.issueDate) }))
      .filter((x): x is { d: Invoice; n: number } => x.n !== null)
      .sort((a, b) => b.n - a.n)
    if (!docs.length) continue
    const floor = numberingFloor(original, remaining.filter(sameSeries(type)).filter(holdsNumber).map((d) => ({ ...d, status: 'issued' as const })))
    const reset = resetOf(original)
    let series = original
    for (const { d, n } of docs) {
      const key = periodKey(reset, d.issueDate)
      const lowest = key === null ? floor.nextNumber : (floor.counters[key] ?? 1)
      if (nextSequence(series, d.issueDate).n !== n + 1 || n < lowest) continue
      series = setNextSequence(series, d.issueDate, n)
      released.push(d.number)
    }
    if (series !== original) next = withNumberingFor(next, type, series)
  }
  return { profile: next, released }
}

export interface DeletionPlan {
  /** Everything that is deleted: the document first, then the credit notes that go with it. */
  documents: Invoice[]
  /** Credit notes deleted together with the invoice they credit. */
  creditNotes: Invoice[]
  /** For a credit note: the invoice it credits, which stays. */
  creditedInvoice?: Invoice
  /** Whether any of the documents has a number (an issued accounting document, or a quote that was issued). */
  numbered: boolean
  /** Numbers the next documents get again. */
  released: string[]
  /** Numbers that stay as a gap in the series. */
  gaps: string[]
}

/**
 * What deleting `target` involves. An invoice is deleted together with its credit notes, which would otherwise
 * point to a missing (or, once the number is given back, a different) invoice. A credit note is deleted on its
 * own; the invoice it credited stays and is simply no longer credited.
 */
export function planDeletion(target: Invoice, all: readonly Invoice[], profile: Series | null): DeletionPlan {
  const creditNotes = linkedCreditNotes(target, all)
  const documents = [target, ...creditNotes]
  const ids = new Set(documents.map((d) => d.id))
  const remaining = all.filter((i) => !ids.has(i.id))
  const numbered = documents.filter(holdsNumber)
  const released = profile ? releaseNumbers(profile, documents, remaining).released : []
  return {
    documents,
    creditNotes,
    creditedInvoice: creditedInvoiceOf(target, all),
    numbered: numbered.length > 0,
    released,
    gaps: numbered.map((d) => d.number).filter((n) => !released.includes(n)),
  }
}

/** Why an issued document cannot be reopened for editing. */
export type ReopenBlock = 'not-issued' | 'paid' | 'cancelled' | 'sent' | 'credited' | 'accepted'

/**
 * An issued document may be reopened for editing while nobody else has seen it: not sent (no 'sent' or reminder
 * event), not paid or cancelled, not credited by an issued credit note, and for a quote not accepted. Once a
 * document has been sent, corrections are made with a credit note. Null when it can be reopened.
 */
export function reopenBlocker(doc: Invoice, all: readonly Invoice[], events: readonly Pick<InvoiceEvent, 'invoiceId' | 'kind'>[]): ReopenBlock | null {
  if (doc.status === 'paid') return 'paid'
  if (doc.status === 'cancelled') return 'cancelled'
  if (doc.status !== 'issued' || !doc.number) return 'not-issued'
  if (events.some((e) => e.invoiceId === doc.id)) return 'sent'
  if (linkedCreditNotes(doc, all).some((cn) => cn.status !== 'draft' || cn.reopenedAt)) return 'credited'
  if (doc.type === 'quote' && (doc.quoteAcceptedAt || doc.convertedToInvoiceId || all.some((i) => i.convertedFromQuoteId === doc.id))) return 'accepted'
  return null
}
