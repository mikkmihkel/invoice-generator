import { describe, expect, it } from 'vitest'
import { createDefaultProfile } from './factory'
import { asQuote, createEmptyQuote, invoiceFromQuote, isQuote, isQuoteAccepted, markQuoteAccepted, quoteStatus, quoteToInvoiceDraft, quoteValidUntil } from './quote'
import type { CompanyProfile, Invoice } from './types'
import { validateInvoice } from './validation'

const TODAY = '2026-10-15'
const NOW = '2026-10-15T09:00:00.000Z'

function profile(): CompanyProfile {
  const p = createDefaultProfile()
  p.name = 'Näide OÜ'
  p.registryCode = '12417834'
  p.address = { street: 'Narva mnt 5', city: 'Tallinn', postalCode: '10117', country: 'EE' }
  p.bankAccounts = [{ id: 'b1', iban: 'EE382200221020145685' }]
  p.defaults.paymentTermDays = 10
  p.defaults.lateInterestPercentPerDay = 0.05
  p.defaults.paymentQr = true
  p.defaults.footerNote = 'Jalus'
  return p
}

function quote(overrides: Partial<Invoice> = {}): Invoice {
  const q = createEmptyQuote(profile(), undefined, '2026-10-01')
  return {
    ...q,
    id: 'q1',
    number: 'HP-2026-001',
    status: 'issued',
    buyer: { kind: 'company', name: 'Klient AS', registryCode: '10234957', email: 'arve@klient.ee', address: { street: 'B 2', city: 'Tartu', postalCode: '50101', country: 'EE' } },
    lines: [{ id: 'l1', description: 'Veebileht', quantity: 1, unit: 'tk', unitPrice: 1500, vatRate: 0, discountPercent: 10 }],
    currency: 'USD',
    notes: 'Hind sisaldab majutust',
    orderReference: 'PO-7',
    textBefore: ['Pakkumine vastavalt päringule'],
    textAfter: ['Tööde algus kokkuleppel'],
    templateId: 'bold',
    ...overrides,
  }
}

describe('createEmptyQuote', () => {
  it('is a quote valid for 14 days without payment fields', () => {
    const q = createEmptyQuote(profile(), undefined, TODAY)
    expect(isQuote(q)).toBe(true)
    expect(q).toMatchObject({ type: 'quote', status: 'draft', number: '', issueDate: TODAY, validUntil: '2026-10-29', dueDate: '2026-10-29' })
    expect(q.lateInterestPercentPerDay).toBeUndefined()
    expect(q.paymentQr).toBeUndefined()
    expect(q.referenceNumber).toBeUndefined()
    expect(q.footerNote).toBe('Jalus')
  })
  it('asQuote keeps a valid validity date and fixes a wrong one', () => {
    const inv = { ...quote(), type: 'invoice' as const, referenceNumber: '123', issueDate: TODAY }
    expect(asQuote({ ...inv, validUntil: '2026-11-30' }).validUntil).toBe('2026-11-30')
    expect(asQuote({ ...inv, validUntil: '2026-10-01' }).validUntil).toBe('2026-10-29')
    expect(asQuote(inv).referenceNumber).toBeUndefined()
    expect(quoteValidUntil(TODAY, 30)).toBe('2026-11-14')
  })
})

describe('quoteStatus', () => {
  it('draft, sent, expired, accepted, cancelled', () => {
    expect(quoteStatus(quote({ status: 'draft' }), TODAY)).toBe('draft')
    expect(quoteStatus(quote({ validUntil: TODAY }), TODAY)).toBe('sent')
    expect(quoteStatus(quote({ validUntil: '2026-10-14' }), TODAY)).toBe('expired')
    expect(quoteStatus(quote({ validUntil: '2026-10-14', quoteAcceptedAt: NOW }), TODAY)).toBe('accepted')
    expect(quoteStatus(quote({ status: 'cancelled', quoteAcceptedAt: NOW }), TODAY)).toBe('cancelled')
  })
  it('an invoice pointing to the quote is enough to count it accepted', () => {
    const q = quote({ validUntil: '2026-10-01' })
    const inv = { ...quoteToInvoiceDraft(q, profile(), TODAY, NOW), id: 'inv1' }
    expect(isQuoteAccepted(q)).toBe(false)
    expect(isQuoteAccepted(q, [inv])).toBe(true)
    expect(quoteStatus(q, TODAY, [q, inv])).toBe('accepted')
    expect(invoiceFromQuote(q, [q, inv])?.id).toBe('inv1')
    expect(invoiceFromQuote({ ...q, convertedToInvoiceId: 'inv1' }, [inv])?.id).toBe('inv1')
    expect(invoiceFromQuote(q, [q])).toBeUndefined()
  })
})

