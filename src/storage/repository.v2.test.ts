import { beforeEach, describe, expect, it } from 'vitest'
import type { BackupFile, InvoiceEvent, Product, RecurringRule } from '../domain/types'
import { parseBackup, serializeBackup } from './backup'
import { subscribe, type StorageChange } from './events'
import { createRepository, RepositoryError, type Repository } from './repository'
import { makeInvoice, makeProfile } from './testFixtures'

let dbCounter = 0
let repo: Repository
const fresh = () => createRepository({ dbName: `test-v2-${++dbCounter}-${Math.random()}` })

beforeEach(() => {
  repo = fresh()
})

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  description: `Toode ${id}`,
  unit: 'h',
  unitPrice: 50,
  vatRate: 24,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})
const rule = (id: string, over: Partial<RecurringRule> = {}): RecurringRule => ({
  id,
  sourceInvoiceId: 'src',
  interval: 'monthly',
  nextDate: '2026-11-01',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})
const event = (id: string, invoiceId: string, at: string, kind: InvoiceEvent['kind'] = 'sent'): InvoiceEvent => ({ id, invoiceId, kind, at })

const backupOf = (over: Partial<BackupFile> = {}): BackupFile => ({
  app: 'invoice-generator',
  version: 2,
  exportedAt: '2026-06-01T00:00:00.000Z',
  profile: null,
  settings: null,
  clients: [],
  invoices: [],
  ...over,
})

describe('products, recurring rules and invoice events', () => {
  it('CRUDs products sorted by description and notifies listeners', async () => {
    const changes: StorageChange[] = []
    const unsub = subscribe((c) => changes.push(c))
    await repo.saveProduct(product('b', { description: 'Õppetund' }))
    await repo.saveProduct(product('a', { description: 'Arendus', createdAt: '' }))
    const list = await repo.listProducts()
    expect(list.map((p) => p.id)).toEqual(['a', 'b'])
    expect(list[0].createdAt).toBeTruthy()
    await repo.deleteProduct('a')
    expect((await repo.listProducts()).map((p) => p.id)).toEqual(['b'])
    unsub()
    expect(changes.filter((c) => c.area === 'products').map((c) => c.id)).toEqual(['b', 'a', 'a'])
  })

  it('CRUDs recurring rules sorted by next date and rejects an invalid date', async () => {
    await repo.saveRecurringRule(rule('late', { nextDate: '2027-01-01' }))
    await repo.saveRecurringRule(rule('soon', { nextDate: '2026-11-01' }))
    expect((await repo.listRecurringRules()).map((r) => r.id)).toEqual(['soon', 'late'])
    await expect(repo.saveRecurringRule(rule('bad', { nextDate: '2026-02-30' }))).rejects.toBeInstanceOf(RepositoryError)
    await repo.saveRecurringRule(rule('soon', { active: false }))
    expect((await repo.listRecurringRules()).find((r) => r.id === 'soon')?.active).toBe(false)
    await repo.deleteRecurringRule('late')
    expect(await repo.listRecurringRules()).toHaveLength(1)
  })

  it('stores events per invoice, oldest first', async () => {
    await repo.addInvoiceEvent(event('e2', 'inv1', '2026-11-03T10:00:00.000Z', 'reminder'))
    await repo.addInvoiceEvent(event('e1', 'inv1', '2026-10-20T10:00:00.000Z', 'reminder'))
    await repo.addInvoiceEvent(event('e3', 'inv2', '2026-10-01T10:00:00.000Z'))
    expect((await repo.listInvoiceEvents('inv1')).map((e) => e.id)).toEqual(['e1', 'e2'])
    expect((await repo.listInvoiceEvents()).map((e) => e.id)).toEqual(['e3', 'e1', 'e2'])
    await repo.deleteInvoiceEvent('e1')
    expect((await repo.listInvoiceEvents('inv1')).map((e) => e.id)).toEqual(['e2'])
    await expect(repo.addInvoiceEvent({ ...event('', 'inv1', '') })).rejects.toBeInstanceOf(RepositoryError)
  })
})

