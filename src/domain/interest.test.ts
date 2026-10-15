import { describe, expect, it } from 'vitest'
import { daysOverdue, lateInterest } from './interest'

describe('daysOverdue', () => {
  it('counts whole days after the due date', () => {
    expect(daysOverdue('2026-10-01', '2026-10-17')).toBe(16)
    expect(daysOverdue('2026-02-27', '2026-03-02')).toBe(3)
  })

  it('is zero on or before the due date and for missing dates', () => {
    expect(daysOverdue('2026-10-15', '2026-10-15')).toBe(0)
    expect(daysOverdue('2026-10-20', '2026-10-15')).toBe(0)
    expect(daysOverdue(undefined, '2026-10-15')).toBe(0)
    expect(daysOverdue('', '2026-10-15')).toBe(0)
  })
})

describe('lateInterest', () => {
  it('is open amount × daily rate × days, in cents', () => {
    // 1481,68 × 0,05% × 16 = 11,85344
    expect(lateInterest(1481.68, 0.05, '2026-10-01', '2026-10-17')).toEqual({ days: 16, amount: 11.85 })
    // 1000 × 0,1% × 30 = 30
    expect(lateInterest(1000, 0.1, '2026-09-01', '2026-10-01')).toEqual({ days: 30, amount: 30 })
  })

  it('rounds half up on exact cents', () => {
    // 10,10 × 0,05% × 1 = 0,00505 → 0,01
    expect(lateInterest(10.1, 0.05, '2026-10-14', '2026-10-15').amount).toBe(0.01)
    // 9,90 × 0,05% × 1 = 0,00495 → 0,00
    expect(lateInterest(9.9, 0.05, '2026-10-14', '2026-10-15').amount).toBe(0)
  })

  it('does not suffer from binary floating point noise', () => {
    // 0.07 % per day is not exact in binary; 100 000 × 0,07% × 3 = 210
    expect(lateInterest(100000, 0.07, '2026-10-12', '2026-10-15').amount).toBe(210)
    expect(lateInterest(99_999_999.99, 0.5, '2026-01-01', '2026-12-31').amount).toBe(181_999_999.98)
  })

  it('is zero without a rate, an open amount or overdue days', () => {
    expect(lateInterest(500, undefined, '2026-10-01', '2026-10-15')).toEqual({ days: 14, amount: 0 })
    expect(lateInterest(500, 0, '2026-10-01', '2026-10-15').amount).toBe(0)
    expect(lateInterest(500, Number.NaN, '2026-10-01', '2026-10-15').amount).toBe(0)
    expect(lateInterest(0, 0.05, '2026-10-01', '2026-10-15').amount).toBe(0)
    expect(lateInterest(-20, 0.05, '2026-10-01', '2026-10-15').amount).toBe(0)
    expect(lateInterest(500, 0.05, '2026-10-20', '2026-10-15')).toEqual({ days: 0, amount: 0 })
  })
})
