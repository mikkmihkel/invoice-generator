import { describe, expect, it } from 'vitest'
import { creditedInvoiceOf, linkedCreditNotes, planDeletion, reinstatedByDeletion, releasableNumber, releaseNumbers, reopenBlocker } from './deletion'
import { holdsNumber, numberingFloor, numberingPeriod, sameNumberingPeriod } from './numbering'
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
    expect(releaseNumbers(series(), [a3], [a1, a2], [])).toMatchObject({ released: ['2026-0003'], profile: { numbering: { counters: { '2026': 3 } } } })
    expect(releaseNumbers(series(), [a2], [a1, a3], []).released).toEqual([])
  })

  it('gives back several numbers at the top of the series', () => {
    expect(releaseNumbers(series(), [a2, a3], [a1], []).profile.numbering.counters).toEqual({ '2026': 2 })
    expect(releaseNumbers(series(), [a1, a3], [a2], []).released).toEqual(['2026-0003'])
  })

  it('handles quotes in their own series and leaves numbers of another format alone', () => {
    const q = doc({ id: 'q', type: 'quote', number: 'HP-007' })
    expect(releaseNumbers(series(), [q], [], []).profile.quoteNumbering?.nextNumber).toBe(7)
    expect(releaseNumbers(series(), [doc({ id: 'x', number: 'OLD-0003' })], [], []).released).toEqual([])
    expect(releaseNumbers(series(), [doc({ id: 'd', status: 'draft' })], [], []).released).toEqual([])
  })

  it('never goes below a number another document still holds', () => {
    const dup = doc({ id: 'dup', number: '2026-0003' })
    expect(releaseNumbers(series(), [a3], [dup], []).released).toEqual([])
  })
})

describe('releasing only numbers that never left the app', () => {
  const top = doc({ id: 'top', number: '2026-0003' })

  it('keeps the number of a sent, reminded, paid, cancelled, credited or accepted document', () => {
    expect(releaseNumbers(series(), [top], [a1, a2], [{ invoiceId: 'top', kind: 'sent' }]).released).toEqual([])
    expect(releaseNumbers(series(), [top], [a1, a2], [{ invoiceId: 'top', kind: 'reminder' }]).released).toEqual([])
    expect(releaseNumbers(series(), [{ ...top, status: 'paid', paidAt: '2026-03-20' }], [a1, a2], []).released).toEqual([])
    expect(releaseNumbers(series(), [{ ...top, status: 'cancelled' }], [a1, a2], []).released).toEqual([])
    const cn = doc({ id: 'cn', type: 'credit-note', number: '2026-0004', creditedInvoiceNumber: '2026-0003' })
    expect(releaseNumbers(series({ counters: { '2026': 5 } }), [top, cn], [a1, a2], [{ invoiceId: 'cn', kind: 'sent' }]).released).toEqual([])
    const quote = doc({ id: 'q', type: 'quote', number: 'HP-007' })
    expect(releaseNumbers(series(), [{ ...quote, quoteAcceptedAt: '2026-03-12T10:00:00Z' }], [], []).released).toEqual([])
    expect(releaseNumbers(series(), [{ ...quote, convertedToInvoiceId: 'x' }], [], []).released).toEqual([])
    expect(releaseNumbers(series(), [quote], [doc({ id: 'x', status: 'draft', convertedFromQuoteId: 'q' })], []).released).toEqual([])
  })

  it('releases an unsent issued document and a reopened draft', () => {
    expect(releaseNumbers(series(), [top], [a1, a2], [{ invoiceId: 'a2', kind: 'sent' }]).released).toEqual(['2026-0003'])
    const reopened = { ...top, status: 'draft' as const, reopenedAt: '2026-03-11T10:00:00Z' }
    expect(releasableNumber(reopened, [reopened], [])).toBe(true)
    expect(releasableNumber(reopened, [reopened], [{ invoiceId: 'top', kind: 'sent' }])).toBe(false)
    expect(releasableNumber(doc({ id: 'd', status: 'draft' }), [], [])).toBe(false)
  })

  it('lists the numbers in ascending order', () => {
    const cn = doc({ id: 'cn', type: 'credit-note', number: '2026-0003', creditedInvoiceNumber: '2026-0002', status: 'draft', reopenedAt: '2026-03-11T10:00:00Z' })
    // An invoice with a credit note always keeps its own number; the gaps are listed in order.
    expect(planDeletion(a2, [a1, a2, cn], series(), [])).toMatchObject({ released: ['2026-0003'], gaps: ['2026-0002'] })
    const sent = planDeletion(a2, [a1, a2, cn], series(), [{ invoiceId: 'a2', kind: 'sent' }, { invoiceId: 'cn', kind: 'sent' }])
    expect(sent.gaps).toEqual(['2026-0002', '2026-0003'])
  })

  it('says which numbers stay because the document left the app', () => {
    const plan = planDeletion(top, [a1, a2, top], series(), [{ invoiceId: 'top', kind: 'sent' }])
    expect(plan).toMatchObject({ released: [], gaps: ['2026-0003'], kept: ['2026-0003'] })
  })
})