describe('numbering with resets', () => {
  it('numbers per day from the issue date and never repeats a number', async () => {
    await repo.saveProfile(makeProfile({ numbering: { prefix: '{YYYYMMDD}', nextNumber: 1, padding: 3, reset: 'daily' } }))
    const issue = async (id: string, issueDate: string) => {
      await repo.saveInvoice(makeInvoice(id, { issueDate, dueDate: '2026-12-31' }))
      return (await repo.issueInvoice(id)).number
    }
    expect(await issue('a', '2026-10-15')).toBe('20261015001')
    expect(await issue('b', '2026-10-15')).toBe('20261015002')
    expect(await issue('c', '2026-10-16')).toBe('20261016001')
    const p = await repo.getProfile()
    expect(p?.numbering.counters).toEqual({ '2026-10-15': 3, '2026-10-16': 2 })
    // Lower the counter by hand: the used numbers are skipped.
    await repo.saveProfile({ ...p!, numbering: { ...p!.numbering, counters: { '2026-10-15': 1 } } })
    expect(await issue('d', '2026-10-15')).toBe('20261015003')
    expect((await repo.getProfile())?.numbering.counters?.['2026-10-15']).toBe(4)
  })

  it('derives the viitenumber from an 11-digit daily number', async () => {
    await repo.saveProfile(makeProfile({ numbering: { prefix: '{YYYYMMDD}', nextNumber: 1, padding: 3, reset: 'daily' } }))
    await repo.saveInvoice(makeInvoice('a', { issueDate: '2026-10-15', dueDate: '2026-10-29' }))
    expect((await repo.issueInvoice('a')).referenceNumber).toMatch(/^20261015001\d$/)
  })

  it('numbers quotes from their own series without a viitenumber and without consuming invoice numbers', async () => {
    await repo.saveProfile(makeProfile({ numbering: { prefix: '{YYYY}-', nextNumber: 5, padding: 4 } }))
    await repo.saveInvoice(makeInvoice('q', { type: 'quote', issueDate: '2026-10-15', dueDate: '2026-10-29', validUntil: '2026-10-29', referenceNumber: '13' }))
    await repo.saveInvoice(makeInvoice('i', { issueDate: '2026-10-15', dueDate: '2026-10-29' }))
    const q = await repo.issueInvoice('q')
    const i = await repo.issueInvoice('i')
    expect(q.number).toBe('HP-2026-001')
    expect(q.referenceNumber).toBeUndefined()
    expect(i.number).toBe('2026-0005')
    const p = await repo.getProfile()
    expect(p?.numbering.nextNumber).toBe(6)
    expect(p?.quoteNumbering).toMatchObject({ prefix: 'HP-{YYYY}-', counters: { '2026': 2 } })
  })

  it('lets an issued quote record its acceptance and conversion, but nothing else', async () => {
    await repo.saveProfile(makeProfile())
    await repo.saveInvoice(makeInvoice('q', { type: 'quote', issueDate: '2026-10-15', dueDate: '2026-10-29', validUntil: '2026-10-29' }))
    const q = await repo.issueInvoice('q')
    await repo.saveInvoice({ ...q, quoteAcceptedAt: '2026-10-16T08:00:00.000Z', convertedToInvoiceId: 'inv' })
    expect(await repo.getInvoice('q')).toMatchObject({ convertedToInvoiceId: 'inv' })
    await expect(repo.saveInvoice({ ...q, notes: 'muudetud' })).rejects.toMatchObject({ code: 'immutable' })

    await repo.saveInvoice(makeInvoice('i'))
    const inv = await repo.issueInvoice('i')
    await expect(repo.saveInvoice({ ...inv, convertedToInvoiceId: 'x' })).rejects.toMatchObject({ code: 'immutable' })
  })
})

