// List search: number, client, codes, references, e-mail, line descriptions and amounts, with the field that matched.
import type { Invoice } from '../../../domain'

export type SearchField = 'number' | 'client' | 'registryCode' | 'reference' | 'orderReference' | 'email' | 'line' | 'amount' | 'net'

export interface SearchHit {
  field: SearchField
  /** The matching text (a line description, an e-mail…); empty for amounts, which the caller formats. */
  text: string
  /** For amounts: the amount that matched. */
  amount?: number
}

export interface AmountQuery {
  value: number
  /** "1240" finds 1 240,00 and 1 240,50; "1240,5" only 1 240,50. */
  whole: boolean
}

/**
 * Read a search text as an amount, the way people type it: "1240", "1 240,00", "1240.5", "1.240,50", "1,240.50",
 * "384 €". Null when it is not an amount.
 */
export function parseAmountQuery(query: string): AmountQuery | null {
  const s = query.replace(/[\s  ]/g, '').replace(/(€|eur)$/i, '')
  let normal: string
  if (/^\d+([.,]\d{1,2})?$/.test(s)) normal = s.replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) normal = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) normal = s.replace(/,/g, '')
  else return null
  const value = Number(normal)
  return Number.isFinite(value) ? { value, whole: !/[.]/.test(normal) } : null
}

function amountMatches(amount: number, q: AmountQuery): boolean {
  const a = Math.abs(amount)
  return q.whole ? Math.trunc(a + 1e-9) === q.value : Math.abs(Math.round(a * 100) - Math.round(q.value * 100)) === 0
}

/**
 * The first field of `inv` that matches `query` (case-insensitive substring; amounts compared as numbers, see
 * parseAmountQuery), or null. Fields are tried in the order the row shows them, then the hidden ones.
 */
export function searchInvoice(inv: Invoice, query: string, totals: { gross: number; net: number }): SearchHit | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const has = (s: string | undefined) => !!s && s.toLowerCase().includes(q)
  if (has(inv.number)) return { field: 'number', text: inv.number }
  if (has(inv.buyer.name)) return { field: 'client', text: inv.buyer.name }
  const code = inv.buyer.registryCode || inv.buyer.personalCode
  if (has(code)) return { field: 'registryCode', text: code ?? '' }
  if (has(inv.referenceNumber)) return { field: 'reference', text: inv.referenceNumber ?? '' }
  if (has(inv.orderReference)) return { field: 'orderReference', text: inv.orderReference ?? '' }
  if (has(inv.buyer.email)) return { field: 'email', text: inv.buyer.email ?? '' }
  const line = inv.lines.find((l) => has(l.description))
  if (line) return { field: 'line', text: line.description }
  const amount = parseAmountQuery(q)
  if (amount) {
    if (amountMatches(totals.gross, amount)) return { field: 'amount', text: '', amount: totals.gross }
    if (amountMatches(totals.net, amount)) return { field: 'net', text: '', amount: totals.net }
  }
  return null
}
