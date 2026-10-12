import { vi } from 'vitest'
import { createDefaultProfile, createDefaultSettings, formatInvoiceNumber, newId, type AppSettings, type Client, type CompanyProfile, type Invoice } from '../../domain'
import type { Repository } from '../../storage'

/** In-memory Repository for UI tests (methods are vi.fn spies). */
export function createMemoryRepo(init: { profile?: CompanyProfile | null; clients?: Client[]; invoices?: Invoice[]; settings?: AppSettings } = {}) {
  let profile: CompanyProfile | null = init.profile ?? null
  let settings: AppSettings = init.settings ?? createDefaultSettings()
  const clients = new Map((init.clients ?? []).map((c) => [c.id, c]))
  const invoices = new Map((init.invoices ?? []).map((i) => [i.id, i]))
  const clone = <T,>(v: T): T => structuredClone(v)

  const repo = {
    getProfile: vi.fn(async () => clone(profile)),
    saveProfile: vi.fn(async (p: CompanyProfile) => {
      profile = clone(p)
    }),
    listClients: vi.fn(async () => clone([...clients.values()])),
    getClient: vi.fn(async (id: string) => clone(clients.get(id) ?? null)),
    saveClient: vi.fn(async (c: Client) => {
      clients.set(c.id, clone(c))
    }),
    deleteClient: vi.fn(async (id: string) => {
      clients.delete(id)
    }),
    listInvoices: vi.fn(async () => clone([...invoices.values()].sort((a, b) => b.issueDate.localeCompare(a.issueDate)))),
    getInvoice: vi.fn(async (id: string) => clone(invoices.get(id) ?? null)),
    saveInvoice: vi.fn(async (inv: Invoice) => {
      invoices.set(inv.id, clone(inv))
    }),
    deleteInvoice: vi.fn(async (id: string) => {
      invoices.delete(id)
    }),
    issueInvoice: vi.fn(async (id: string) => {
      const inv = invoices.get(id)
      if (!inv || !profile) throw new Error('not found')
      const number = formatInvoiceNumber(profile.numbering, profile.numbering.nextNumber, Number(inv.issueDate.slice(0, 4)))
      profile = { ...profile, numbering: { ...profile.numbering, nextNumber: profile.numbering.nextNumber + 1 } }
      const issued: Invoice = { ...inv, number, status: 'issued', issuedAt: new Date().toISOString() }
      invoices.set(id, issued)
      return clone(issued)
    }),
    getSettings: vi.fn(async () => clone(settings)),
    saveSettings: vi.fn(async (s: AppSettings) => {
      settings = clone(s)
    }),
    exportBackup: vi.fn(async () => ({
      app: 'invoice-generator' as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      profile,
      clients: [...clients.values()],
      invoices: [...invoices.values()],
      settings,
    })),
    importBackup: vi.fn(async () => ({
      clients: { written: 0, skipped: 0 },
      invoices: { written: 0, skipped: 0 },
      profile: 'none' as const,
      settings: 'none' as const,
      duplicateNumbers: [],
    })),
  } satisfies Repository
  return repo
}

/** A complete, VAT-registered company profile. */
export function sampleProfile(patch: Partial<CompanyProfile> = {}): CompanyProfile {
  const base = createDefaultProfile()
  return {
    ...base,
    name: 'Näidis OÜ',
    registryCode: '12345678',
    vatNumber: 'EE101234568',
    vatRegistered: true,
    email: 'info@naidis.ee',
    address: { street: 'Narva mnt 5', city: 'Tallinn', postalCode: '10117', country: 'EE' },
    bankAccounts: [{ id: newId(), iban: 'EE382200221020145685', bankName: 'Swedbank', bic: 'HABAEE2X' }],
    defaults: { ...base.defaults, vatScheme: 'domestic', defaultVatRate: 24, paymentTermDays: 14, currency: 'EUR' },
    ...patch,
  }
}
