import { vi } from 'vitest'
import {
  advanceNumbering,
  createDefaultProfile,
  createDefaultSettings,
  formatInvoiceNumber,
  newId,
  nextSequence,
  numberingFor,
  planDeletion,
  releaseNumbers,
  reopenBlocker,
  withNumberingFor,
  type AppSettings,
  type Client,
  type CompanyProfile,
  type Invoice,
  type InvoiceEvent,
  type Product,
  type RecurringRule,
} from '../../domain'
import type { DeletedDocuments, Repository } from '../../storage'

/** In-memory Repository for UI tests (methods are vi.fn spies). */
export function createMemoryRepo(
  init: {
    profile?: CompanyProfile | null
    clients?: Client[]
    invoices?: Invoice[]
    settings?: AppSettings
    products?: Product[]
    recurringRules?: RecurringRule[]
    events?: InvoiceEvent[]
  } = {},
) {
  let profile: CompanyProfile | null = init.profile ?? null
  let settings: AppSettings = init.settings ?? createDefaultSettings()
  const clients = new Map((init.clients ?? []).map((c) => [c.id, c]))
  const invoices = new Map((init.invoices ?? []).map((i) => [i.id, i]))
  const products = new Map((init.products ?? []).map((p) => [p.id, p]))
  const rules = new Map((init.recurringRules ?? []).map((r) => [r.id, r]))
  const events = new Map((init.events ?? []).map((e) => [e.id, e]))
  const clone = <T,>(v: T): T => structuredClone(v)
  const setStatus = (id: string, patch: Partial<Invoice>): Invoice => {
    const inv = invoices.get(id)
    if (!inv) throw new Error('not found')
    const next = { ...inv, ...patch, updatedAt: new Date().toISOString() }
    invoices.set(id, next)
    return clone(next)
  }

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
    deleteInvoice: vi.fn(async (id: string): Promise<DeletedDocuments | null> => {
      const target = invoices.get(id)
      if (!target) return null
      const all = [...invoices.values()]
      const plan = planDeletion(target, all, profile)
      const ids = new Set(plan.documents.map((d) => d.id))
      const removedEvents = [...events.values()].filter((e) => ids.has(e.invoiceId))
      const removedRules = [...rules.values()].filter((r) => ids.has(r.sourceInvoiceId))
      for (const e of removedEvents) events.delete(e.id)
      for (const r of removedRules) rules.delete(r.id)
      const unlinked: Invoice[] = []
      for (const other of all) {
        if (ids.has(other.id)) continue
        const toInvoice = !!other.convertedToInvoiceId && ids.has(other.convertedToInvoiceId)
        const fromQuote = !!other.convertedFromQuoteId && ids.has(other.convertedFromQuoteId)
        if (!toInvoice && !fromQuote) continue
        const next = { ...other }
        if (toInvoice) delete next.convertedToInvoiceId
        if (fromQuote) delete next.convertedFromQuoteId
        unlinked.push(clone(other))
        invoices.set(other.id, next)
      }
      for (const d of plan.documents) invoices.delete(d.id)
      let released: string[] = []
      if (profile) {
        const result = releaseNumbers(profile, plan.documents, [...invoices.values()])
        profile = result.profile
        released = result.released
      }
      return clone({ invoices: plan.documents, events: removedEvents, recurringRules: removedRules, unlinked, released, deletedAt: new Date().toISOString() })
    }),
    restoreDeleted: vi.fn(async (deleted: DeletedDocuments) => {
      for (const d of deleted.invoices) invoices.set(d.id, clone(d))
      for (const d of deleted.unlinked) invoices.set(d.id, clone(d))
      for (const e of deleted.events) events.set(e.id, clone(e))
      for (const r of deleted.recurringRules) rules.set(r.id, clone(r))
      if (profile) {
        for (const d of deleted.invoices) {
          if (!d.number || !deleted.released.includes(d.number)) continue
          const series = numberingFor(profile, d.type)
          profile = withNumberingFor(profile, d.type, advanceNumbering(series, d.issueDate))
        }
      }
    }),
    reopenInvoice: vi.fn(async (id: string) => {
      const inv = invoices.get(id)
      if (!inv) throw new Error('not found')
      const block = reopenBlocker(inv, [...invoices.values()], [...events.values()])
      if (block) throw new Error(`cannot reopen: ${block}`)
      const reopened: Invoice = { ...inv, status: 'draft', reopenedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      invoices.set(id, reopened)
      return clone(reopened)
    }),
    issueInvoice: vi.fn(async (id: string) => {
      const inv = invoices.get(id)
      if (!inv || !profile) throw new Error('not found')
      let number = inv.number
      if (!inv.reopenedAt || !number) {
        const series = numberingFor(profile, inv.type)
        const { n } = nextSequence(series, inv.issueDate)
        number = formatInvoiceNumber(series, n, inv.issueDate)
        profile = withNumberingFor(profile, inv.type, advanceNumbering(series, inv.issueDate, n))
      }
      const issued: Invoice = { ...inv, number, status: 'issued', issuedAt: new Date().toISOString() }
      delete issued.reopenedAt
      invoices.set(id, issued)
      return clone(issued)
    }),
    markInvoicePaid: vi.fn(async (id: string, paidAt: string) => setStatus(id, { status: 'paid', paidAt })),
    markInvoiceUnpaid: vi.fn(async (id: string) => setStatus(id, { status: 'issued', paidAt: undefined })),
    cancelInvoice: vi.fn(async (id: string) => setStatus(id, { status: 'cancelled' })),
    getSettings: vi.fn(async () => clone(settings)),
    saveSettings: vi.fn(async (s: AppSettings) => {
      settings = clone(s)
    }),
    listProducts: vi.fn(async () => clone([...products.values()].sort((a, b) => a.description.localeCompare(b.description, 'et')))),
    saveProduct: vi.fn(async (p: Product) => {
      products.set(p.id, clone(p))
    }),
    deleteProduct: vi.fn(async (id: string) => {
      products.delete(id)
    }),
    listRecurringRules: vi.fn(async () => clone([...rules.values()].sort((a, b) => a.nextDate.localeCompare(b.nextDate)))),
    saveRecurringRule: vi.fn(async (r: RecurringRule) => {
      rules.set(r.id, clone(r))
    }),
    deleteRecurringRule: vi.fn(async (id: string) => {
      rules.delete(id)
    }),
    listInvoiceEvents: vi.fn(async (invoiceId?: string) =>
      clone([...events.values()].filter((e) => invoiceId === undefined || e.invoiceId === invoiceId).sort((a, b) => a.at.localeCompare(b.at))),
    ),
    addInvoiceEvent: vi.fn(async (e: InvoiceEvent) => {
      events.set(e.id, clone(e))
      return clone(e)
    }),
    deleteInvoiceEvent: vi.fn(async (id: string) => {
      events.delete(id)
    }),
    exportBackup: vi.fn(async () => ({
      app: 'invoice-generator' as const,
      version: 2 as const,
      exportedAt: new Date().toISOString(),
      profile,
      clients: [...clients.values()],
      invoices: [...invoices.values()],
      settings,
      products: [...products.values()],
      recurringRules: [...rules.values()],
      events: [...events.values()],
    })),
    importBackup: vi.fn(async () => ({
      clients: { written: 0, skipped: 0 },
      invoices: { written: 0, skipped: 0 },
      products: { written: 0, skipped: 0 },
      recurringRules: { written: 0, skipped: 0 },
      events: { written: 0, skipped: 0 },
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
