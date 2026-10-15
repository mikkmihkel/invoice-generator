import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupFormatError, parseBackup, serializeBackup } from './backup'
import { subscribe, type StorageChange } from './events'
import type { BackupFile, Invoice } from '../domain/types'
import { createRepository, highestUsedNumber, InvoiceValidationError, RepositoryError, requestPersistentStorage, type Repository } from './repository'
import { makeClient, makeInvoice, makeProfile } from './testFixtures'

let dbCounter = 0
let repo: Repository

beforeEach(() => {
  repo = createRepository({ dbName: `test-db-${++dbCounter}-${Math.random()}` })
})

describe('profile, clients, settings', () => {
  it('returns null profile until saved, then the saved profile with a fresh updatedAt', async () => {
    expect(await repo.getProfile()).toBeNull()
    await repo.saveProfile(makeProfile())
    const p = await repo.getProfile()
    expect(p?.name).toBe('Mänguasjad OÜ')
    expect(p!.updatedAt > '2026-01-01T00:00:00.000Z').toBe(true)
  })

  it('CRUDs clients sorted by name', async () => {
    await repo.saveClient(makeClient('b', { name: 'Õunapuu OÜ' }))
    await repo.saveClient(makeClient('a', { name: 'Aasa AS' }))
    expect((await repo.listClients()).map((c) => c.id)).toEqual(['a', 'b'])
    expect((await repo.getClient('a'))?.name).toBe('Aasa AS')
    await repo.saveClient(makeClient('a', { name: 'Aasa AS muudetud' }))
    expect((await repo.getClient('a'))?.name).toBe('Aasa AS muudetud')
    await repo.deleteClient('a')
    expect(await repo.getClient('a')).toBeNull()
    expect(await repo.listClients()).toHaveLength(1)
  })

  it('returns default settings when nothing is stored and persists saved settings', async () => {
    const defaults = await repo.getSettings()
    expect(defaults.uiLanguage).toBeDefined()
    await repo.saveSettings({ ...defaults, googleClientId: 'abc.apps.googleusercontent.com' })
    expect((await repo.getSettings()).googleClientId).toBe('abc.apps.googleusercontent.com')
  })
})

describe('invoices', () => {
  it('lists newest first by issueDate then createdAt', async () => {
    await repo.saveInvoice(makeInvoice('old', { issueDate: '2026-01-05' }))
    await repo.saveInvoice(makeInvoice('new1', { issueDate: '2026-02-01', createdAt: '2026-02-01T08:00:00.000Z' }))
    await repo.saveInvoice(makeInvoice('new2', { issueDate: '2026-02-01', createdAt: '2026-02-01T09:00:00.000Z' }))
    expect((await repo.listInvoices()).map((i) => i.id)).toEqual(['new2', 'new1', 'old'])
  })

  it('deletes drafts and reports what was removed', async () => {
    await repo.saveInvoice(makeInvoice('d'))
    const deleted = await repo.deleteInvoice('d')
    expect(deleted).toMatchObject({ invoices: [{ id: 'd' }], events: [], recurringRules: [], unlinked: [], released: [] })
    expect(await repo.getInvoice('d')).toBeNull()
    expect(await repo.deleteInvoice('missing')).toBeNull()
  })

  it('keeps number and status of issued invoices immutable via saveInvoice', async () => {
    await repo.saveProfile(makeProfile())
    await repo.saveInvoice(makeInvoice('x'))
    const issued = await repo.issueInvoice('x')
    await expect(repo.saveInvoice({ ...issued, number: '9999' })).rejects.toMatchObject({ code: 'immutable' })
    await expect(repo.saveInvoice({ ...issued, status: 'draft' })).rejects.toMatchObject({ code: 'immutable' })
    await expect(repo.saveInvoice({ ...issued, status: 'draft', reopenedAt: '2026-03-20T00:00:00.000Z' })).rejects.toMatchObject({ code: 'immutable' })
    await repo.saveInvoice({ ...issued, status: 'paid', paidAt: '2026-03-20' })
    expect((await repo.getInvoice('x'))?.status).toBe('paid')
  })

  it('does not let a draft leave the draft status through saveInvoice', async () => {
    await repo.saveInvoice(makeInvoice('d'))
    for (const status of ['issued', 'paid', 'cancelled'] as const) {
      await expect(repo.saveInvoice(makeInvoice('d', { status }))).rejects.toMatchObject({ code: 'invalid-transition' })
    }
    const stored = await repo.getInvoice('d')
    expect(stored?.status).toBe('draft')
    expect(stored?.number).toBe('')
    // Ordinary draft edits still work.
    await repo.saveInvoice(makeInvoice('d', { notes: 'edited' }))
    expect((await repo.getInvoice('d'))?.notes).toBe('edited')
  })
})