describe('saving the profile from a stale copy', () => {
  it('never lowers the number series that another tab advanced', async () => {
    const dbName = `test-v2-tabs-${++dbCounter}-${Math.random()}`
    repo = createRepository({ dbName })
    const other = createRepository({ dbName })
    await repo.saveProfile(makeProfile({ numbering: { prefix: '{YYYY}-', nextNumber: 1, padding: 4, reset: 'yearly', counters: { '2025': 9 } } }))
    const stale = await repo.getProfile()
    // Meanwhile another tab issues an invoice and a quote.
    await other.saveInvoice(makeInvoice('i', { issueDate: '2026-10-15', dueDate: '2026-10-29' }))
    await other.saveInvoice(makeInvoice('q', { type: 'quote', issueDate: '2026-10-15', dueDate: '2026-10-29', validUntil: '2026-10-29' }))
    await other.issueInvoice('i')
    await other.issueInvoice('q')

    await repo.saveProfile({ ...stale!, name: 'Uus Nimi OÜ', numbering: { ...stale!.numbering, padding: 3 } })
    const p = await repo.getProfile()
    expect(p?.name).toBe('Uus Nimi OÜ')
    expect(p?.numbering).toEqual({ prefix: '{YYYY}-', nextNumber: 1, padding: 3, reset: 'yearly', counters: { '2025': 9, '2026': 2 } })
    expect(p?.quoteNumbering?.counters).toEqual({ '2026': 2 })
    await repo.saveInvoice(makeInvoice('j', { issueDate: '2026-10-16', dueDate: '2026-10-30' }))
    expect((await repo.issueInvoice('j')).number).toBe('2026-002')
  })

  it('lowers the next number only when asked to, per series', async () => {
    await repo.saveProfile(makeProfile({ numbering: { prefix: 'A-', nextNumber: 30, padding: 1 }, quoteNumbering: { prefix: 'HP-', nextNumber: 8, padding: 1 } }))
    const lower = makeProfile({ numbering: { prefix: 'A-', nextNumber: 12, padding: 1 }, quoteNumbering: { prefix: 'HP-', nextNumber: 2, padding: 1 } })
    await repo.saveProfile(lower)
    expect((await repo.getProfile())?.numbering.nextNumber).toBe(30)
    await repo.saveProfile(lower, { allowLowerNumbering: { invoice: true } })
    let p = await repo.getProfile()
    expect([p?.numbering.nextNumber, p?.quoteNumbering?.nextNumber]).toEqual([12, 8])
    await repo.saveProfile(lower, { allowLowerNumbering: true })
    p = await repo.getProfile()
    expect([p?.numbering.nextNumber, p?.quoteNumbering?.nextNumber]).toEqual([12, 2])
  })
})

describe('issued quotes', () => {
  it('can only be cancelled, never marked paid', async () => {
    await repo.saveProfile(makeProfile())
    await repo.saveInvoice(makeInvoice('q', { type: 'quote', issueDate: '2026-10-15', dueDate: '2026-10-29', validUntil: '2026-10-29' }))
    const q = await repo.issueInvoice('q')
    await expect(repo.markInvoicePaid('q', '2026-10-20')).rejects.toMatchObject({ code: 'invalid-transition' })
    await expect(repo.saveInvoice({ ...q, status: 'paid', paidAt: '2026-10-20' })).rejects.toMatchObject({ code: 'invalid-transition' })
    expect((await repo.getInvoice('q'))?.status).toBe('issued')
    expect(await repo.markInvoiceUnpaid('q')).toMatchObject({ status: 'issued' })
    expect((await repo.cancelInvoice('q')).status).toBe('cancelled')
  })
})

