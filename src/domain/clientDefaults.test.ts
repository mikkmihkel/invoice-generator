import { describe, expect, it } from 'vitest'
import { applyClientTerms, clientLateInterest, clientPaymentTermDays } from './clientDefaults'
import { addDays, createDefaultProfile, createEmptyInvoice } from './factory'
import { asQuote } from './quote'
import type { Client, CompanyProfile, Invoice } from './types'

function profile(): CompanyProfile {
  const p = createDefaultProfile()
  p.name = 'Müüja OÜ'
  p.defaults.paymentTermDays = 14
  p.defaults.lateInterestPercentPerDay = 0.05
  return p
}

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 'c-' + Math.random().toString(36).slice(2),
    kind: 'company',
    name: 'Ostja AS',
    address: { street: '', city: '', postalCode: '', country: 'EE' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const termOf = (inv: Invoice) => (Date.parse(inv.dueDate) - Date.parse(inv.issueDate)) / 86_400_000

describe('client defaults', () => {
  it('fall back to the company defaults', () => {
    const p = profile()
    expect(clientPaymentTermDays(p)).toBe(14)
    expect(clientPaymentTermDays(p, client())).toBe(14)
    expect(clientLateInterest(p, client())).toBe(0.05)
  })

  it('use the client card when set; a late interest of 0 means none', () => {
    const p = profile()
    expect(clientPaymentTermDays(p, client({ paymentTermDays: 30 }))).toBe(30)
    expect(clientPaymentTermDays(p, client({ paymentTermDays: 0 }))).toBe(0)
    expect(clientLateInterest(p, client({ lateInterestPercentPerDay: 0.1 }))).toBe(0.1)
    expect(clientLateInterest(p, client({ lateInterestPercentPerDay: 0 }))).toBeUndefined()
  })

  it('ignore malformed values from old or hand-edited backups', () => {
    const p = profile()
    const bad = client({ paymentTermDays: Number.NaN, lateInterestPercentPerDay: -1 })
    expect(clientPaymentTermDays(p, bad)).toBe(14)
    expect(clientLateInterest(p, bad)).toBe(0.05)
    expect(clientPaymentTermDays(p, { ...client(), paymentTermDays: '30' as unknown as number })).toBe(14)
  })

  it('apply to a new invoice created for the client', () => {
    const inv = createEmptyInvoice(profile(), client({ paymentTermDays: 30, lateInterestPercentPerDay: 0 }))
    expect(termOf(inv)).toBe(30)
    expect(inv).not.toHaveProperty('lateInterestPercentPerDay')
  })
})

describe('applyClientTerms', () => {
  const p = profile()
  const blank = () => createEmptyInvoice(p)

  it('moves untouched fields from the company default to the picked client', () => {
    const next = applyClientTerms(blank(), p, undefined, client({ paymentTermDays: 30, lateInterestPercentPerDay: 0.08 }))
    expect(termOf(next)).toBe(30)
    expect(next.lateInterestPercentPerDay).toBe(0.08)
  })

  it('keeps fields the user already changed in this draft', () => {
    const edited = { ...blank(), lateInterestPercentPerDay: 0.02 }
    edited.dueDate = addDays(edited.issueDate, 21)
    const next = applyClientTerms(edited, p, undefined, client({ paymentTermDays: 30, lateInterestPercentPerDay: 0.08 }))
    expect(termOf(next)).toBe(21)
    expect(next.lateInterestPercentPerDay).toBe(0.02)
  })

  it('returns to the company default when switching to a client without own defaults', () => {
    const a = client({ paymentTermDays: 30, lateInterestPercentPerDay: 0 })
    const forA = applyClientTerms(blank(), p, undefined, a)
    expect(forA).not.toHaveProperty('lateInterestPercentPerDay')
    const forB = applyClientTerms(forA, p, a, client())
    expect(termOf(forB)).toBe(14)
    expect(forB.lateInterestPercentPerDay).toBe(0.05)
  })

  it('leaves quotes and credit notes alone', () => {
    const c = client({ paymentTermDays: 30 })
    const quote = asQuote(blank())
    expect(applyClientTerms(quote, p, undefined, c)).toBe(quote)
    const credit: Invoice = { ...blank(), type: 'credit-note' }
    expect(applyClientTerms(credit, p, undefined, c)).toBe(credit)
  })
})
