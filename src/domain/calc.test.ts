import { describe, expect, it } from 'vitest'
import { computeTotals, formatMoney, lineNetCents, roundMoney, toCents } from './calc'
import type { InvoiceLine, VatScheme } from './types'

let seq = 0
function line(quantity: number, unitPrice: number, vatRate = 24, discountPercent?: number): InvoiceLine {
  seq += 1
  return { id: `l${seq}`, description: 'x', unit: 'tk', quantity, unitPrice, vatRate, discountPercent }
}

function totals(lines: InvoiceLine[], vatScheme: VatScheme = 'domestic') {
  return computeTotals({ lines, vatScheme })
}

describe('roundMoney / toCents', () => {
  it('rounds half-up despite binary floating point noise', () => {
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(2.675)).toBe(2.68)
    expect(roundMoney(0.125)).toBe(0.13)
    expect(roundMoney(1.0049)).toBe(1)
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
    expect(roundMoney(1234567.895)).toBe(1234567.9)
  })
  it('rounds negative values away from zero (symmetric for credit notes)', () => {
    expect(roundMoney(-1.005)).toBe(-1.01)
    expect(roundMoney(-0.125)).toBe(-0.13)
    expect(roundMoney(-0.124)).toBe(-0.12)
  })
  it('treats non-finite values as 0', () => {
    expect(toCents(Number.NaN)).toBe(0)
    expect(toCents(Number.POSITIVE_INFINITY)).toBe(0)
    expect(roundMoney(-0)).toBe(0)
  })
})

describe('lineNetCents', () => {
  it('multiplies quantity and unit price and rounds once', () => {
    expect(lineNetCents(line(3, 33.335))).toBe(10001)
    expect(lineNetCents(line(0.5, 0.01))).toBe(1)
    expect(lineNetCents(line(1000, 0.0125))).toBe(1250)
  })
  it('applies discount before rounding', () => {
    expect(lineNetCents(line(1, 100, 24, 15))).toBe(8500)
    expect(lineNetCents(line(3, 9.99, 24, 10))).toBe(2697) // 26.973
    expect(lineNetCents(line(1, 10, 24, 100))).toBe(0)
  })
  it('clamps invalid discounts and ignores NaN input', () => {
    expect(lineNetCents(line(1, 10, 24, 150))).toBe(0)
    expect(lineNetCents(line(1, 10, 24, -5))).toBe(1000)
    expect(lineNetCents(line(Number.NaN, 10))).toBe(0)
  })
})