describe('deleting the credit note of a cancelled invoice', () => {
  const cancelled = doc({ id: 'inv', number: '2026-0001', status: 'cancelled' })
  const cn = doc({ id: 'cn', type: 'credit-note', number: '2026-0002', creditedInvoiceNumber: '2026-0001' })

  it('restores the invoice when no other credit note credits it', () => {
    expect(reinstatedByDeletion(cn, [cancelled, cn])).toEqual({ invoice: cancelled, status: 'issued' })
    const paid = { ...cancelled, paidAt: '2026-03-15' }
    expect(planDeletion(cn, [paid, cn], series(), []).reinstated).toEqual({ invoice: paid, status: 'paid' })
  })

  it('leaves it cancelled while another credit note credits it, and ignores drafts and issued invoices', () => {
    const other = doc({ id: 'cn2', type: 'credit-note', number: '2026-0003', creditedInvoiceNumber: '2026-0001' })
    expect(reinstatedByDeletion(cn, [cancelled, cn, other])).toBeUndefined()
    expect(reinstatedByDeletion(cn, [cancelled, cn, { ...other, status: 'draft', number: '' }])).toEqual({ invoice: cancelled, status: 'issued' })
    expect(reinstatedByDeletion(cn, [{ ...cancelled, status: 'issued' }, cn])).toBeUndefined()
    expect(reinstatedByDeletion({ ...cn, status: 'draft', number: '' }, [cancelled, cn])).toBeUndefined()
    expect(planDeletion(cn, [{ ...cancelled, status: 'issued' }, cn], series(), []).reinstated).toBeUndefined()
  })
})

describe('numbering period of a reopened document', () => {
  const yearly = series().numbering
  it('compares the reset period and the date tokens of the prefix', () => {
    expect(sameNumberingPeriod(yearly, '2026-01-01', '2026-12-31')).toBe(true)
    expect(sameNumberingPeriod(yearly, '2026-12-31', '2027-01-01')).toBe(false)
    expect(sameNumberingPeriod({ prefix: 'A-', padding: 3, nextNumber: 1 }, '2026-01-01', '2030-05-05')).toBe(true)
    expect(sameNumberingPeriod({ prefix: '{YYYY}{MM}-', padding: 3, nextNumber: 1 }, '2026-03-01', '2026-04-01')).toBe(false)
    expect(sameNumberingPeriod({ prefix: 'A-', padding: 3, nextNumber: 1, reset: 'monthly' }, '2026-03-01', '2026-03-31')).toBe(true)
  })

  it('gives the first and last day of the period', () => {
    expect(numberingPeriod(yearly, '2026-03-10')).toEqual({ start: '2026-01-01', end: '2026-12-31' })
    expect(numberingPeriod({ prefix: 'A-{YY}{MM}-', padding: 3, nextNumber: 1 }, '2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
    expect(numberingPeriod({ prefix: '{YYYYMMDD}', padding: 3, nextNumber: 1 }, '2026-03-10')).toEqual({ start: '2026-03-10', end: '2026-03-10' })
    expect(numberingPeriod({ prefix: 'A-', padding: 3, nextNumber: 1 }, '2026-03-10')).toBeNull()
  })
})

describe('planDeletion', () => {
  const cn = doc({ id: 'cn', type: 'credit-note', number: '2026-0003', creditedInvoiceNumber: '2026-0002' })
  const cnDraft = doc({ id: 'cnd', type: 'credit-note', status: 'draft', creditedInvoiceNumber: '2026-0002' })
  const all = [a1, a2, cn, cnDraft]

  it('deletes an invoice with its credit notes and tells which numbers come back', () => {
    const plan = planDeletion(a2, all, series(), [])
    expect(plan.documents.map((d) => d.id)).toEqual(['a2', 'cn', 'cnd'])
    expect(plan.creditNotes.map((d) => d.id)).toEqual(['cn', 'cnd'])
    expect(plan.numbered).toBe(true)
    // The invoice was credited by an issued credit note, so its number is not used again.
    expect(plan.released).toEqual(['2026-0003'])
    expect(plan.gaps).toEqual(['2026-0002'])
    expect(plan.kept).toEqual(['2026-0002'])
  })

  it('deletes a credit note on its own and names the invoice it credits', () => {
    const plan = planDeletion(cn, all, series(), [])
    expect(plan.documents).toEqual([cn])
    expect(plan.creditedInvoice).toBe(a2)
    expect(creditedInvoiceOf(cn, all)).toBe(a2)
    expect(linkedCreditNotes(a1, all)).toEqual([])
  })

  it('reports gaps, and a draft as unnumbered', () => {
    expect(planDeletion(a1, all, series(), [])).toMatchObject({ released: [], gaps: ['2026-0001'], kept: [] })
    expect(planDeletion(cnDraft, all, series(), [])).toMatchObject({ numbered: false, released: [], gaps: [] })
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