describe('quoteToInvoiceDraft', () => {
  it('copies the offer into an invoice draft dated today', () => {
    const q = quote()
    const d = quoteToInvoiceDraft(q, profile(), TODAY, NOW)
    expect(d.id).not.toBe(q.id)
    expect(d).toMatchObject({
      type: 'invoice',
      status: 'draft',
      number: '',
      issueDate: TODAY,
      dueDate: '2026-10-25',
      currency: 'USD',
      notes: 'Hind sisaldab majutust',
      orderReference: 'PO-7',
      textBefore: ['Pakkumine vastavalt päringule'],
      textAfter: ['Tööde algus kokkuleppel'],
      templateId: 'bold',
      convertedFromQuoteId: 'q1',
      lateInterestPercentPerDay: 0.05,
      paymentQr: true,
      bankAccountIds: ['b1'],
      createdAt: NOW,
    })
    expect(d.buyer).toEqual(q.buyer)
    expect(d.buyer).not.toBe(q.buyer)
    expect(d.lines).toHaveLength(1)
    expect(d.lines[0]).toMatchObject({ description: 'Veebileht', unitPrice: 1500, discountPercent: 10 })
    expect(d.lines[0].id).not.toBe('l1')
    expect(d.validUntil).toBeUndefined()
    expect(d.convertedToInvoiceId).toBeUndefined()
    expect(d.quoteAcceptedAt).toBeUndefined()
    expect(d.issuedAt).toBeUndefined()
  })
  it('records the conversion on the quote once', () => {
    const q = markQuoteAccepted(quote(), 'inv1', NOW)
    expect(q).toMatchObject({ convertedToInvoiceId: 'inv1', quoteAcceptedAt: NOW })
    expect(markQuoteAccepted(q, 'inv2', '2027-01-01T00:00:00.000Z').quoteAcceptedAt).toBe(NOW)
  })
})

describe('validateInvoice for quotes', () => {
  const fields = (inv: Invoice) => validateInvoice(inv, { today: TODAY }).map((i) => `${i.severity}:${i.field}`)

  it('a complete quote has no errors', () => {
    const q = quote({ currency: 'EUR', vatScheme: 'not-registered' })
    expect(fields(q).filter((f) => f.startsWith('error'))).toEqual([])
  })
  it('skips the invoice-only checks', () => {
    const q = quote({ dueDate: '', bankAccountIds: ['gone'], referenceNumber: '123', lateInterestPercentPerDay: -1, vatScheme: 'domestic', currency: 'USD' })
    q.seller = { ...q.seller, vatRegistered: true, vatNumber: 'EE100931558', bankAccounts: [] }
    q.lines[0].vatRate = 24
    const f = fields(q)
    expect(f).not.toContain('error:dueDate')
    expect(f.some((x) => x.includes('bankAccount'))).toBe(false)
    expect(f).not.toContain('error:referenceNumber')
    expect(f).not.toContain('error:lateInterestPercentPerDay')
    expect(f).not.toContain('error:eurExchangeRate')
  })
  it('checks the validity date', () => {
    expect(fields(quote({ validUntil: undefined }))).toContain('warning:validUntil')
    expect(fields(quote({ validUntil: '2026-13-01' }))).toContain('error:validUntil')
    expect(fields(quote({ validUntil: '2026-09-30' }))).toContain('error:validUntil')
  })
  it('still requires seller, buyer and lines, without invoice legal references', () => {
    const q = quote({ lines: [] })
    q.buyer = { ...q.buyer, name: '' }
    const issues = validateInvoice(q, { today: TODAY })
    const lines = issues.find((i) => i.field === 'lines')
    expect(lines?.message.et).toBe('Hinnapakkumisel peab olema vähemalt üks rida.')
    expect(lines?.legalBasis).toBeUndefined()
    const buyer = issues.find((i) => i.field === 'buyer.name')
    expect(buyer?.severity).toBe('error')
    expect(buyer?.legalBasis).toBeUndefined()
    expect(issues.find((i) => i.field === 'number')).toBeUndefined()
    expect(validateInvoice({ ...q, number: '' }, { today: TODAY }).find((i) => i.field === 'number')?.message.et).toBe('Hinnapakkumise number puudub.')
  })
  it('keeps VAT treatment checks', () => {
    const q = quote({ vatScheme: 'eu-reverse-charge', currency: 'EUR' })
    q.seller = { ...q.seller, vatRegistered: true, vatNumber: 'EE100931558' }
    expect(fields(q)).toContain('error:buyer.vatNumber')
  })
  it('a buyer address gap is only a warning on a quote', () => {
    const q = quote({ vatScheme: 'domestic', currency: 'EUR' })
    q.seller = { ...q.seller, vatRegistered: true, vatNumber: 'EE100931558' }
    q.lines[0].vatRate = 24
    q.buyer = { ...q.buyer, address: { street: '', city: '', postalCode: '', country: 'EE' } }
    expect(fields(q)).toContain('warning:buyer.address')
  })
})