describe('issueInvoice', () => {
  it('snapshots the seller including the logo even when the draft has none', async () => {
    await repo.saveProfile(makeProfile({ logoDataUrl: 'data:image/png;base64,AAAA' }))
    const draft = makeInvoice('a')
    delete draft.seller.logoDataUrl
    await repo.saveInvoice(draft)
    expect((await repo.issueInvoice('a')).seller.logoDataUrl).toBe('data:image/png;base64,AAAA')
  })

  it('allocates sequential numbers, increments nextNumber and sets issued fields', async () => {
    await repo.saveProfile(makeProfile({ numbering: { prefix: 'ARVE-', nextNumber: 7, padding: 4 } }))
    await repo.saveInvoice(makeInvoice('a'))
    await repo.saveInvoice(makeInvoice('b'))
    const a = await repo.issueInvoice('a')
    const b = await repo.issueInvoice('b')
    expect(a.number).toBe('ARVE-0007')
    expect(b.number).toBe('ARVE-0008')
    expect(a.status).toBe('issued')
    expect(a.issuedAt).toBeTruthy()
    expect(a.referenceNumber).toMatch(/^\d+$/)
    expect((await repo.getProfile())?.numbering.nextNumber).toBe(9)
    expect(await repo.getInvoice('a')).toEqual(a)
  })

  it('replaces {YYYY} with the issue year', async () => {
    await repo.saveProfile(makeProfile({ numbering: { prefix: '{YYYY}-', nextNumber: 3, padding: 3 } }))
    await repo.saveInvoice(makeInvoice('a', { issueDate: '2027-01-02', dueDate: '2027-01-16' }))
    expect((await repo.issueInvoice('a')).number).toBe('2027-003')
  })

  it('skips numbers that are already used', async () => {
    await repo.saveProfile(makeProfile({ numbering: { prefix: 'A', nextNumber: 1, padding: 1 } }))
    // e.g. imported from another device
    await repo.importBackup(
      {
        app: 'invoice-generator',
        version: 1,
        exportedAt: '2026-03-01T00:00:00.000Z',
        profile: null,
        settings: null,
        clients: [],
        invoices: [makeInvoice('imp1', { number: 'A1', status: 'issued' }), makeInvoice('imp2', { number: 'A2', status: 'paid' })],
      },
      'merge',
    )
    await repo.saveInvoice(makeInvoice('new'))
    expect((await repo.issueInvoice('new')).number).toBe('A3')
    expect((await repo.getProfile())?.numbering.nextNumber).toBe(4)
  })

  it('never hands out the same number twice under concurrent issuing', async () => {
    await repo.saveProfile(makeProfile())
    const ids = ['a', 'b', 'c', 'd', 'e']
    for (const id of ids) await repo.saveInvoice(makeInvoice(id))
    const issued = await Promise.all(ids.map((id) => repo.issueInvoice(id)))
    const numbers = issued.map((i) => i.number)
    expect(new Set(numbers).size).toBe(5)
    expect([...numbers].sort()).toEqual(['2026-0001', '2026-0002', '2026-0003', '2026-0004', '2026-0005'])
  })

  it('snapshots the seller from the profile; later profile edits do not alter the issued invoice', async () => {
    await repo.saveProfile(makeProfile({ name: 'Vana Nimi OÜ' }))
    await repo.saveInvoice(makeInvoice('a', { seller: { ...makeInvoice('a').seller, name: 'stale' } }))
    const issued = await repo.issueInvoice('a')
    expect(issued.seller.name).toBe('Vana Nimi OÜ')
    expect(issued.seller).not.toHaveProperty('numbering')
    expect(issued.seller).not.toHaveProperty('defaults')
    expect(issued.seller).not.toHaveProperty('updatedAt')

    const p = (await repo.getProfile())!
    await repo.saveProfile({ ...p, name: 'Uus Nimi OÜ', bankAccounts: [{ id: 'z', iban: 'EE471000001020145685' }] })
    const stored = await repo.getInvoice('a')
    expect(stored?.seller.name).toBe('Vana Nimi OÜ')
    expect(stored?.seller.bankAccounts[0].iban).toBe('EE382200221020145685')
  })

  it('keeps an existing reference number', async () => {
    await repo.saveProfile(makeProfile())
    await repo.saveInvoice(makeInvoice('a', { referenceNumber: '1234561' }))
    expect((await repo.issueInvoice('a')).referenceNumber).toBe('1234561')
  })

  it('rejects already issued invoices and leaves numbering untouched', async () => {
    await repo.saveProfile(makeProfile())
    await repo.saveInvoice(makeInvoice('a'))
    await repo.issueInvoice('a')
    await expect(repo.issueInvoice('a')).rejects.toMatchObject({ code: 'not-draft' })
    expect((await repo.getProfile())?.numbering.nextNumber).toBe(2)
  })

  it('rejects invalid invoices with the validation issues and does not consume a number', async () => {
    await repo.saveProfile(makeProfile())
    await repo.saveInvoice(makeInvoice('a', { lines: [] }))
    const err = await repo.issueInvoice('a').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InvoiceValidationError)
    expect((err as InvoiceValidationError).issues.some((i) => i.severity === 'error')).toBe(true)
    expect((await repo.getInvoice('a'))?.status).toBe('draft')
    expect((await repo.getInvoice('a'))?.number).toBe('')
    expect((await repo.getProfile())?.numbering.nextNumber).toBe(1)
  })

  it('requires a profile and an existing invoice', async () => {
    await expect(repo.issueInvoice('nope')).rejects.toMatchObject({ code: 'not-found' })
    await repo.saveInvoice(makeInvoice('a'))
    await expect(repo.issueInvoice('a')).rejects.toMatchObject({ code: 'no-profile' })
  })
})

