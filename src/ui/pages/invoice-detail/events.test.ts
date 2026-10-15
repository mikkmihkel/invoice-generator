import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRepo } from '../../testing/memoryRepo'
import { importLegacySent, legacySentId, resetLegacyImport } from './events'

vi.mock('../../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../storage')>()),
  subscribe: () => () => undefined,
}))

afterEach(() => {
  localStorage.clear()
  resetLegacyImport()
})

describe('importLegacySent', () => {
  it('stores each old sent date once, even when two tabs import at the same time', async () => {
    localStorage.setItem('invoice-generator:sentInvoices', JSON.stringify({ a: '2026-01-06', b: '2026-02-01', c: 'bad' }))
    const repo = createMemoryRepo()
    const first = importLegacySent(repo)
    // A second tab has its own module state: it starts before the first one has removed the old entry.
    resetLegacyImport()
    const second = importLegacySent(repo)
    await Promise.all([first, second])
    const events = await repo.listInvoiceEvents()
    expect(events.map((e) => [e.id, e.invoiceId, e.at]).sort()).toEqual([
      [legacySentId('a', '2026-01-06'), 'a', '2026-01-06T12:00:00.000Z'],
      [legacySentId('b', '2026-02-01'), 'b', '2026-02-01T12:00:00.000Z'],
    ])
    expect(localStorage.getItem('invoice-generator:sentInvoices')).toBeNull()
  })
})
