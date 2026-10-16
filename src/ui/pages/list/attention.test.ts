import { describe, expect, it } from 'vitest'
import type { Invoice, InvoiceEvent } from '../../../domain'
import { addDaysISO, localTodayISO } from '../../util'
import { attentionGroups, attentionIds } from './attention'

const today = localTodayISO()

function doc(id: string, patch: Partial<Invoice> = {}): Invoice {
  return {
    id,
    number: `N-${id}`,
    type: 'invoice',
    status: 'issued',
    issueDate: addDaysISO(today, -5),
    dueDate: addDaysISO(today, 9),
    seller: { name: 'Müüja OÜ', address: { street: '', city: '', postalCode: '', country: 'EE' }, bankAccounts: [] } as unknown as Invoice['seller'],
    buyer: { kind: 'company', name: `Klient ${id}`, address: { street: '', city: '', postalCode: '', country: 'EE' } },
    bankAccountIds: [],
    lines: [{ id: 'l', description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 100, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic',
    language: 'et',
    templateId: 'classic',
    accentColor: '#000000',
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    ...patch,
  }
}

const late = (id: string, days = 20, patch: Partial<Invoice> = {}) => doc(id, { issueDate: addDaysISO(today, -days - 14), dueDate: addDaysISO(today, -days), ...patch })
const ev = (invoiceId: string, kind: InvoiceEvent['kind'], daysAgo: number): InvoiceEvent => ({ id: `${invoiceId}-${kind}-${daysAgo}`, invoiceId, kind, at: `${addDaysISO(today, -daysAgo)}T12:00:00.000Z` })
const keys = (groups: ReturnType<typeof attentionGroups>) => Object.fromEntries(groups.map((g) => [g.key, g.docs.map((d) => d.id)]))

describe('attentionGroups', () => {
  it('lists overdue invoices without a reminder in the last 7 days, longest overdue first', () => {
    const invoices = [late('a', 5), late('b', 30), late('c', 10), late('d', 12)]
    const events = [ev('a', 'sent', 20), ev('c', 'reminder', 3), ev('d', 'reminder', 7)]
    expect(keys(attentionGroups(invoices, events, today))).toEqual({ overdue: ['b', 'd', 'a'] })
  })

  it('lists issued documents that were not sent, leaving out overdue, paid, cancelled and credited ones', () => {
    const invoice = doc('inv')
    const credited = doc('full', { number: 'F-1' })
    const credit = doc('cn', { type: 'credit-note', creditedInvoiceNumber: 'F-1', lines: [{ id: 'l', description: 'x', quantity: -1, unit: 'tk', unitPrice: 100, vatRate: 24 }] })
    const invoices = [invoice, doc('sent'), doc('paid', { status: 'paid', paidAt: today }), doc('void', { status: 'cancelled' }), late('late'), credited, credit]
    const groups = attentionGroups(invoices, [ev('sent', 'sent', 1), ev('cn', 'sent', 1)], today)
    expect(keys(groups)).toEqual({ overdue: ['late'], unsent: ['inv'] })
  })

  it('lists open quotes that expire within 3 days', () => {
    const quote = (id: string, days: number, patch: Partial<Invoice> = {}) => doc(id, { type: 'quote', validUntil: addDaysISO(today, days), dueDate: addDaysISO(today, days), ...patch })
    const invoices = [quote('q3', 3), quote('q0', 0), quote('q4', 4), quote('old', -1), quote('acc', 1, { quoteAcceptedAt: today }), quote('draft', 1, { status: 'draft', number: '' })]
    expect(keys(attentionGroups(invoices, [], today))).toEqual({ quotes: ['q0', 'q3'] })
  })

  it('counts drafts and the recurring drafts prepared today', () => {
    const now = new Date().toISOString()
    const invoices = [
      doc('d1', { status: 'draft', number: '', updatedAt: '2026-01-02T10:00:00Z' }),
      doc('r1', { status: 'draft', number: '', recurringRuleId: 'rule', createdAt: now, updatedAt: now }),
      doc('r0', { status: 'draft', number: '', recurringRuleId: 'rule', createdAt: '2020-01-01T10:00:00Z', updatedAt: '2020-01-01T10:00:00Z' }),
      doc('qd', { type: 'quote', status: 'draft', number: '' }),
    ]
    const [drafts] = attentionGroups(invoices, [], today)
    expect(drafts).toMatchObject({ key: 'drafts', recurringToday: 1 })
    expect(drafts.docs.map((d) => d.id)).toEqual(['r1', 'd1', 'r0'])
  })

  it('orders the groups overdue, unsent, quotes, drafts and leaves out empty ones', () => {
    const invoices = [doc('d', { status: 'draft', number: '' }), doc('q', { type: 'quote', validUntil: today }), doc('u'), late('o')]
    const groups = attentionGroups(invoices, [], today)
    expect(groups.map((g) => g.key)).toEqual(['overdue', 'unsent', 'quotes', 'drafts'])
    expect(attentionIds(groups)).toEqual(['overdue:o', 'unsent:u', 'quotes:q', 'drafts:d'])
    expect(attentionGroups([doc('s', { status: 'paid', paidAt: today })], [], today)).toEqual([])
  })
})
