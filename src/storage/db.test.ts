import forceCloseDatabase from 'fake-indexeddb/lib/forceCloseDatabase'
import { describe, expect, it } from 'vitest'
import { getDb } from './db'

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
    forceCloseDatabase(first as unknown as IDBDatabase)
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
    // this build only knows version 1, so the re-open fails (and is not cached)
    await expect(next).rejects.toBeTruthy()
    expect(getDb(name)).not.toBe(next)
  })
})