describe('backup', () => {
  async function seed(r: Repository) {
    await r.saveProfile(makeProfile())
    await r.saveSettings({ ...(await r.getSettings()), driveFolderName: 'Minu arved' })
    await r.saveClient(makeClient('c1'))
    await r.saveInvoice(makeInvoice('i1'))
    await r.issueInvoice('i1')
    await r.saveInvoice(makeInvoice('i2'))
  }

  it('roundtrips through JSON into a fresh database (replace)', async () => {
    await seed(repo)
    const backup = await repo.exportBackup()
    expect(backup.app).toBe('invoice-generator')
    expect(backup.version).toBe(2)
    const text = serializeBackup(backup)

    const other = createRepository({ dbName: `restore-${Math.random()}` })
    await other.saveClient(makeClient('will-be-wiped'))
    await other.importBackup(parseBackup(text), 'replace')
    expect(await other.getClient('will-be-wiped')).toBeNull()
    expect(await other.getProfile()).toEqual(await repo.getProfile())
    expect(await other.listClients()).toEqual(await repo.listClients())
    expect(await other.listInvoices()).toEqual(await repo.listInvoices())
    expect((await other.getSettings()).driveFolderName).toBe('Minu arved')
  })

  it('replace with a backup without profile clears the profile', async () => {
    await repo.saveProfile(makeProfile())
    await repo.importBackup({ app: 'invoice-generator', version: 1, exportedAt: '', profile: null, clients: [], invoices: [], settings: null }, 'replace')
    expect(await repo.getProfile()).toBeNull()
  })

  it('merge: newer updatedAt wins, unknown ids are added, local-only records are kept', async () => {
    const r = createRepository({ dbName: `merge-${Math.random()}`, now: () => '2026-05-01T00:00:00.000Z' })
    await r.saveClient(makeClient('same-newer-local', { name: 'local' }))
    await r.saveClient(makeClient('same-older-local', { name: 'local' }))
    await r.saveClient(makeClient('local-only'))
    await r.saveProfile(makeProfile({ name: 'Local OÜ', numbering: { prefix: 'X', nextNumber: 10, padding: 1 } }))

    const result = await r.importBackup(
      {
        app: 'invoice-generator',
        version: 1,
        exportedAt: '2026-06-01T00:00:00.000Z',
        profile: makeProfile({ name: 'Backup OÜ', numbering: { prefix: 'X', nextNumber: 5, padding: 1 }, updatedAt: '2026-06-01T00:00:00.000Z' }),
        settings: null,
        clients: [
          makeClient('same-newer-local', { name: 'backup', updatedAt: '2026-04-01T00:00:00.000Z' }),
          makeClient('same-older-local', { name: 'backup', updatedAt: '2026-06-01T00:00:00.000Z' }),
          makeClient('backup-only'),
        ],
        invoices: [],
      },
      'merge',
    )
    expect((await r.getClient('same-newer-local'))?.name).toBe('local')
    expect((await r.getClient('same-older-local'))?.name).toBe('backup')
    expect(await r.getClient('backup-only')).not.toBeNull()
    expect(await r.getClient('local-only')).not.toBeNull()
    const p = await r.getProfile()
    expect(p?.name).toBe('Backup OÜ')
    // the counter never goes backwards
    expect(p?.numbering.nextNumber).toBe(10)
    expect(result.clients).toEqual({ written: 2, skipped: 1 })
    expect(result.profile).toBe('written')
  })

  it('merge reports duplicate invoice numbers', async () => {
    await repo.saveInvoice(makeInvoice('a', { number: '2026-0001', status: 'issued' }))
    const result = await repo.importBackup(
      { app: 'invoice-generator', version: 1, exportedAt: '', profile: null, settings: null, clients: [], invoices: [makeInvoice('b', { number: '2026-0001', status: 'issued' })] },
      'merge',
    )
    expect(result.duplicateNumbers).toEqual(['2026-0001'])
  })

  it('rejects invalid backups without touching data', async () => {
    await repo.saveClient(makeClient('keep'))
    expect(() => parseBackup('not json')).toThrow(BackupFormatError)
    expect(() => parseBackup(JSON.stringify({ app: 'other', version: 1 }))).toThrow(BackupFormatError)
    expect(() => parseBackup(JSON.stringify({ app: 'invoice-generator', version: 3, clients: [], invoices: [] }))).toThrow(/version/)
    expect(() => parseBackup(JSON.stringify({ app: 'invoice-generator', version: 0, clients: [], invoices: [] }))).toThrow(/version/)
    expect(() => parseBackup(JSON.stringify({ app: 'invoice-generator', version: 1.5, clients: [], invoices: [] }))).toThrow(/version/)
    expect(() => parseBackup(JSON.stringify({ app: 'invoice-generator', version: 1, clients: {}, invoices: [] }))).toThrow(BackupFormatError)
    expect(() =>
      parseBackup(JSON.stringify({ app: 'invoice-generator', version: 1, clients: [], invoices: [{ ...makeInvoice('x'), status: 'weird' }] })),
    ).toThrow(/status/)
    await expect(repo.importBackup({ app: 'nope' } as never, 'replace')).rejects.toBeInstanceOf(BackupFormatError)
    expect(await repo.getClient('keep')).not.toBeNull()
  })
})

