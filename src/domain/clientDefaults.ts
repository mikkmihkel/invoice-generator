// Per-client invoice defaults (payment term, late interest) on top of the company defaults.
import { addDays, parseISODate } from './factory'
import type { Client, CompanyProfile, Invoice } from './types'

/** Payment term in days for a new invoice to this client: the client card's term, else the company default. */
export function clientPaymentTermDays(profile: CompanyProfile, client?: Client | null): number {
  const own = client?.paymentTermDays
  if (typeof own === 'number' && Number.isFinite(own) && own >= 0) return Math.round(own)
  return profile.defaults.paymentTermDays
}

/**
 * Late interest (% per day) for a new invoice to this client: the client card's rate, else the company default.
 * A rate of 0 on the card means "no late interest for this client" (nothing is printed).
 */
export function clientLateInterest(profile: CompanyProfile, client?: Client | null): number | undefined {
  const own = client?.lateInterestPercentPerDay
  if (typeof own === 'number' && Number.isFinite(own) && own >= 0) return own > 0 ? own : undefined
  const company = profile.defaults.lateInterestPercentPerDay
  return typeof company === 'number' && Number.isFinite(company) ? company : undefined
}

function days(from: string, to: string): number | null {
  const a = parseISODate(from)
  const b = parseISODate(to)
  if (!a || !b) return null
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
}

/** Document types that carry a payment term and late interest (not quotes or credit notes). */
function hasPaymentTerms(inv: Invoice): boolean {
  return inv.type === 'invoice' || inv.type === 'prepayment'
}

/**
 * Re-applies the per-client defaults when the buyer of a draft changes from `prev` to `next` (either may be a
 * manually entered buyer, i.e. undefined). A field that still holds the default of the previous buyer follows the
 * new buyer; a field the user has changed is kept. Quotes and credit notes are returned unchanged.
 */
export function applyClientTerms(inv: Invoice, profile: CompanyProfile, prev: Client | undefined, next: Client | undefined): Invoice {
  if (!hasPaymentTerms(inv)) return inv
  const out: Invoice = { ...inv }
  const term = days(inv.issueDate, inv.dueDate)
  if (term !== null && term === clientPaymentTermDays(profile, prev)) {
    out.dueDate = addDays(inv.issueDate, clientPaymentTermDays(profile, next))
  }
  const current = inv.lateInterestPercentPerDay ?? undefined
  if (current === clientLateInterest(profile, prev)) {
    const rate = clientLateInterest(profile, next)
    if (rate === undefined) delete out.lateInterestPercentPerDay
    else out.lateInterestPercentPerDay = rate
  }
  return out
}