describe('backup version 2', () => {
  it('exports and restores products, rules and events', async () => {
    await repo.saveProfile(makeProfile())
    await repo.saveProduct(product('p1'))
    await repo.saveRecurringRule(rule('r1'))
    await repo.addInvoiceEvent(event('e1', 'inv1', '2026-10-20T10:00:00.000Z'))
    const backup = await repo.exportBackup()
    expect(backup.version).toBe(2)
    expect(backup.products).toHaveLength(1)
    expect(backup.recurringRules).toHaveLength(1)
    expect(backup.events).toHaveLength(1)

    const other = fresh()
    await other.saveProduct(product('stale'))
    const result = await other.importBackup(parseBackup(serializeBackup(backup)), 'replace')
    expect(result).toMatchObject({ products: { written: 1 }, recurringRules: { written: 1 }, events: { written: 1 } })
    expect((await other.listProducts()).map((p) => p.id)).toEqual(['p1'])
    expect((await other.listRecurringRules()).map((r) => r.id)).toEqual(['r1'])
    expect((await other.listInvoiceEvents('inv1')).map((e) => e.id)).toEqual(['e1'])
  })

  it('imports a version 1 backup (replace clears the new stores, merge keeps them)', async () => {
    await repo.saveProduct(product('keep'))
    await repo.importBackup(backupOf({ version: 1 }), 'merge')
    expect(await repo.listProducts()).toHaveLength(1)
    await repo.importBackup(backupOf({ version: 1 }), 'replace')
    expect(await repo.listProducts()).toHaveLength(0)
  })

  it('merges by updatedAt and adds unknown events only', async () => {
    await repo.saveProduct(product('p1', { description: 'local' }))
    await repo.addInvoiceEvent(event('e1', 'inv1', '2026-10-20T10:00:00.000Z'))
    const result = await repo.importBackup(
      backupOf({
        products: [product('p1', { description: 'old', updatedAt: '2020-01-01T00:00:00.000Z' }), product('p2')],
        recurringRules: [rule('r1')],
        events: [{ ...event('e1', 'inv1', '2026-10-20T10:00:00.000Z'), note: 'other' }, event('e2', 'inv1', '2026-10-21T10:00:00.000Z')],
      }),
      'merge',
    )
    expect(result.products).toEqual({ written: 1, skipped: 1 })
    expect(result.recurringRules).toEqual({ written: 1, skipped: 0 })
    expect(result.events).toEqual({ written: 1, skipped: 1 })
    expect((await repo.listProducts()).map((p) => p.description)).toEqual(['local', 'Toode p2'])
    expect((await repo.listInvoiceEvents('inv1')).find((e) => e.id === 'e1')?.note).toBeUndefined()
  })

  it('never lowers period counters or the quote series on import', async () => {
    await repo.saveProfile(
      makeProfile({
        numbering: { prefix: '{YYYY}-', nextNumber: 1, padding: 4, reset: 'yearly', counters: { '2026': 10 } },
        updatedAt: '2026-09-01T00:00:00.000Z',
      }),
    )
    await repo.importBackup(
      backupOf({
        profile: makeProfile({
          numbering: { prefix: '{YYYY}-', nextNumber: 1, padding: 4, reset: 'yearly', counters: { '2026': 2, '2025': 30 } },
          updatedAt: '2026-10-01T00:00:00.000Z',
        }),
        invoices: [
          makeInvoice('x', { number: '2026-0040', status: 'issued', issueDate: '2026-05-01' }),
          makeInvoice('q', { type: 'quote', number: 'HP-2026-007', status: 'issued', issueDate: '2026-05-01' }),
        ],
      }),
      'replace',
    )
    const p = await repo.getProfile()
    expect(p?.numbering.counters).toEqual({ '2026': 41, '2025': 30 })
    expect(p?.quoteNumbering?.counters).toEqual({ '2026': 8 })
    expect(p?.updatedAt).toBe('2026-10-01T00:00:00.000Z')
  })

  it('leaves an unused default quote series out of the profile', async () => {
    await repo.importBackup(backupOf({ profile: makeProfile() }), 'replace')
    expect((await repo.getProfile())?.quoteNumbering).toBeUndefined()
  })
})
