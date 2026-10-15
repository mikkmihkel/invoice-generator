import { describe, expect, it } from 'vitest'
import { creditedAmount, creditNotesFor, outstandingAmount } from './settlement'
import type { Invoice } from './types'

const inv = (p: Partial<Invoice> & { amount: number }): Invoice =>
  ({
    id: p.id ?? p.number ?? 'x',
    number: '',
    type: 'invoice',
    status: 'issued',
    currency: 'EUR',
    vatScheme: 'not-registered',
    lines: [{ id: 'l', description: 'x', quantity: p.amount < 0 ? -1 : 1, unit: 'tk', unitPrice: Math.abs(p.amount), vatRate: 0 }],
    ...p,
  }) as unknown as Invoice

const original = inv({ id: 'a', number: '2026-0001', amount: 1180.18 })

describe('settlement', () => {
  it('has nothing credited without credit notes', () => {
    expect(creditedAmount(original, [original])).toBe(0)
    expect(outstandingAmount(original, [original])).toBe(1180.18)
  })

  it('sums issued credit notes referring to the invoice number', () => {
    const cn = inv({ id: 'b', number: '2026-0005', type: 'credit-note', creditedInvoiceNumber: '2026-0001', amount: -580.18 })
    const all = [original, cn]
    expect(creditNotesFor(original, all)).toEqual([cn])
    expect(creditedAmount(original, all)).toBe(-580.18)
    expect(outstandingAmount(original, all)).toBe(600)
  })

  it('ignores drafts, cancelled credit notes, other invoices and other currencies', () => {
    const all = [
      original,
      inv({ id: 'd', type: 'credit-note', status: 'draft', creditedInvoiceNumber: '2026-0001', amount: -100 }),
      inv({ id: 'c', number: '2026-0006', type: 'credit-note', status: 'cancelled', creditedInvoiceNumber: '2026-0001', amount: -100 }),
      inv({ id: 'o', number: '2026-0007', type: 'credit-note', creditedInvoiceNumber: '2026-0002', amount: -100 }),
      inv({ id: 'u', number: '2026-0008', type: 'credit-note', creditedInvoiceNumber: '2026-0001', currency: 'USD', amount: -100 }),
    ]
    expect(creditedAmount(original, all)).toBe(0)
  })

  it('treats a fully credited invoice as settled and clamps over-crediting at zero', () => {
    const full = inv({ id: 'b', number: '2026-0005', type: 'credit-note', creditedInvoiceNumber: ' 2026-0001 ', amount: -1180.18 })
    expect(outstandingAmount(original, [original, full])).toBe(0)
    const extra = inv({ id: 'e', number: '2026-0009', type: 'credit-note', creditedInvoiceNumber: '2026-0001', amount: -50 })
    expect(outstandingAmount(original, [original, full, extra])).toBe(0)
  })

  it('never credits a credit note or an unnumbered draft', () => {
    const cn = inv({ id: 'b', number: '2026-0005', type: 'credit-note', creditedInvoiceNumber: '2026-0001', amount: -10 })
    expect(creditNotesFor(cn, [cn])).toEqual([])
    expect(creditNotesFor(inv({ id: 'z', amount: 5 }), [cn])).toEqual([])
  })
})
