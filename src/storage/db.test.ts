import { forceCloseDatabase } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openDB } from 'idb'
import { DB_VERSION, getDb, openInvoiceDb, PROFILE_KEY } from './db'
import { createRepository } from './repository'
import { makeInvoice, makeProfile } from './testFixtures'

const unique = () => `db-test-${Math.random()}`

describe('getDb', () => {
  it('caches the connection per name', async () => {
    const name = unique()
    expect(getDb(name)).toBe(getDb(name))
    expect(await getDb(name)).toBe(await getDb(name))
  })

  it('re-opens after the connection was terminated by the browser', async () => {
    const name = unique()
    const first = await getDb(name)
    // simulates an abnormal close (fires "close", which idb maps to terminated())
    forceCloseDatabase(first as unknown as Parameters<typeof forceCloseDatabase>[0])
    const second = await getDb(name)
    expect(second).not.toBe(first)
    await second.put('meta', 'ok', 'probe')
    expect(await second.get('meta', 'probe')).toBe('ok')
  })

  it('closes and forgets the connection when another tab upgrades the database', async () => {
    const name = unique()
    const firstPromise = getDb(name)
    await firstPromise
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 99)
      req.onsuccess = () => {
        req.result.close()
        resolve()
      }
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('blocked: old connection was not closed'))
    })
    const next = getDb(name)
    expect(next).not.toBe(firstPromise)
    // this build does not know version 99, so the re-open fails (and is not cached)
    await expect(next).rejects.toBeTruthy()
    expect(getDb(name)).not.toBe(next)
  })
})

describe('migration from version 1', () => {
  /** Creates the database exactly as version 1 of the app did. */
  async function createV1(name: string) {
    const db = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('profile')
        db.createObjectStore('clients', { keyPath: 'id' })
        const invoices = db.createObjectStore('invoices', { keyPath: 'id' })
        invoices.createIndex('number', 'number')
        invoices.createIndex('status', 'status')
        invoices.createIndex('issueDate', 'issueDate')
        invoices.createIndex('clientId', 'buyer.clientId')
        db.createObjectStore('settings')
        db.createObjectStore('meta')
      },
    })
    await db.put('profile', makeProfile({ numbering: { prefix: '{YYYY}-', nextNumber: 42, padding: 4 } }), PROFILE_KEY)
    await db.put('invoices', makeInvoice('old', { number: '2026-0041', status: 'issued' }))
    await db.put('meta', 1, 'schemaVersion')
    db.close()
  }

  it('adds the new stores and keeps existing data', async () => {
    const name = unique()
    await createV1(name)
    const db = await openInvoiceDb(name)
    expect([...db.objectStoreNames].sort()).toEqual(
      ['clients', 'invoiceEvents', 'invoices', 'meta', 'products', 'profile', 'recurringRules', 'settings'].sort(),
    )
    expect(db.transaction('recurringRules').store.indexNames.contains('sourceInvoiceId')).toBe(true)
    expect(db.transaction('invoiceEvents').store.indexNames.contains('invoiceId')).toBe(true)
    expect(await db.get('meta', 'schemaVersion')).toBe(DB_VERSION)
    expect((await db.get('invoices', 'old'))?.number).toBe('2026-0041')
    db.close()
  })

  it('continues the old running number after the upgrade (no reset field means one series)', async () => {
    const name = unique()
    await createV1(name)
    const repo = createRepository({ dbName: name })
    expect(await repo.listProducts()).toEqual([])
    await repo.saveInvoice(makeInvoice('new', { issueDate: '2027-01-05', dueDate: '2027-01-19' }))
    const issued = await repo.issueInvoice('new')
    expect(issued.number).toBe('2027-0042')
    expect((await repo.getProfile())?.numbering.nextNumber).toBe(43)
  })
})