describe('change notifications', () => {
  it('notifies subscribers after writes and stops after unsubscribe', async () => {
    const changes: StorageChange[] = []
    const unsubscribe = subscribe((c) => changes.push(c))
    await repo.saveClient(makeClient('c1'))
    await repo.saveSettings(await repo.getSettings())
    unsubscribe()
    await repo.saveClient(makeClient('c2'))
    expect(changes).toEqual([
      { area: 'clients', id: 'c1', source: 'local' },
      { area: 'settings', id: undefined, source: 'local' },
    ])
  })
})

describe('requestPersistentStorage', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'storage')
  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'storage', original)
    else delete (navigator as unknown as Record<string, unknown>).storage
  })

  it('returns false when the API is missing', async () => {
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
    expect(await requestPersistentStorage()).toBe(false)
  })

  it('asks for persistence when not yet persisted', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    Object.defineProperty(navigator, 'storage', { value: { persisted: vi.fn().mockResolvedValue(false), persist }, configurable: true })
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).toHaveBeenCalled()
  })
})

const backupOf = (over: Partial<BackupFile> = {}): BackupFile => ({
  app: 'invoice-generator',
  version: 1,
  exportedAt: '2026-06-01T00:00:00.000Z',
  profile: null,
  settings: null,
  clients: [],
  invoices: [],
  ...over,
})

