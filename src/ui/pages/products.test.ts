import { describe, expect, it } from 'vitest'
import type { Invoice, Product } from '../../domain'
import { line, sampleInvoice } from '../../pdf/testFixtures'
import { findProduct, invoicedLinesFor, lineMatches, lineSuggestions, productFromLine, sameBuyer } from './products'

const product = (id: string, description: string, unitPrice = 10, patch: Partial<Product> = {}): Product => ({
  id,
  description,
  unit: 'tk',
  unitPrice,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
})

const buyer = { clientId: 'c1', name: 'Klient OÜ', registryCode: '87654321' }
const inv = (patch: Partial<Invoice>): Invoice => sampleInvoice({ buyer: { ...sampleInvoice().buyer, ...buyer }, ...patch })

describe('sameBuyer', () => {
  it('matches by client id, then registry code, then name', () => {
    expect(sameBuyer({ clientId: 'a', name: 'X' }, { clientId: 'a', name: 'Y' })).toBe(true)
    expect(sameBuyer({ clientId: 'a', name: 'X' }, { clientId: 'b', name: 'X' })).toBe(false)
    expect(sameBuyer({ name: 'X', registryCode: '1' }, { clientId: 'b', name: 'Y', registryCode: '1' })).toBe(true)
    expect(sameBuyer({ name: ' päike  OÜ' }, { name: 'Päike OÜ' })).toBe(true)
    expect(sameBuyer({ name: '' }, { name: '' })).toBe(false)
  })
})

describe('invoicedLinesFor', () => {
  const invoices = [
    inv({ id: '1', number: 'A-1', issueDate: '2026-08-01', lines: [line({ id: 'a', description: 'Konsultatsioon', unit: 'h', unitPrice: 50 })] }),
    inv({ id: '2', number: 'A-2', issueDate: '2026-09-01', status: 'paid', lines: [line({ id: 'b', description: 'konsultatsioon ', unit: 'h', unitPrice: 60, vatRate: 24 })] }),
    inv({ id: '3', number: '', status: 'draft', issueDate: '2026-10-01', lines: [line({ id: 'c', description: 'Konsultatsioon', unitPrice: 99 })] }),
    inv({ id: '4', number: 'K-1', type: 'credit-note', issueDate: '2026-10-02', lines: [line({ id: 'd', description: 'Konsultatsioon', unitPrice: -60 })] }),
    inv({ id: '5', number: 'A-3', status: 'cancelled', issueDate: '2026-10-03', lines: [line({ id: 'e', description: 'Konsultatsioon', unitPrice: 70 })] }),
    inv({ id: '6', number: 'A-4', currency: 'USD', issueDate: '2026-10-04', lines: [line({ id: 'f', description: 'Konsultatsioon', unitPrice: 80 })] }),
    inv({ id: '7', number: 'A-5', issueDate: '2026-10-05', buyer: { ...sampleInvoice().buyer, clientId: 'other', registryCode: '1', name: 'Muu' }, lines: [line({ id: 'g', description: 'Konsultatsioon', unitPrice: 90 })] }),
    inv({ id: '8', number: 'A-6', issueDate: '2026-07-01', vatScheme: 'eu-reverse-charge', lines: [line({ id: 'h', description: 'Tugi', unit: 'kuu', unitPrice: 200, vatRate: 0 })] }),
  ]

  it('keeps the latest price per description from issued and paid invoices of this buyer and currency', () => {
    const list = invoicedLinesFor(invoices, buyer, 'EUR')
    expect(list.map((s) => [s.description, s.unitPrice, s.invoiceNumber, s.vatRate])).toEqual([
      ['konsultatsioon', 60, 'A-2', 24],
      ['Tugi', 200, 'A-6', undefined],
    ])
    expect(invoicedLinesFor(invoices, buyer, 'USD').map((s) => s.unitPrice)).toEqual([80])
  })

  it('returns nothing without a buyer', () => {
    expect(invoicedLinesFor(invoices, undefined, 'EUR')).toEqual([])
    expect(invoicedLinesFor(invoices, { name: ' ' }, 'EUR')).toEqual([])
  })
})

describe('lineSuggestions', () => {
  const products = [product('p1', 'Veebilehe hooldus', 120), product('p2', 'Konsultatsioon', 55), product('p3', 'Serveri majutus', 15), product('p4', 'Lisatöö konsultatsioonina', 70)]
  const history = invoicedLinesFor([inv({ number: 'A-1', lines: [line({ id: 'x', description: 'Konsultatsioon', unit: 'h', unitPrice: 60 })] })], buyer, 'EUR')

  it('puts the buyer’s earlier lines first, then catalogue items ranked by match', () => {
    const list = lineSuggestions('konsul', history, products)
    expect(list.map((s) => [s.source, s.description, s.unitPrice])).toEqual([
      ['history', 'Konsultatsioon', 60],
      ['catalogue', 'Konsultatsioon', 55],
      ['catalogue', 'Lisatöö konsultatsioonina', 70],
    ])
  })

  it('matches every word anywhere and ignores case', () => {
    expect(lineSuggestions('MAJUTUS serv', [], products).map((s) => s.description)).toEqual(['Serveri majutus'])
    expect(lineSuggestions('xyz', history, products)).toEqual([])
  })

  it('shows a catalogue item identical to an earlier line once', () => {
    const same = lineSuggestions('konsul', history, [product('p2', 'Konsultatsioon', 60, { unit: 'h' })])
    expect(same).toHaveLength(1)
    expect(same[0].source).toBe('history')
  })

  it('lists everything for an empty query, up to the limit', () => {
    expect(lineSuggestions('', history, products, 3)).toHaveLength(3)
  })
})

describe('catalogue helpers', () => {
  it('recognises a line that already holds the suggestion', () => {
    const s = lineSuggestions('veeb', [], [product('p1', 'Veebilehe hooldus', 120)])[0]
    expect(lineMatches({ description: 'veebilehe hooldus', unit: 'tk', unitPrice: 120 }, s)).toBe(true)
    expect(lineMatches({ description: 'Veebilehe hooldus', unit: 'tk', unitPrice: 100 }, s)).toBe(false)
  })

  it('creates a catalogue item from a line, or updates the one with the same description', () => {
    const l = { description: '  Veebilehe hooldus ', unit: 'kuu', unitPrice: 130, vatRate: 24 }
    const created = productFromLine(l, undefined, true)
    expect(created).toMatchObject({ description: 'Veebilehe hooldus', unit: 'kuu', unitPrice: 130, vatRate: 24 })
    const existing = product('p1', 'veebilehe hooldus', 120, { vatRate: 9 })
    expect(findProduct([existing], l.description)).toBe(existing)
    const updated = productFromLine(l, existing, false)
    expect(updated).toMatchObject({ id: 'p1', unitPrice: 130, vatRate: 9, createdAt: existing.createdAt })
  })
})
