import { beforeEach, describe, expect, it } from 'vitest'
import { createRepository, RepositoryError, type Repository } from './repository'
import { makeInvoice, makeProfile } from './testFixtures'

let repo: Repository
let counter = 0

beforeEach(async () => {
  repo = createRepository({ dbName: `delete-db-${++counter}-${Math.random()}` })
  await repo.saveProfile(makeProfile({ numbering: { prefix: 'A-', nextNumber: 1, padding: 3 } }))
})

/** Save and issue a draft; returns the issued record. */
async function issue(id: string, patch: Parameters<typeof makeInvoice>[1] = {}) {
  await repo.saveInvoice(makeInvoice(id, patch))
  return repo.issueInvoice(id)
}

const nextNumber = async () => (await repo.getProfile())!.numbering.nextNumber

describe('deleting issued documents', () => {
  it('gives the number back when the deleted invoice has the last number of its series', async () => {
    await issue('a')
    const b = await issue('b')
    expect(b.number).toBe('A-002')
    expect(await nextNumber()).toBe(3)
    const deleted = await repo.deleteInvoice('b')
    expect(deleted?.released).toEqual(['A-002'])
    expect(await repo.getInvoice('b')).toBeNull()
    expect(await nextNumber()).toBe(2)
    expect((await issue('c')).number).toBe('A-002')
  })

  it('leaves a gap when a later number has been issued', async () => {
    await issue('a')
    await issue('b')
    const deleted = await repo.deleteInvoice('a')
    expect(deleted?.released).toEqual([])
    expect(await nextNumber()).toBe(3)
    expect((await issue('c')).number).toBe('A-003')
  })

  it('deletes paid and cancelled invoices and quotes too, but keeps the numbers of paid and cancelled ones', async () => {
    await issue('p')
    await repo.markInvoicePaid('p', '2026-03-20')
    await issue('x')
    await repo.cancelInvoice('x')
    await issue('q', { type: 'quote', validUntil: '2026-04-10', dueDate: '2026-04-10' })
    for (const id of ['x', 'p', 'q']) await repo.deleteInvoice(id)
    expect(await repo.listInvoices()).toEqual([])
    expect(await nextNumber()).toBe(3)
    // The quote never left the app: its number comes back.
    expect((await repo.getProfile())!.quoteNumbering?.counters).toEqual({ '2026': 1 })
  })

  it('never hands out the number of a sent and paid invoice again', async () => {
    const a = await issue('a')
    await repo.addInvoiceEvent({ id: 'e1', invoiceId: 'a', kind: 'sent', at: '2026-03-11T10:00:00.000Z' })
    await repo.markInvoicePaid('a', '2026-03-20')
    const deleted = await repo.deleteInvoice('a')
    expect(deleted?.released).toEqual([])
    expect(await nextNumber()).toBe(2)
    const next = await issue('b', { buyer: { kind: 'company', name: 'Teine Klient OÜ', address: { street: 'Pikk 2', city: 'Tartu', postalCode: '51004', country: 'EE' } } })
    expect(next.number).not.toBe(a.number)
    expect(next.number).toBe('A-002')
  })

  it('keeps the numbers of a sent credit note, a reminded invoice and an accepted or converted quote', async () => {
    const inv = await issue('inv')
    const cn = await issue('cn', { type: 'credit-note', creditedInvoiceNumber: inv.number, lines: [{ id: 'l1', description: 'Tagasi', quantity: -1, unit: 'h', unitPrice: 50, vatRate: 24 }] })
    await repo.addInvoiceEvent({ id: 'e1', invoiceId: 'cn', kind: 'sent', at: '2026-03-11T10:00:00.000Z' })
    expect((await repo.deleteInvoice(cn.id))?.released).toEqual([])
    await repo.addInvoiceEvent({ id: 'e2', invoiceId: 'inv', kind: 'reminder', at: '2026-03-30T10:00:00.000Z' })
    expect((await repo.deleteInvoice('inv'))?.released).toEqual([])
    expect(await nextNumber()).toBe(3)

    const q1 = await issue('q1', { type: 'quote', validUntil: '2026-04-10', dueDate: '2026-04-10' })
    await repo.saveInvoice({ ...q1, quoteAcceptedAt: '2026-03-12T10:00:00.000Z' })
    expect((await repo.deleteInvoice('q1'))?.released).toEqual([])
    const q2 = await issue('q2', { type: 'quote', validUntil: '2026-04-10', dueDate: '2026-04-10' })
    await repo.saveInvoice(makeInvoice('from-q2', { convertedFromQuoteId: q2.id }))
    expect((await repo.deleteInvoice('q2'))?.released).toEqual([])
    expect((await repo.getProfile())!.quoteNumbering?.counters).toEqual({ '2026': 3 })
  })

  it('uses the counter of the deleted document’s period in a resetting series', async () => {
    await repo.saveProfile(makeProfile({ numbering: { prefix: '{YYYY}-', nextNumber: 1, padding: 3, reset: 'yearly', counters: {} } }), { allowLowerNumbering: true })
    await issue('y25', { issueDate: '2025-12-30', dueDate: '2026-01-13' })
    await issue('y26', { issueDate: '2026-01-05', dueDate: '2026-01-19' })
    expect((await repo.deleteInvoice('y25'))?.released).toEqual(['2025-001'])
    const counters = (await repo.getProfile())!.numbering.counters
    expect(counters).toEqual({ '2025': 1, '2026': 2 })
  })

  it('deletes an invoice together with its credit notes, events and recurring rules, and clears quote links', async () => {
    await issue('q', { type: 'quote', validUntil: '2026-04-10', dueDate: '2026-04-10' })
    const inv = await issue('inv', { convertedFromQuoteId: 'q' })
    await repo.saveInvoice({ ...(await repo.getInvoice('q'))!, convertedToInvoiceId: 'inv', quoteAcceptedAt: '2026-03-10T09:00:00.000Z' })
    const cn = await issue('cn', {
      type: 'credit-note',
      creditedInvoiceNumber: inv.number,
      lines: [{ id: 'l1', description: 'Konsultatsioon', quantity: -2, unit: 'h', unitPrice: 50, vatRate: 24 }],
    })
    await repo.saveInvoice(makeInvoice('cn-draft', { type: 'credit-note', creditedInvoiceNumber: inv.number }))
    await repo.addInvoiceEvent({ id: 'e1', invoiceId: 'inv', kind: 'sent', at: '2026-03-11T10:00:00.000Z' })
    await repo.addInvoiceEvent({ id: 'e2', invoiceId: 'q', kind: 'sent', at: '2026-03-09T10:00:00.000Z' })
    await repo.saveRecurringRule({ id: 'r1', sourceInvoiceId: 'inv', interval: 'monthly', nextDate: '2026-04-10', active: true, createdAt: '', updatedAt: '' })
    await repo.saveRecurringRule({ id: 'r2', sourceInvoiceId: 'other', interval: 'monthly', nextDate: '2026-04-10', active: true, createdAt: '', updatedAt: '' })
    expect(inv.number).toBe('A-001')
    expect(cn.number).toBe('A-002')

    const deleted = await repo.deleteInvoice('inv')
    expect(deleted?.invoices.map((i) => i.id)).toEqual(['inv', 'cn', 'cn-draft'])
    expect(deleted?.events.map((e) => e.id)).toEqual(['e1'])
    expect(deleted?.recurringRules.map((r) => r.id)).toEqual(['r1'])
    // The invoice was sent and credited: its number stays as a gap. The credit note never left the app.
    expect(deleted?.released).toEqual(['A-002'])
    expect((await repo.listInvoices()).map((i) => i.id)).toEqual(['q'])
    const quote = await repo.getInvoice('q')
    expect(quote?.convertedToInvoiceId).toBeUndefined()
    expect(quote?.quoteAcceptedAt).toBe('2026-03-10T09:00:00.000Z')
    expect((await repo.listInvoiceEvents()).map((e) => e.id)).toEqual(['e2'])
    expect((await repo.listRecurringRules()).map((r) => r.id)).toEqual(['r2'])
    expect(await nextNumber()).toBe(2)

    // Undo puts everything back and the series moves past the numbers again.
    await repo.restoreDeleted(deleted!)
    expect((await repo.listInvoices()).map((i) => i.id).sort()).toEqual(['cn', 'cn-draft', 'inv', 'q'])
    expect((await repo.getInvoice('q'))?.convertedToInvoiceId).toBe('inv')
    expect((await repo.listInvoiceEvents()).map((e) => e.id)).toEqual(['e2', 'e1'])
    expect((await repo.listRecurringRules()).map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    expect(await nextNumber()).toBe(3)
  })

  it('deletes a credit note on its own; the credited invoice stays', async () => {
    const inv = await issue('inv')
    await issue('cn', { type: 'credit-note', creditedInvoiceNumber: inv.number, lines: [{ id: 'l1', description: 'Tagasi', quantity: -1, unit: 'h', unitPrice: 50, vatRate: 24 }] })
    const deleted = await repo.deleteInvoice('cn')
    expect(deleted?.invoices.map((i) => i.id)).toEqual(['cn'])
    expect(await repo.getInvoice('inv')).not.toBeNull()
    expect(deleted?.released).toEqual(['A-002'])
  })

  it('cannot undo once the number has been given to another document', async () => {
    await issue('a')
    const deleted = await repo.deleteInvoice('a')
    await issue('b')
    await expect(repo.restoreDeleted(deleted!)).rejects.toMatchObject({ code: 'numbering' })
    expect(await repo.getInvoice('a')).toBeNull()
  })
})

describe('reopening issued documents', () => {
  it('turns an unsent invoice back into a draft that keeps its number, and issues it again under the same number', async () => {
    await issue('a')
    const b = await issue('b')
    const reopened = await repo.reopenInvoice('b')
    expect(reopened).toMatchObject({ status: 'draft', number: b.number })
    expect(reopened.reopenedAt).toBeTruthy()
    // Edits are allowed, a different number is not.
    await repo.saveInvoice({ ...reopened, notes: 'parandatud' })
    await expect(repo.saveInvoice({ ...reopened, number: 'A-999' })).rejects.toBeInstanceOf(RepositoryError)
    await expect(repo.saveInvoice({ ...reopened, reopenedAt: undefined })).rejects.toMatchObject({ code: 'immutable' })

    // Another document issued meanwhile does not take the reopened number.
    expect((await issue('c')).number).toBe('A-003')

    await repo.saveProfile({ ...(await repo.getProfile())!, name: 'Uus Nimi OÜ' })
    const again = await repo.issueInvoice('b')
    expect(again).toMatchObject({ status: 'issued', number: b.number, notes: 'parandatud', referenceNumber: b.referenceNumber })
    expect(again.seller.name).toBe('Uus Nimi OÜ')
    expect(again.reopenedAt).toBeUndefined()
    expect(await nextNumber()).toBe(4)
  })

  it('refuses sent, paid, cancelled and credited documents and drafts', async () => {
    await repo.saveInvoice(makeInvoice('d'))
    await expect(repo.reopenInvoice('d')).rejects.toMatchObject({ code: 'invalid-transition' })
    const sent = await issue('sent')
    await repo.addInvoiceEvent({ id: 'e1', invoiceId: 'sent', kind: 'sent', at: '2026-03-11T10:00:00.000Z' })
    await expect(repo.reopenInvoice(sent.id)).rejects.toMatchObject({ code: 'invalid-transition', message: expect.stringMatching(/sent/) })
    await issue('paid')
    await repo.markInvoicePaid('paid', '2026-03-20')
    await expect(repo.reopenInvoice('paid')).rejects.toMatchObject({ code: 'invalid-transition' })
    const credited = await issue('credited')
    await issue('cn', { type: 'credit-note', creditedInvoiceNumber: credited.number, lines: [{ id: 'l1', description: 'Tagasi', quantity: -1, unit: 'h', unitPrice: 50, vatRate: 24 }] })
    await expect(repo.reopenInvoice('credited')).rejects.toMatchObject({ code: 'invalid-transition' })
    expect((await repo.getInvoice('credited'))?.status).toBe('issued')
  })

  it('counts a reopened document as holding its number when restoring a backup', async () => {
    await issue('a')
    await repo.reopenInvoice('a')
    const backup = await repo.exportBackup()
    const other = createRepository({ dbName: `delete-db-other-${Math.random()}` })
    await other.importBackup({ ...backup, profile: { ...backup.profile!, numbering: { prefix: 'A-', nextNumber: 1, padding: 3 } } }, 'replace')
    expect((await other.getProfile())!.numbering.nextNumber).toBe(2)
  })

  it('merges a reopened draft with the issued copy from a backup by timestamp', async () => {
    const issued = await issue('a')
    const reopened = await repo.reopenInvoice('a')
    const older = { app: 'invoice-generator' as const, version: 2 as const, exportedAt: '', profile: null, settings: null, clients: [], invoices: [{ ...issued, updatedAt: '2020-01-01T00:00:00.000Z' }] }
    await repo.importBackup(older, 'merge')
    expect((await repo.getInvoice('a'))?.status).toBe('draft')
    await repo.importBackup({ ...older, invoices: [{ ...issued, updatedAt: '2999-01-01T00:00:00.000Z' }] }, 'merge')
    expect((await repo.getInvoice('a'))).toMatchObject({ status: 'issued', number: reopened.number })
  })
})

describe('deleting the credit note of a cancelled invoice', () => {
  const credit = (number: string) => ({ type: 'credit-note' as const, creditedInvoiceNumber: number, lines: [{ id: 'l1', description: 'Tagasi', quantity: -2, unit: 'h', unitPrice: 50, vatRate: 24 }] })

  it('restores the invoice to its previous status, and undo cancels it again', async () => {
    const inv = await issue('inv')
    await repo.markInvoicePaid('inv', '2026-03-20')
    await issue('cn', credit(inv.number))
    await repo.cancelInvoice('inv')
    const deleted = await repo.deleteInvoice('cn')
    expect(deleted?.reinstated?.map((i) => [i.id, i.status])).toEqual([['inv', 'cancelled']])
    expect(await repo.getInvoice('inv')).toMatchObject({ status: 'paid', paidAt: '2026-03-20' })
    await repo.restoreDeleted(deleted!)
    expect((await repo.getInvoice('inv'))?.status).toBe('cancelled')
    expect(await repo.getInvoice('cn')).not.toBeNull()
  })

  it('goes back to issued without a payment date and stays cancelled while another credit note credits it', async () => {
    const inv = await issue('inv')
    await issue('cn1', credit(inv.number))
    await issue('cn2', credit(inv.number))
    await repo.cancelInvoice('inv')
    expect((await repo.deleteInvoice('cn2'))?.reinstated).toBeUndefined()
    expect((await repo.getInvoice('inv'))?.status).toBe('cancelled')
    await repo.deleteInvoice('cn1')
    expect((await repo.getInvoice('inv'))?.status).toBe('issued')
  })
})

describe('reopened documents stay in their numbering period', () => {
  beforeEach(async () => {
    await repo.saveProfile(makeProfile({ numbering: { prefix: '{YYYY}-', nextNumber: 1, padding: 4, reset: 'yearly', counters: {} } }), { allowLowerNumbering: true })
  })

  it('refuses a date in another period, both when saving and when issuing again', async () => {
    await issue('a', { issueDate: '2026-03-10' })
    const reopened = await repo.reopenInvoice('a')
    expect(reopened.reopenedIssueDate).toBe('2026-03-10')
    await repo.saveInvoice({ ...reopened, issueDate: '2026-12-31', dueDate: '2027-01-14' })
    await expect(repo.saveInvoice({ ...reopened, issueDate: '2027-01-02', dueDate: '2027-01-16' })).rejects.toMatchObject({
      code: 'immutable',
      messages: { et: 'Muutmiseks avatud dokumendi kuupäev peab jääma samasse numeratsiooniperioodi, sest number jääb samaks.' },
    })
    await expect(repo.saveInvoice({ ...reopened, issueDate: '2025-12-30' })).rejects.toMatchObject({ code: 'immutable' })
    await expect(repo.saveInvoice({ ...reopened, reopenedIssueDate: '2027-01-02' })).rejects.toMatchObject({ code: 'immutable' })
    await expect(repo.saveInvoice({ ...reopened, type: 'quote' })).rejects.toMatchObject({ code: 'immutable' })
    const again = await repo.issueInvoice('a')
    expect(again).toMatchObject({ number: '2026-0001', issueDate: '2026-12-31' })
    expect(again.reopenedIssueDate).toBeUndefined()
  })

  it('refuses to issue a reopened document that reached another period by other means', async () => {
    await issue('a', { issueDate: '2026-03-10' })
    const reopened = await repo.reopenInvoice('a')
    // A record written by an import is not checked by saveInvoice.
    const backup = await repo.exportBackup()
    await repo.importBackup({ ...backup, invoices: [{ ...reopened, issueDate: '2027-01-05', dueDate: '2027-01-19', updatedAt: '2999-01-01T00:00:00.000Z' }] }, 'merge')
    await expect(repo.issueInvoice('a')).rejects.toMatchObject({ code: 'immutable' })
    expect((await repo.getInvoice('a'))?.status).toBe('draft')
  })
})

describe('credit notes of a reopened invoice', () => {
  it('cannot be issued while the invoice is open for editing', async () => {
    const inv = await issue('inv')
    await repo.saveInvoice(makeInvoice('cn', { type: 'credit-note', creditedInvoiceNumber: inv.number, lines: [{ id: 'l1', description: 'Tagasi', quantity: -1, unit: 'h', unitPrice: 50, vatRate: 24 }] }))
    await repo.reopenInvoice('inv')
    await expect(repo.issueInvoice('cn')).rejects.toMatchObject({ code: 'invalid-transition', messages: { et: expect.stringContaining('Arve A-001 on muutmiseks avatud') } })
    await repo.issueInvoice('inv')
    expect((await repo.issueInvoice('cn')).number).toBe('A-002')
  })
})

describe('deletion records', () => {
  it('keeps a record of each deleted document, exports it and drops it on undo', async () => {
    await issue('a')
    const deleted = await repo.deleteInvoice('a')
    const backup = await repo.exportBackup()
    expect(backup.deleted).toEqual([{ id: 'a', number: 'A-001', type: 'invoice', deletedAt: deleted!.deletedAt }])
    await repo.restoreDeleted(deleted!)
    expect((await repo.exportBackup()).deleted).toBeUndefined()
  })

  it('does not bring a deleted document back when merging a backup taken before the deletion', async () => {
    await issue('a')
    const before = await repo.exportBackup()
    await repo.deleteInvoice('a')
    // The number goes back to the series and is given to another document.
    const b = await issue('b')
    expect(b.number).toBe('A-001')
    const result = await repo.importBackup(before, 'merge')
    expect(result.invoices).toEqual({ written: 0, skipped: 1 })
    expect(result.duplicateNumbers).toEqual([])
    expect((await repo.listInvoices()).map((i) => i.id)).toEqual(['b'])
  })

  it('merges the records of a backup, and a later change of the document wins over its deletion', async () => {
    const a = await issue('a')
    const other = createRepository({ dbName: `delete-db-other-${Math.random()}` })
    await other.importBackup(await repo.exportBackup(), 'replace')
    await other.deleteInvoice('a')
    const fromOther = await other.exportBackup()
    expect(fromOther.deleted?.map((r) => r.id)).toEqual(['a'])
    await repo.importBackup({ ...fromOther, invoices: [{ ...a, updatedAt: '2000-01-01T00:00:00.000Z' }] }, 'merge')
    expect((await repo.exportBackup()).deleted?.map((r) => r.id)).toEqual(['a'])
    // The local copy stays (merge never deletes); a newer copy from a backup is still taken.
    await repo.importBackup({ ...fromOther, invoices: [{ ...a, notes: 'uuem', updatedAt: '2999-01-01T00:00:00.000Z' }] }, 'merge')
    expect((await repo.getInvoice('a'))?.notes).toBe('uuem')
  })

  it('replaces the records with those of the backup on a replace, and keeps at most the newest 1000', async () => {
    await issue('a')
    await repo.deleteInvoice('a')
    const many = Array.from({ length: 1005 }, (_, i) => ({ id: `d${i}`, number: `X-${i}`, type: 'invoice' as const, deletedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }))
    const backup = await repo.exportBackup()
    await repo.importBackup({ ...backup, deleted: many }, 'replace')
    const records = (await repo.exportBackup()).deleted!
    expect(records).toHaveLength(1000)
    expect(records[0].id).toBe('d5')
    expect(records.some((r) => r.id === 'a')).toBe(false)
  })
})