describe('issued invoices are locked', () => {
  async function issued(r: Repository = repo) {
    await r.saveProfile(makeProfile())
    await r.saveInvoice(makeInvoice('x'))
    return r.issueInvoice('x')
  }

  it('rejects any edit other than status / paidAt', async () => {
    const inv = await issued()
    const attempts: Partial<Invoice>[] = [
      { lines: [{ ...inv.lines[0], unitPrice: 999 }] },
      { buyer: { ...inv.buyer, name: 'Teine AS' } },
      { seller: { ...inv.seller, name: 'Muu OÜ' } },
      { dueDate: '2026-12-31' },
      { notes: 'lisatud märkus' },
      { issuedAt: '2020-01-01T00:00:00.000Z' },
      { createdAt: '2020-01-01T00:00:00.000Z' },
    ]
    for (const change of attempts) {
      const err = await repo.saveInvoice({ ...inv, ...change }).catch((e: unknown) => e)
      expect(err, JSON.stringify(change)).toBeInstanceOf(RepositoryError)
      expect((err as RepositoryError).code).toBe('immutable')
      expect((err as RepositoryError).messages.et).toMatch(/Väljastatud arvet ei saa muuta/)
    }
    expect(await repo.getInvoice('x')).toEqual(inv)
  })

  it('allows re-saving an unchanged copy (undefined props count as absent) and payment status changes', async () => {
    const inv = await issued()
    await repo.saveInvoice({ ...inv, notes: undefined, updatedAt: 'whatever' })
    await repo.saveInvoice({ ...inv, status: 'paid', paidAt: '2026-03-20' })
    await repo.saveInvoice({ ...inv, status: 'issued', paidAt: undefined })
    expect((await repo.getInvoice('x'))?.status).toBe('issued')
    await repo.saveInvoice({ ...inv, status: 'cancelled' })
    expect((await repo.getInvoice('x'))?.status).toBe('cancelled')
  })

  it('never lets a cancelled invoice change status again', async () => {
    const inv = await issued()
    await repo.saveInvoice({ ...inv, status: 'cancelled' })
    for (const status of ['issued', 'paid', 'draft'] as const) {
      await expect(repo.saveInvoice({ ...inv, status })).rejects.toMatchObject({ code: 'immutable' })
    }
  })

  it('keeps drafts freely editable', async () => {
    await repo.saveInvoice(makeInvoice('d'))
    await repo.saveInvoice(makeInvoice('d', { notes: 'muudetud', lines: [] }))
    expect((await repo.getInvoice('d'))?.notes).toBe('muudetud')
  })

  it('importBackup (restore) bypasses the lock', async () => {
    const inv = await issued()
    await repo.importBackup(backupOf({ invoices: [{ ...inv, notes: 'taastatud' }] }), 'replace')
    expect((await repo.getInvoice('x'))?.notes).toBe('taastatud')
  })
})

