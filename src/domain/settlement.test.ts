import { describe, expect, it } from 'vitest'
import { computeTotals } from './calc'
import { creditedAmount, creditNotesFor, isVoided, outstandingAmount, remainingCreditLines } from './settlement'
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

describe('isVoided', () => {
  it('only a document cancelled without an offsetting credit note counts as zero', () => {
    const cancelled = { ...original, status: 'cancelled' as const }
    const cn = inv({ id: 'b', number: '2026-0005', type: 'credit-note', creditedInvoiceNumber: '2026-0001', amount: -1180.18 })
    expect(isVoided(original, [original])).toBe(false)
    expect(isVoided(cancelled, [cancelled])).toBe(true)
    expect(isVoided(cancelled, [cancelled, cn])).toBe(false)
    expect(isVoided(cancelled, [cancelled, { ...cn, status: 'cancelled' }])).toBe(true)
    expect(isVoided({ ...cn, status: 'cancelled' }, [cancelled, cn])).toBe(true)
  })
})

describe('remainingCreditLines', () => {
  const label = (rate: number) => `Krediteerimata jääk (${rate}%)`
  const original2: Invoice = {
    ...original,
    id: 'r',
    number: '2026-0010',
    vatScheme: 'domestic',
    lines: [
      { id: 'l1', description: 'Arendus', quantity: 10, unit: 'h', unitPrice: 65, vatRate: 24 },
      { id: 'l2', description: 'Domeen', quantity: 1, unit: 'tk', unitPrice: 24.9, vatRate: 24 },
      { id: 'l3', description: 'Raamat', quantity: 2, unit: 'tk', unitPrice: 15, vatRate: 9 },
    ],
  }
  const cn = (id: string, lines: Invoice['lines']): Invoice => ({ ...original2, id, number: `CN-${id}`, type: 'credit-note', creditedInvoiceNumber: '2026-0010', lines })
  const settle = (lines: ReturnType<typeof remainingCreditLines>, all: Invoice[]) =>
    outstandingAmount(original2, [...all, cn('final', (lines ?? []).map((l, i) => ({ ...l, id: `n${i}` })))])

  it('reverses every line when nothing is credited yet', () => {
    const lines = remainingCreditLines(original2, [original2], label)
    expect(lines?.map((l) => [l.description, l.quantity])).toEqual([
      ['Arendus', -10],
      ['Domeen', -1],
      ['Raamat', -2],
    ])
    expect(lines?.every((l) => !('id' in l))).toBe(true)
    expect(settle(lines, [original2])).toBe(0)
  })

  it('credits only the remaining quantities after a partial credit note', () => {
    const partial = cn('p', [{ id: 'c1', description: 'Arendus', quantity: -4, unit: 'h', unitPrice: 65, vatRate: 24 }])
    const all = [original2, partial]
    const lines = remainingCreditLines(original2, all, label)
    expect(lines?.map((l) => [l.description, l.quantity])).toEqual([
      ['Arendus', -6],
      ['Domeen', -1],
      ['Raamat', -2],
    ])
    expect(settle(lines, all)).toBe(0)
  })

  it('falls back to one line per VAT rate when earlier credits do not match the lines', () => {
    const partial = cn('p', [{ id: 'c1', description: 'Allahindlus', quantity: -1, unit: '', unitPrice: 100, vatRate: 24 }])
    const all = [original2, partial]
    const lines = remainingCreditLines(original2, all, label)
    expect(lines).toEqual([
      { description: 'Krediteerimata jääk (24%)', quantity: -1, unit: '', unitPrice: 574.9, vatRate: 24 },
      { description: 'Krediteerimata jääk (9%)', quantity: -1, unit: '', unitPrice: 30, vatRate: 9 },
    ])
    expect(computeTotals({ ...original2, lines: (lines ?? []).map((l, i) => ({ ...l, id: String(i) })) }).gross).toBe(-745.58)
    expect(settle(lines, all)).toBe(0)
  })

  describe('with VAT rounded per rate', () => {
    const base: Invoice = { ...original2, id: 'v', number: '2026-0020', lines: [{ id: 'l1', description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 100.03, vatRate: 24 }] }
    const manual = (of: Invoice, lines: Invoice['lines']): Invoice => ({ ...of, id: 'm', number: 'CN-m', type: 'credit-note', creditedInvoiceNumber: of.number, lines })
    const outstanding = (of: Invoice, all: Invoice[], lines: ReturnType<typeof remainingCreditLines>) =>
      outstandingAmount(of, [...all, { ...manual(of, (lines ?? []).map((l, i) => ({ ...l, id: `n${i}` }))), id: 'final', number: 'CN-final' }])

    it('gives up instead of leaving a cent open', () => {
      // 124.04 € invoiced, 62.01 € credited: no single 24 % line comes to exactly 62.03 €.
      const all = [base, manual(base, [{ id: 'c', description: 'Hinnaalandus', quantity: -1, unit: '', unitPrice: 50.01, vatRate: 24 }])]
      expect(outstandingAmount(base, all)).toBe(62.03)
      expect(remainingCreditLines(base, all, label)).toBeNull()
    })

    it('moves the last line by a cent when that closes the gap', () => {
      const inv2: Invoice = { ...base, lines: [...base.lines, { id: 'l2', description: 'Raamat', quantity: 1, unit: 'tk', unitPrice: 10, vatRate: 9 }] }
      const all = [inv2, manual(inv2, [{ id: 'c', description: 'Hinnaalandus', quantity: -1, unit: '', unitPrice: 50.01, vatRate: 24 }])]
      const lines = remainingCreditLines(inv2, all, label)
      expect(lines?.map((l) => [l.vatRate, l.unitPrice])).toEqual([
        [24, 50.02],
        [9, 10.01],
      ])
      expect(outstanding(inv2, all, lines)).toBe(0)
    })

    it('gives up when one rate was credited beyond its amount', () => {
      const inv2: Invoice = {
        ...base,
        lines: [
          { id: 'l1', description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 100, vatRate: 24 },
          { id: 'l2', description: 'Raamat', quantity: 1, unit: 'tk', unitPrice: 100, vatRate: 9 },
        ],
      }
      const all = [inv2, manual(inv2, [{ id: 'c', description: 'Hinnaalandus', quantity: -1, unit: '', unitPrice: 150, vatRate: 24 }])]
      expect(remainingCreditLines(inv2, all, label)).toBeNull()
    })
  })

  it('returns nothing when the invoice is already fully credited', () => {
    const all = [original2, cn('f', original2.lines.map((l) => ({ ...l, quantity: -l.quantity })))]
    expect(remainingCreditLines(original2, all, label)).toEqual([])
  })
})
