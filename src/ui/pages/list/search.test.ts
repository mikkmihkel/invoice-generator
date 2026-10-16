import { describe, expect, it } from 'vitest'
import type { Invoice } from '../../../domain'
import { parseAmountQuery, searchInvoice } from './search'

const inv = {
  id: 'a',
  number: '2026-0012',
  type: 'invoice',
  status: 'issued',
  buyer: { kind: 'company', name: 'Tartu Kohvik OÜ', registryCode: '16000002', email: 'arved@tartukohvik.ee', address: { street: '', city: '', postalCode: '', country: 'EE' } },
  referenceNumber: '202600127',
  orderReference: 'TK-17',
  lines: [
    { id: '1', description: 'Veebimajutus aastaks', quantity: 1, unit: 'tk', unitPrice: 1000, vatRate: 24 },
    { id: '2', description: 'Domeen', quantity: 1, unit: 'tk', unitPrice: 0.5, vatRate: 24 },
  ],
} as unknown as Invoice
const totals = { gross: 1240.62, net: 1000.5 }

describe('parseAmountQuery', () => {
  it('reads amounts the way people type them', () => {
    expect(parseAmountQuery('1240')).toEqual({ value: 1240, whole: true })
    expect(parseAmountQuery('1 240,00')).toEqual({ value: 1240, whole: false })
    expect(parseAmountQuery('1 240,62 €')).toEqual({ value: 1240.62, whole: false })
    expect(parseAmountQuery('1240.5')).toEqual({ value: 1240.5, whole: false })
    expect(parseAmountQuery('1.240,50')).toEqual({ value: 1240.5, whole: false })
    expect(parseAmountQuery('1,240.50')).toEqual({ value: 1240.5, whole: false })
    expect(parseAmountQuery('384 EUR')).toEqual({ value: 384, whole: true })
    // Three digits after a comma read as thousands, as in English.
    expect(parseAmountQuery('12,345')).toEqual({ value: 12345, whole: true })
  })

  it('is not an amount for words or other numbers', () => {
    expect(parseAmountQuery('kohvik')).toBeNull()
    expect(parseAmountQuery('2026-0012')).toBeNull()
    expect(parseAmountQuery('1,2,3')).toBeNull()
    expect(parseAmountQuery('')).toBeNull()
  })
})

describe('searchInvoice', () => {
  const field = (q: string) => searchInvoice(inv, q, totals)?.field ?? null

  it('finds the visible fields first', () => {
    expect(searchInvoice(inv, '0012', totals)).toEqual({ field: 'number', text: '2026-0012' })
    expect(field('KOHVIK')).toBe('client')
  })

  it('finds codes, references, the e-mail and line descriptions, and says which', () => {
    expect(field('16000002')).toBe('registryCode')
    expect(field('202600127')).toBe('reference')
    expect(field('tk-17')).toBe('orderReference')
    expect(field('arved@')).toBe('email')
    expect(searchInvoice(inv, 'majutus', totals)).toEqual({ field: 'line', text: 'Veebimajutus aastaks' })
  })

  it('finds the total and the amount without VAT, tolerant of how the amount is written', () => {
    expect(searchInvoice(inv, '1240', totals)).toEqual({ field: 'amount', text: '', amount: 1240.62 })
    expect(field('1 240,62')).toBe('amount')
    expect(field('1240.6')).toBeNull()
    expect(field('1000,50')).toBe('net')
    expect(field('1000')).toBe('net')
    expect(field('999')).toBeNull()
  })

  it('matches credit notes by the amount without the minus sign', () => {
    expect(searchInvoice(inv, '50', { gross: -50, net: -40.32 })?.field).toBe('amount')
  })

  it('finds nothing for an empty query or no match', () => {
    expect(searchInvoice(inv, '  ', totals)).toBeNull()
    expect(searchInvoice(inv, 'raamatupidamine', totals)).toBeNull()
  })
})