describe('computeTotals', () => {
  it('computes VAT on the sum per rate, not per line', () => {
    // 3 × 0.10 at 24%: per line 0.024 → 0.02 each (0.06), on the sum 0.30 × 24% = 0.072 → 0.07
    const t = totals([line(1, 0.1), line(1, 0.1), line(1, 0.1)])
    expect(t.vatBreakdown).toEqual([{ rate: 24, taxable: 0.3, vat: 0.07 }])
    expect(t.vat).toBe(0.07)
    expect(t.gross).toBe(0.37)
    expect(t.lines.map((l) => l.vat).reduce((a, b) => a + b, 0)).toBeCloseTo(0.07, 10)
    expect(t.lines.filter((l) => l.vat === 0.03)).toHaveLength(1)
  })

  it('handles mixed rates and sorts breakdown by rate descending', () => {
    const t = totals([line(1, 100, 24), line(2, 25, 9), line(1, 20, 13)])
    expect(t.vatBreakdown).toEqual([
      { rate: 24, taxable: 100, vat: 24 },
      { rate: 13, taxable: 20, vat: 2.6 },
      { rate: 9, taxable: 50, vat: 4.5 },
    ])
    expect(t.net).toBe(170)
    expect(t.vat).toBe(31.1)
    expect(t.gross).toBe(201.1)
    expect(t.showVat).toBe(true)
  })

  it('rounds VAT half-up', () => {
    expect(totals([line(1, 2.5, 13)]).vat).toBe(0.33) // 0.325
    expect(totals([line(1, 1.25, 9)]).vat).toBe(0.11) // 0.1125
  })

  it('includes domestic 0% lines in the breakdown', () => {
    const t = totals([line(1, 10, 24), line(1, 5, 0)])
    expect(t.vatBreakdown).toEqual([
      { rate: 24, taxable: 10, vat: 2.4 },
      { rate: 0, taxable: 5, vat: 0 },
    ])
  })

  it('applies discounts in totals', () => {
    const t = totals([line(2, 50, 24, 10)])
    expect(t.net).toBe(90)
    expect(t.vat).toBe(21.6)
    expect(t.gross).toBe(111.6)
  })

  it('handles credit notes with negative quantities as an exact mirror of the invoice', () => {
    const inv = totals([line(3, 33.335), line(1, 2.5, 13), line(7, 0.15, 9)])
    const credit = totals([line(-3, 33.335), line(-1, 2.5, 13), line(-7, 0.15, 9)])
    expect(credit.net).toBe(-inv.net)
    expect(credit.vat).toBe(-inv.vat)
    expect(credit.gross).toBe(-inv.gross)
    expect(credit.lines.map((l) => l.vat)).toEqual(inv.lines.map((l) => -l.vat))
    expect(credit.net).toBe(-103.56)
  })

  it('handles a negative discount line inside a positive invoice', () => {
    const t = totals([line(1, 100), line(1, -10)])
    expect(t.net).toBe(90)
    expect(t.vat).toBe(21.6)
    expect(t.lines.map((l) => l.vat)).toEqual([24, -2.4])
  })

  it('line totals always add up to the grand totals', () => {
    let x = 7
    const rand = () => {
      x = (x * 48271) % 2147483647
      return x / 2147483647
    }
    const rates = [24, 13, 9, 0]
    for (let run = 0; run < 200; run++) {
      const lines = Array.from({ length: 1 + Math.floor(rand() * 8) }, () =>
        line(
          Math.round((rand() * 20 - 4) * 100) / 100,
          Math.round(rand() * 10000) / 1000,
          rates[Math.floor(rand() * 4)],
          rand() < 0.3 ? Math.round(rand() * 50) : undefined,
        ),
      )
      const t = totals(lines)
      const cents = (v: number) => Math.round(v * 100)
      expect(t.lines.reduce((a, l) => a + cents(l.net), 0)).toBe(cents(t.net))
      expect(t.lines.reduce((a, l) => a + cents(l.vat), 0)).toBe(cents(t.vat))
      expect(t.lines.reduce((a, l) => a + cents(l.gross), 0)).toBe(cents(t.gross))
      expect(t.vatBreakdown.reduce((a, r) => a + cents(r.vat), 0)).toBe(cents(t.vat))
      expect(t.vatBreakdown.reduce((a, r) => a + cents(r.taxable), 0)).toBe(cents(t.net))
      for (const l of t.lines) expect(cents(l.gross)).toBe(cents(l.net) + cents(l.vat))
    }
  })

  it('charges no VAT and hides VAT for non-registered sellers', () => {
    const t = totals([line(2, 50, 24)], 'not-registered')
    expect(t).toMatchObject({ net: 100, vat: 0, gross: 100, showVat: false, vatBreakdown: [] })
    expect(t.lines[0]).toEqual({ lineId: expect.any(String), net: 100, vat: 0, gross: 100 })
  })

  it.each<VatScheme>(['eu-reverse-charge', 'eu-goods', 'export', 'exempt', 'domestic-reverse-charge'])(
    'shows a single 0%% row for %s',
    (scheme) => {
      const t = totals([line(2, 50, 24), line(1, 10, 9)], scheme)
      expect(t.showVat).toBe(true)
      expect(t.vat).toBe(0)
      expect(t.gross).toBe(110)
      expect(t.vatBreakdown).toEqual([{ rate: 0, taxable: 110, vat: 0 }])
    },
  )

  it('returns zeros for an invoice without lines', () => {
    expect(totals([])).toEqual({ lines: [], vatBreakdown: [], net: 0, vat: 0, gross: 0, showVat: true })
    expect(totals([], 'eu-goods').vatBreakdown).toEqual([])
  })
})

describe('formatMoney', () => {
  it('formats with two decimals', () => {
    expect(formatMoney(1234.5, 'en')).toBe('1,234.50')
    expect(formatMoney(12345.5, 'et', 'EUR').replace(/\s/g, ' ')).toBe('12 345,50 EUR')
  })
})
