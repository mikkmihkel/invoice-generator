import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  createDefaultSettings,
  type AppSettings,
  type Client,
  type CompanyProfile,
  type Invoice,
  type InvoiceEvent,
  type Product,
  type RecurringRule,
  type UiLanguage,
} from '../domain'
import { getRepository, subscribe, type Repository, type SaveProfileOptions, type StorageArea } from '../storage'
import { makeT, type Translate } from './i18n'
import { errorMessage, nowISO, reconcileList, setErrorLanguage, sortInvoices } from './util'
import { applyTheme, normalizeTheme, readStoredTheme } from './theme'

export interface AppData {
  ready: boolean
  /** Set when the database could not be opened. */
  loadError: string | null
  repo: Repository
  profile: CompanyProfile | null
  settings: AppSettings
  clients: Client[]
  invoices: Invoice[]
  /** Product and service catalogue, sorted by description. */
  products: Product[]
  /** Recurring invoice rules, sorted by nextDate. */
  recurringRules: RecurringRule[]
  /** Sent / reminder events of all documents, oldest first. */
  invoiceEvents: InvoiceEvent[]
  lang: UiLanguage
  t: Translate
  reload(): Promise<void>
  saveProfile(profile: CompanyProfile, options?: SaveProfileOptions): Promise<void>
  saveSettings(patch: Partial<AppSettings>): Promise<void>
  saveClient(client: Client): Promise<void>
  deleteClient(id: string): Promise<void>
  saveInvoice(invoice: Invoice): Promise<void>
  deleteInvoice(id: string): Promise<void>
  issueInvoice(id: string): Promise<Invoice>
  /** Status-only changes of issued invoices (the repository rejects other edits to them). */
  markInvoicePaid(id: string, paidAt: string): Promise<Invoice>
  markInvoiceUnpaid(id: string): Promise<Invoice>
  cancelInvoice(id: string): Promise<Invoice>
  saveProduct(product: Product): Promise<void>
  deleteProduct(id: string): Promise<void>
  saveRecurringRule(rule: RecurringRule): Promise<void>
  deleteRecurringRule(id: string): Promise<void>
  addInvoiceEvent(event: InvoiceEvent): Promise<InvoiceEvent>
  deleteInvoiceEvent(id: string): Promise<void>
}

const AppContext = createContext<AppData | null>(null)

function reconcileOne<T extends { updatedAt?: string }>(prev: T | null, next: T | null): T | null {
  return prev && next && prev.updatedAt === next.updatedAt ? prev : next
}

const sortClients = (list: Client[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'et'))
const sortProducts = (list: Product[]) => [...list].sort((a, b) => a.description.localeCompare(b.description, 'et'))
const sortRules = (list: RecurringRule[]) => [...list].sort((a, b) => a.nextDate.localeCompare(b.nextDate))
const sortEvents = (list: InvoiceEvent[]) => [...list].sort((a, b) => a.at.localeCompare(b.at))

/** Events have no updatedAt: keep the previous array when the ids are unchanged. */
function reconcileEvents(prev: InvoiceEvent[], next: InvoiceEvent[]): InvoiceEvent[] {
  return prev.length === next.length && prev.every((e, i) => e.id === next[i].id && e.at === next[i].at && e.note === next[i].note) ? prev : next
}

/** Draft seller data is taken from the current profile, so don't keep (and rewrite on every autosave) the logo. */
function withoutDraftLogo(inv: Invoice): Invoice {
  if (inv.status !== 'draft' || !inv.seller?.logoDataUrl) return inv
  const { logoDataUrl: _logo, ...seller } = inv.seller
  return { ...inv, seller }
}

type Area = Exclude<StorageArea, 'all'>
const ALL_AREAS: Area[] = ['profile', 'settings', 'clients', 'invoices', 'products', 'recurringRules', 'invoiceEvents']
/** Areas also written directly through `repo` by feature code: reloaded after local writes as well. */
const RELOAD_ON_LOCAL = new Set<Area>(['products', 'recurringRules', 'invoiceEvents'])

