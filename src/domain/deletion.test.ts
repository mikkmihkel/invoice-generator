import { describe, expect, it } from 'vitest'
import { creditedInvoiceOf, linkedCreditNotes, planDeletion, releaseNumbers, reopenBlocker } from './deletion'
import { holdsNumber, numberingFloor } from './numbering'
import type { CompanyProfile, Invoice } from './types'

const doc = (p: Partial<Invoice> & { id: string }): Invoice =>
  ({ number: '', type: 'invoice', status: 'issued', issueDate: '2026-03-10', ...p }) as unknown as Invoice

const series = (patch: Partial<CompanyProfile['numbering']> = {}): Pick<CompanyProfile, 'numbering' | 'quoteNumbering'> => ({
  numbering: { prefix: '{YYYY}-', padding: 4, nextNumber: 1, reset: 'yearly', counters: { '2026': 4 }, ...patch },
  quoteNumbering: { prefix: 'HP-', padding: 3, nextNumber: 8, reset: 'never' },
})

const a1 = doc({ id: 'a1', number: '2026-0001' })
const a2 = doc({ id: 'a2', number: '2026-0002' })
const a3 = doc({ id: 'a3', number: '2026-0003' })

describe('releaseNumbers', () => {
  it('gives back the last number of the period only', () => {
    expect(releaseNumbers(series(), [a3], [a1, a2])).toMatchObject({ released: ['2026-0003'], profile: { numbering: { counters: { '2026': 3 } } } })
    expect(releaseNumbers(series(), [a2], [a1, a3]).released).toEqual([])
  })

  it('gives back several numbers at the top of the series', () => {
    expect(releaseNumbers(series(), [a2, a3], [a1]).profile.numbering.counters).toEqual({ '2026': 2 })
    expect(releaseNumbers(series(), [a1, a3], [a2]).released).toEqual(['2026-0003'])
  })

  it('handles quotes in their own series and leaves numbers of another format alone', () => {
    const q = doc({ id: 'q', type: 'quote', number: 'HP-007' })
    expect(releaseNumbers(series(), [q], []).profile.quoteNumbering?.nextNumber).toBe(7)
    expect(releaseNumbers(series(), [doc({ id: 'x', number: 'OLD-0003' })], []).released).toEqual([])
    expect(releaseNumbers(series(), [doc({ id: 'd', status: 'draft' })], []).released).toEqual([])
  })

  it('never goes below a number another document still holds', () => {
    const dup = doc({ id: 'dup', number: '2026-0003' })
    expect(releaseNumbers(series(), [a3], [dup]).released).toEqual([])
  })
})

describe('planDeletion', () => {
  const cn = doc({ id: 'cn', type: 'credit-note', number: '2026-0003', creditedInvoiceNumber: '2026-0002' })
  const cnDraft = doc({ id: 'cnd', type: 'credit-note', status: 'draft', creditedInvoiceNumber: '2026-0002' })
  const all = [a1, a2, cn, cnDraft]

  it('deletes an invoice with its credit notes and tells which numbers come back', () => {
    const plan = planDeletion(a2, all, series())
    expect(plan.documents.map((d) => d.id)).toEqual(['a2', 'cn', 'cnd'])
    expect(plan.creditNotes.map((d) => d.id)).toEqual(['cn', 'cnd'])
    expect(plan.numbered).toBe(true)
    expect(plan.released.sort()).toEqual(['2026-0002', '2026-0003'])
    expect(plan.gaps).toEqual([])
  })

  it('deletes a credit note on its own and names the invoice it credits', () => {
    const plan = planDeletion(cn, all, series())
    expect(plan.documents).toEqual([cn])
    expect(plan.creditedInvoice).toBe(a2)
    expect(creditedInvoiceOf(cn, all)).toBe(a2)
    expect(linkedCreditNotes(a1, all)).toEqual([])
  })

  it('reports gaps, and a draft as unnumbered', () => {
    expect(planDeletion(a1, all, series())).toMatchObject({ released: [], gaps: ['2026-0001'] })
    expect(planDeletion(cnDraft, all, series())).toMatchObject({ numbered: false, released: [], gaps: [] })
  })
})

describe('reopenBlocker', () => {
  it('allows an issued, unsent document', () => {
    expect(reopenBlocker(a1, [a1], [])).toBeNull()
  })

  it('names the reason otherwise', () => {
    expect(reopenBlocker(doc({ id: 'd', status: 'draft' }), [], [])).toBe('not-issued')
    expect(reopenBlocker({ ...a1, status: 'paid' }, [], [])).toBe('paid')
    expect(reopenBlocker({ ...a1, status: 'cancelled' }, [], [])).toBe('cancelled')
    expect(reopenBlocker(a1, [a1], [{ invoiceId: 'a1', kind: 'sent' }])).toBe('sent')
    expect(reopenBlocker(a1, [a1], [{ invoiceId: 'a1', kind: 'reminder' }])).toBe('sent')
    expect(reopenBlocker(a1, [a1], [{ invoiceId: 'other', kind: 'sent' }])).toBeNull()
    const cn = doc({ id: 'cn', type: 'credit-note', number: '2026-0009', creditedInvoiceNumber: '2026-0001' })
    expect(reopenBlocker(a1, [a1, cn], [])).toBe('credited')
    expect(reopenBlocker(a1, [a1, { ...cn, status: 'draft', number: '' }], [])).toBeNull()
    const quote = doc({ id: 'q', type: 'quote', number: 'HP-001' })
    expect(reopenBlocker(quote, [quote, doc({ id: 'i', status: 'draft', convertedFromQuoteId: 'q' })], [])).toBe('accepted')
  })
})

describe('reopened documents hold their number', () => {
  it('counts a reopened draft in the numbering floor', () => {
    const reopened = { ...a3, status: 'draft' as const, reopenedAt: '2026-03-11T10:00:00Z' }
    expect(holdsNumber(reopened)).toBe(true)
    expect(holdsNumber({ ...reopened, reopenedAt: undefined })).toBe(false)
    expect(numberingFloor(series().numbering, [a1, reopened]).counters).toEqual({ '2026': 4 })
  })
})
