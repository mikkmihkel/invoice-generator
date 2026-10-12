import { describe, expect, it } from 'vitest'
import { withVatScheme } from './scheme'
import type { InvoiceLine } from './types'

const line = (vatRate: number): InvoiceLine => ({ id: String(vatRate), description: 'x', quantity: 1, unit: 'tk', unitPrice: 10, vatRate })

describe('withVatScheme', () => {
  it('zeroes line rates for schemes without Estonian VAT', () => {
    const inv = withVatScheme({ vatScheme: 'domestic', lines: [line(24), line(9)] }, 'eu-reverse-charge', 24)
    expect(inv.vatScheme).toBe('eu-reverse-charge')
    expect(inv.lines.map((l) => l.vatRate)).toEqual([0, 0])
  })
  it('restores the default rate when switching back to domestic', () => {
    const inv = withVatScheme({ vatScheme: 'export', lines: [line(0)] }, 'domestic', 24)
    expect(inv.lines[0].vatRate).toBe(24)
  })
  it('keeps explicit rates when staying within domestic', () => {
    const inv = withVatScheme({ vatScheme: 'domestic', lines: [line(0), line(9)] }, 'domestic', 24)
    expect(inv.lines.map((l) => l.vatRate)).toEqual([0, 9])
  })
})