/** Holds repository-backed app data, settings and the UI language. */
export function AppProvider({ children, repository }: { children: ReactNode; repository?: Repository }) {
  const repo = useMemo<Repository>(() => repository ?? getRepository(), [repository])

  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [settings, setSettings] = useState<AppSettings>(createDefaultSettings)
  const [clients, setClients] = useState<Client[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>([])
  const [invoiceEvents, setInvoiceEvents] = useState<InvoiceEvent[]>([])
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const load = useCallback(
    async (areas: Iterable<Area>) => {
      const set = new Set(areas)
      try {
        await Promise.all([
          set.has('profile') && repo.getProfile().then((p) => setProfile((prev) => reconcileOne(prev, p))),
          set.has('settings') && repo.getSettings().then((s) => s && setSettings((prev) => reconcileOne(prev, s) ?? prev)),
          set.has('clients') && repo.listClients().then((c) => setClients((prev) => reconcileList(prev, sortClients(c)))),
          set.has('invoices') && repo.listInvoices().then((i) => setInvoices((prev) => reconcileList(prev, i))),
          set.has('products') && repo.listProducts().then((p) => setProducts((prev) => reconcileList(prev, sortProducts(p)))),
          set.has('recurringRules') && repo.listRecurringRules().then((r) => setRecurringRules((prev) => reconcileList(prev, sortRules(r)))),
          set.has('invoiceEvents') && repo.listInvoiceEvents().then((e) => setInvoiceEvents((prev) => reconcileEvents(prev, sortEvents(e)))),
        ])
        setLoadError(null)
      } catch (e) {
        console.error(e)
        setLoadError(errorMessage(e))
      } finally {
        setReady(true)
      }
    },
    [repo],
  )
  const reload = useCallback(() => load(ALL_AREAS), [load])

  useEffect(() => {
    void reload()
  }, [reload])

  // Refresh after writes the context did not make itself: other tabs and bulk changes (backup import).
  // Local single-area writes all go through the methods below, which already update the state.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const pending = new Set<Area>()
    const unsub = subscribe((change) => {
      if (change.source === 'local' && change.area !== 'all' && !RELOAD_ON_LOCAL.has(change.area)) return
      for (const a of change.area === 'all' ? ALL_AREAS : [change.area]) pending.add(a)
      clearTimeout(timer)
      timer = setTimeout(() => {
        const areas = [...pending]
        pending.clear()
        void load(areas)
      }, 150)
    })
    return () => {
      clearTimeout(timer)
      unsub()
    }
  }, [load])

  const lang: UiLanguage = settings.uiLanguage === 'en' ? 'en' : 'et'
  useEffect(() => {
    document.documentElement.lang = lang
    setErrorLanguage(lang)
  }, [lang])

  // Until the stored settings are loaded, keep the theme main.tsx applied from localStorage (no flash).
  const theme = ready ? normalizeTheme(settings.theme) : readStoredTheme()
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const t = useMemo(() => makeT(lang), [lang])

  const saveProfile = useCallback(
    async (p: CompanyProfile, options?: SaveProfileOptions) => {
      const next = { ...p, updatedAt: nowISO() }
      await repo.saveProfile(next, options)
      // The repository may have kept number series that another tab advanced meanwhile.
      setProfile((await repo.getProfile()) ?? next)
    },
    [repo],
  )

  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...settingsRef.current, ...patch, updatedAt: nowISO() }
      settingsRef.current = next
      setSettings(next)
      await repo.saveSettings(next)
    },
    [repo],
  )

  const saveClient = useCallback(
    async (c: Client) => {
      const next = { ...c, updatedAt: nowISO() }
      await repo.saveClient(next)
      setClients((list) => sortClients([...list.filter((x) => x.id !== c.id), next]))
    },
    [repo],
  )

  const deleteClient = useCallback(
    async (id: string) => {
      await repo.deleteClient(id)
      setClients((list) => list.filter((x) => x.id !== id))
    },
    [repo],
  )

  const saveInvoice = useCallback(
    async (invoice: Invoice) => {
      const inv = withoutDraftLogo(invoice)
      await repo.saveInvoice(inv)
      setInvoices((list) => sortInvoices([...list.filter((x) => x.id !== inv.id), inv]))
    },
    [repo],
  )

  const deleteInvoice = useCallback(
    async (id: string) => {
      await repo.deleteInvoice(id)
      setInvoices((list) => list.filter((x) => x.id !== id))
    },
    [repo],
  )

  const issueInvoice = useCallback(
    async (id: string) => {
      const issued = await repo.issueInvoice(id)
      setInvoices((list) => sortInvoices([...list.filter((x) => x.id !== id), issued]))
      // Numbering advanced inside the repository — refresh the profile.
      await load(['profile'])
      return issued
    },
    [repo, load],
  )

  const statusChange = useCallback(async (change: () => Promise<Invoice>) => {
    const updated = await change()
    setInvoices((list) => sortInvoices([...list.filter((x) => x.id !== updated.id), updated]))
    return updated
  }, [])
  const markInvoicePaid = useCallback((id: string, paidAt: string) => statusChange(() => repo.markInvoicePaid(id, paidAt)), [repo, statusChange])
  const markInvoiceUnpaid = useCallback((id: string) => statusChange(() => repo.markInvoiceUnpaid(id)), [repo, statusChange])
  const cancelInvoice = useCallback((id: string) => statusChange(() => repo.cancelInvoice(id)), [repo, statusChange])

  const saveProduct = useCallback(
    async (p: Product) => {
      const next = { ...p, createdAt: p.createdAt || nowISO(), updatedAt: nowISO() }
      await repo.saveProduct(next)
      setProducts((list) => sortProducts([...list.filter((x) => x.id !== p.id), next]))
    },
    [repo],
  )
  const deleteProduct = useCallback(
    async (id: string) => {
      await repo.deleteProduct(id)
      setProducts((list) => list.filter((x) => x.id !== id))
    },
    [repo],
  )
  const saveRecurringRule = useCallback(
    async (r: RecurringRule) => {
      const next = { ...r, createdAt: r.createdAt || nowISO(), updatedAt: nowISO() }
      await repo.saveRecurringRule(next)
      setRecurringRules((list) => sortRules([...list.filter((x) => x.id !== r.id), next]))
    },
    [repo],
  )
  const deleteRecurringRule = useCallback(
    async (id: string) => {
      await repo.deleteRecurringRule(id)
      setRecurringRules((list) => list.filter((x) => x.id !== id))
    },
    [repo],
  )
  const addInvoiceEvent = useCallback(
    async (e: InvoiceEvent) => {
      const stored = await repo.addInvoiceEvent(e)
      setInvoiceEvents((list) => sortEvents([...list.filter((x) => x.id !== stored.id), stored]))
      return stored
    },
    [repo],
  )
  const deleteInvoiceEvent = useCallback(
    async (id: string) => {
      await repo.deleteInvoiceEvent(id)
      setInvoiceEvents((list) => list.filter((x) => x.id !== id))
    },
    [repo],
  )

  const value = useMemo<AppData>(
    () => ({
      ready,
      loadError,
      repo,
      profile,
      settings,
      clients,
      invoices,
      products,
      recurringRules,
      invoiceEvents,
      lang,
      t,
      reload,
      saveProfile,
      saveSettings,
      saveClient,
      deleteClient,
      saveInvoice,
      deleteInvoice,
      issueInvoice,
      markInvoicePaid,
      markInvoiceUnpaid,
      cancelInvoice,
      saveProduct,
      deleteProduct,
      saveRecurringRule,
      deleteRecurringRule,
      addInvoiceEvent,
      deleteInvoiceEvent,
    }),
    [
      ready,
      loadError,
      repo,
      profile,
      settings,
      clients,
      invoices,
      products,
      recurringRules,
      invoiceEvents,
      lang,
      t,
      reload,
      saveProfile,
      saveSettings,
      saveClient,
      deleteClient,
      saveInvoice,
      deleteInvoice,
      issueInvoice,
      markInvoicePaid,
      markInvoiceUnpaid,
      cancelInvoice,
      saveProduct,
      deleteProduct,
      saveRecurringRule,
      deleteRecurringRule,
      addInvoiceEvent,
      deleteInvoiceEvent,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppData {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}

export function useT(): Translate {
  return useApp().t
}