describe('invoice status methods', () => {
  async function issued() {
    await repo.saveProfile(makeProfile())
    await repo.saveInvoice(makeInvoice('x'))
    return repo.issueInvoice('x')
  }

  it('markInvoicePaid / markInvoiceUnpaid / cancelInvoice update the stored record and emit changes', async () => {
    await issued()
    const changes: StorageChange[] = []
    const unsubscribe = subscribe((c) => changes.push(c))
    const paid = await repo.markInvoicePaid('x', '2026-03-20')
    expect(paid).toMatchObject({ status: 'paid', paidAt: '2026-03-20' })
    expect(await repo.getInvoice('x')).toEqual(paid)
    // correcting the payment date is allowed
    expect((await repo.markInvoicePaid('x', '2026-03-21')).paidAt).toBe('2026-03-21')

    const unpaid = await repo.markInvoiceUnpaid('x')
    expect(unpaid.status).toBe('issued')
    expect(unpaid).not.toHaveProperty('paidAt')
    expect(await repo.getInvoice('x')).toEqual(unpaid)

    await repo.markInvoicePaid('x', '2026-03-22')
    const cancelled = await repo.cancelInvoice('x')
    expect(cancelled).toMatchObject({ status: 'cancelled', paidAt: '2026-03-22' })
    unsubscribe()
    expect(changes.filter((c) => c.area === 'invoices' && c.id === 'x')).toHaveLength(5)
  })

  it('a stale UI copy cannot overwrite fields or lose paidAt', async () => {
    const stale = await issued()
    await repo.markInvoicePaid('x', '2026-03-20')
    // UI still holds the pre-payment copy and tries to save it with an edit
    await expect(repo.saveInvoice({ ...stale, notes: 'muudetud' })).rejects.toMatchObject({ code: 'immutable' })
    const cancelled = await repo.cancelInvoice('x')
    expect(cancelled.paidAt).toBe('2026-03-20')
    expect(cancelled.lines).toEqual(stale.lines)
  })

  it('validates transitions', async () => {
    await repo.saveInvoice(makeInvoice('d'))
    await expect(repo.markInvoicePaid('d', '2026-03-20')).rejects.toMatchObject({ code: 'invalid-transition' })
    await expect(repo.markInvoiceUnpaid('d')).rejects.toMatchObject({ code: 'invalid-transition' })
    await expect(repo.cancelInvoice('d')).rejects.toMatchObject({ code: 'invalid-transition' })
    expect((await repo.getInvoice('d'))?.status).toBe('draft')

    await issued()
    await expect(repo.markInvoicePaid('x', '2026-02-30')).rejects.toMatchObject({ code: 'invalid-input' })
    await repo.cancelInvoice('x')
    await expect(repo.markInvoicePaid('x', '2026-03-20')).rejects.toMatchObject({ code: 'invalid-transition' })
    await expect(repo.markInvoiceUnpaid('x')).rejects.toMatchObject({ code: 'invalid-transition' })
    // idempotent
    expect((await repo.cancelInvoice('x')).status).toBe('cancelled')
    await expect(repo.cancelInvoice('missing')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('markInvoiceUnpaid on an issued invoice is a no-op', async () => {
    const inv = await issued()
    expect(await repo.markInvoiceUnpaid('x')).toEqual(inv)
  })
})

describe('import: merge rules and numbering', () => {
  const T = (d: string) => `2026-${d}T00:00:00.000Z`

  it('an issued invoice always beats a draft with the same id, regardless of timestamps', async () => {
    await repo.saveInvoice(makeInvoice('local-issued', { number: 'A1', status: 'issued', updatedAt: T('01-01') }))
    await repo.saveInvoice(makeInvoice('local-draft', { notes: 'local' }))
    const result = await repo.importBackup(
      backupOf({
        invoices: [
          makeInvoice('local-issued', { status: 'draft', notes: 'newer draft', updatedAt: T('12-01') }),
          makeInvoice('local-draft', { number: 'A2', status: 'paid', updatedAt: T('01-01') }),
        ],
      }),
      'merge',
    )
    expect(await repo.getInvoice('local-issued')).toMatchObject({ status: 'issued', number: 'A1' })
    expect(await repo.getInvoice('local-draft')).toMatchObject({ status: 'paid', number: 'A2' })
    expect(result.invoices).toEqual({ written: 1, skipped: 1 })
  })

  it('between two non-drafts the newer wins but the number never changes', async () => {
    await repo.saveInvoice(makeInvoice('i', { number: 'A1', status: 'issued' }))
    await repo.importBackup(
      backupOf({ invoices: [makeInvoice('i', { number: 'A9', status: 'paid', paidAt: '2026-11-01', updatedAt: '2099-01-01T00:00:00.000Z' })] }),
      'merge',
    )
    expect(await repo.getInvoice('i')).toMatchObject({ status: 'paid', number: 'A1', paidAt: '2026-11-01' })
    await repo.importBackup(backupOf({ invoices: [makeInvoice('i', { number: 'A1', status: 'issued', updatedAt: T('01-01') })] }), 'merge')
    expect((await repo.getInvoice('i'))?.status).toBe('paid')
  })

  it('keeps both invoices when different ids share a number and reports it', async () => {
    await repo.saveInvoice(makeInvoice('a', { number: 'A1', status: 'issued' }))
    const result = await repo.importBackup(backupOf({ invoices: [makeInvoice('b', { number: 'A1', status: 'paid' })] }), 'merge')
    expect(await repo.getInvoice('a')).not.toBeNull()
    expect(await repo.getInvoice('b')).not.toBeNull()
    expect(result.duplicateNumbers).toEqual(['A1'])
  })

  it('merge keeps the higher nextNumber even when the local profile wins by timestamp', async () => {
    const r = createRepository({ dbName: `num-${Math.random()}`, now: () => T('09-01') })
    await r.saveProfile(makeProfile({ name: 'Local', numbering: { prefix: 'A', nextNumber: 3, padding: 1 } }))
    const result = await r.importBackup(
      backupOf({ profile: makeProfile({ name: 'Old', numbering: { prefix: 'A', nextNumber: 40, padding: 1 }, updatedAt: T('01-01') }) }),
      'merge',
    )
    expect(result.profile).toBe('skipped')
    expect(await r.getProfile()).toMatchObject({ name: 'Local', numbering: { nextNumber: 40 }, updatedAt: T('09-01') })
  })

  it('replace never moves the counter below the pre-import value', async () => {
    await repo.saveProfile(makeProfile({ numbering: { prefix: 'A', nextNumber: 25, padding: 1 } }))
    await repo.importBackup(backupOf({ profile: makeProfile({ numbering: { prefix: 'A', nextNumber: 5, padding: 1 } }) }), 'replace')
    expect((await repo.getProfile())?.numbering.nextNumber).toBe(25)
  })

  it('replace raises the counter above the highest issued number matching the prefix', async () => {
    await repo.importBackup(
      backupOf({
        profile: makeProfile({ numbering: { prefix: '{YYYY}-', nextNumber: 2, padding: 4 } }),
        invoices: [
          makeInvoice('a', { number: '2025-0041', status: 'paid' }),
          makeInvoice('b', { number: '2026-0007', status: 'issued' }),
          makeInvoice('c', { number: 'OTHER-0999', status: 'issued' }),
          makeInvoice('d', { number: '2026-0500', status: 'draft' }),
        ],
      }),
      'replace',
    )
    expect((await repo.getProfile())?.numbering.nextNumber).toBe(42)
  })
})

describe('highestUsedNumber', () => {
  it('matches prefixes with placeholders and regex characters', () => {
    const inv = (number: string) => makeInvoice(number, { number, status: 'issued' })
    expect(highestUsedNumber([inv('ARVE-26/007'), inv('ARVE-25/010'), inv('ARVE-2026/999')], { prefix: 'ARVE-{YY}/', nextNumber: 1, padding: 3 })).toBe(10)
    expect(highestUsedNumber([inv('A.1'), inv('AX2')], { prefix: 'A.', nextNumber: 1, padding: 0 })).toBe(1)
    expect(highestUsedNumber([], { prefix: '', nextNumber: 1, padding: 0 })).toBe(0)
  })
})
