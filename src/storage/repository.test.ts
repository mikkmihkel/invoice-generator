import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupFormatError, parseBackup, serializeBackup } from './backup'
import { subscribe, type StorageChange } from './events'
import { createRepository, InvoiceValidationError, RepositoryError, requestPersistentStorage, type Repository } from './repository'
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

  it('deletes drafts only', async () => {
    await repo.saveProfile(makeProfile())
    await repo.saveInvoice(makeInvoice('d'))
    await repo.saveInvoice(makeInvoice('x'))
    await repo.deleteInvoice('d')
    expect(await repo.getInvoice('d')).toBeNull()
    await repo.issueInvoice('x')
    await expect(repo.deleteInvoice('x')).rejects.toBeInstanceOf(RepositoryError)
    expect(await repo.getInvoice('x')).not.toBeNull()
    await expect(repo.deleteInvoice('missing')).resolves.toBeUndefined()
  })

  it('keeps number and status of issued invoices immutable via saveInvoice', async () => {
    await repo.saveProfile(makeProfile())
    await repo.saveInvoice(makeInvoice('x'))
    const issued = await repo.issueInvoice('x')
    await expect(repo.saveInvoice({ ...issued, number: '9999' })).rejects.toMatchObject({ code: 'immutable' })
    await expect(repo.saveInvoice({ ...issued, status: 'draft' })).rejects.toMatchObject({ code: 'immutable' })
    await repo.saveInvoice({ ...issued, status: 'paid', paidAt: '2026-03-20' })
    expect((await repo.getInvoice('x'))?.status).toBe('paid')
  })
})

describe('issueInvoice', () => {
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
    expect(backup.version).toBe(1)
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
    expect(() => parseBackup(JSON.stringify({ app: 'invoice-generator', version: 2, clients: [], invoices: [] }))).toThrow(/version/)
    expect(() => parseBackup(JSON.stringify({ app: 'invoice-generator', version: 1, clients: {}, invoices: [] }))).toThrow(BackupFormatError)
    expect(() =>
      parseBackup(JSON.stringify({ app: 'invoice-generator', version: 1, clients: [], invoices: [{ id: 'x', updatedAt: '', number: '', status: 'weird', lines: [], buyer: {} }] })),
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
