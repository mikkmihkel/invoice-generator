import { describe, expect, it } from 'vitest'
import type { Invoice } from '../../../domain'
import { makeInvoice } from '../../../storage/testFixtures'
import { hasPaymentDetails, paymentDetailsText } from './paymentDetails'

const issued = (patch: Partial<Invoice> = {}): Invoice =>
  makeInvoice('i1', { number: '2026-0012', status: 'issued', dueDate: '2026-10-30', referenceNumber: '202600127', bankAccountIds: [], ...patch })

describe('paymentDetailsText', () => {
  it('lists number, amount, payee, IBAN, reference and due date in Estonian', () => {
    expect(paymentDetailsText(issued(), 124)).toBe(
      ['Arve: 2026-0012', 'Summa: 124,00 €', 'Saaja: Mänguasjad OÜ', 'IBAN: EE38 2200 2210 2014 5685 (LHV)', 'Viitenumber: 202600127', 'Maksetähtaeg: 30.10.2026'].join('\n'),
    )
  })

  it('uses English for an English invoice and both for a bilingual one', () => {
    const en = paymentDetailsText(issued({ language: 'en' }), 1240.5)
    expect(en).toContain('Invoice: 2026-0012')
    expect(en).toContain('Amount: €1,240.50')
    expect(en).toContain('Reference number: 202600127')
    expect(en).toContain('Due date: 30 Oct')
    const both = paymentDetailsText(issued({ language: 'et-en' }), 10)
    expect(both).toContain('Summa / Amount: 10,00 €')
    expect(both).toContain('IBAN: EE38')
    expect(both).not.toContain('IBAN / IBAN')
  })

  it('leaves out what is missing, lists every selected account and uses plain spaces', () => {
    const seller = { ...issued().seller, bankAccounts: [{ id: 'a', iban: 'EE382200221020145685' }, { id: 'b', iban: 'EE471000001020145685', bankName: 'SEB' }] }
    const text = paymentDetailsText(issued({ referenceNumber: undefined, seller }), 1060.2)
    expect(text).not.toContain('Viitenumber')
    expect(text.match(/^IBAN: /gm)).toHaveLength(2)
    expect(text).toContain('Summa: 1 060,20 €')
    expect(text).not.toMatch(/[  ]/)
  })
})

describe('hasPaymentDetails', () => {
  it('holds for issued invoices that are still owed', () => {
    expect(hasPaymentDetails(issued(), [])).toBe(true)
    expect(hasPaymentDetails(issued({ type: 'prepayment' }), [])).toBe(true)
    expect(hasPaymentDetails(issued({ status: 'paid' }), [])).toBe(false)
    expect(hasPaymentDetails(issued({ status: 'draft', number: '' }), [])).toBe(false)
    expect(hasPaymentDetails(issued({ type: 'quote' }), [])).toBe(false)
    expect(hasPaymentDetails(issued({ type: 'credit-note' }), [])).toBe(false)
  })

  it('does not hold once credit notes settle the invoice', () => {
    const inv = issued()
    const credit = makeInvoice('c1', { type: 'credit-note', status: 'issued', number: 'K-1', creditedInvoiceNumber: inv.number, lines: inv.lines.map((l) => ({ ...l, quantity: -l.quantity })) })
    expect(hasPaymentDetails(inv, [inv, credit])).toBe(false)
  })
})
