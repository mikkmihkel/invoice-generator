// Product catalogue helpers: line suggestions from the catalogue and the buyer's earlier invoices.
import { newId, type BuyerSnapshot, type Invoice, type InvoiceLine, type Product } from '../../domain'
import { useApp } from '../AppContext'
import { nowISO } from '../util'

export interface LineSuggestion {
  key: string
  source: 'catalogue' | 'history'
  description: string
  unit: string
  unitPrice: number
  /** Missing: use the default rate (catalogue) or keep the line's rate (non-VAT invoices). */
  vatRate?: number
  /** History: where the price was last used. */
  invoiceNumber?: string
  issueDate?: string
}

export type BuyerRef = Pick<BuyerSnapshot, 'clientId' | 'name' | 'registryCode'>

/** Case-, accent-form- and whitespace-insensitive key for matching descriptions. */
export function normalizeText(s: string): string {
  return s.normalize('NFC').toLocaleLowerCase('et').replace(/\s+/g, ' ').trim()
}

/** Same buyer: by client id when both have one, otherwise by registry code, otherwise by name. */
export function sameBuyer(a: BuyerRef, b: BuyerRef): boolean {
  if (a.clientId && b.clientId) return a.clientId === b.clientId
  const codeA = a.registryCode?.trim()
  const codeB = b.registryCode?.trim()
  if (codeA && codeB) return codeA === codeB
  return !!a.name?.trim() && normalizeText(a.name) === normalizeText(b.name ?? '')
}

/**
 * Lines previously invoiced to this buyer in this currency, one per description with the most recent price
 * (issued and paid invoices only; drafts, quotes, credit notes and cancelled invoices are ignored).
 */
export function invoicedLinesFor(invoices: readonly Invoice[], buyer: BuyerRef | undefined, currency: string): LineSuggestion[] {
  if (!buyer || (!buyer.clientId && !buyer.registryCode?.trim() && !buyer.name?.trim())) return []
  const cur = (currency || 'EUR').toUpperCase()
  const relevant = invoices
    .filter(
      (inv) =>
        (inv.status === 'issued' || inv.status === 'paid') &&
        (inv.type === 'invoice' || inv.type === 'prepayment') &&
        (inv.currency || 'EUR').toUpperCase() === cur &&
        sameBuyer(inv.buyer, buyer),
    )
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || (b.issuedAt ?? '').localeCompare(a.issuedAt ?? ''))
  const seen = new Map<string, LineSuggestion>()
  for (const inv of relevant) {
    for (const line of inv.lines) {
      const key = normalizeText(line.description)
      if (!key || seen.has(key)) continue
      seen.set(key, {
        key: `h:${key}`,
        source: 'history',
        description: line.description.trim(),
        unit: line.unit,
        unitPrice: line.unitPrice,
        vatRate: inv.vatScheme === 'domestic' ? line.vatRate : undefined,
        invoiceNumber: inv.number,
        issueDate: inv.issueDate,
      })
    }
  }
  return [...seen.values()]
}

export function productSuggestion(p: Product): LineSuggestion {
  return { key: `p:${p.id}`, source: 'catalogue', description: p.description, unit: p.unit, unitPrice: p.unitPrice, vatRate: p.vatRate }
}

/** Rank: description starts with the query, then a word starts with it, then contains every query word. */
function score(description: string, query: string): number {
  const d = normalizeText(description)
  if (!query) return 1
  if (d.startsWith(query)) return 3
  if (d.includes(' ' + query)) return 2
  return query.split(' ').every((w) => d.includes(w)) ? 1 : 0
}

/**
 * Suggestions for a line description: the buyer's earlier lines first (their last price), then catalogue items.
 * A catalogue item identical to an earlier line is shown once. An empty query lists everything.
 */
export function lineSuggestions(query: string, history: readonly LineSuggestion[], products: readonly Product[], limit = 8): LineSuggestion[] {
  const q = normalizeText(query)
  const rank = (list: readonly LineSuggestion[]) =>
    list
      .map((s) => ({ s, score: score(s.description, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.s)
  const fromHistory = rank(history)
  const historyKeys = new Set(fromHistory.map((s) => `${normalizeText(s.description)}|${s.unit}|${s.unitPrice}`))
  const fromCatalogue = rank(products.map(productSuggestion)).filter((s) => !historyKeys.has(`${normalizeText(s.description)}|${s.unit}|${s.unitPrice}`))
  return [...fromHistory, ...fromCatalogue].slice(0, limit)
}

/** Whether the line already holds exactly this suggestion (then there is nothing to offer). */
export function lineMatches(line: Pick<InvoiceLine, 'description' | 'unit' | 'unitPrice'>, s: LineSuggestion): boolean {
  return normalizeText(line.description) === normalizeText(s.description) && line.unit === s.unit && line.unitPrice === s.unitPrice
}

/** Find the catalogue item with this description (case-insensitive). */
export function findProduct(products: readonly Product[], description: string): Product | undefined {
  const key = normalizeText(description)
  return key ? products.find((p) => normalizeText(p.description) === key) : undefined
}

/** A catalogue item from an invoice line; updates the item with the same description when there is one. */
export function productFromLine(line: Pick<InvoiceLine, 'description' | 'unit' | 'unitPrice' | 'vatRate'>, existing: Product | undefined, withVat: boolean): Product {
  const now = nowISO()
  return {
    id: existing?.id ?? newId(),
    description: line.description.trim(),
    unit: line.unit.trim(),
    unitPrice: line.unitPrice,
    vatRate: withVat ? line.vatRate : existing?.vatRate,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

/** Catalogue data and writes (through the app context, which keeps the list current). */
export function useProducts() {
  const { products, saveProduct, deleteProduct } = useApp()
  return { products, save: saveProduct, remove: deleteProduct }
}
