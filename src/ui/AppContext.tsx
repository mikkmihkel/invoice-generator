import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createDefaultSettings, type AppSettings, type Client, type CompanyProfile, type Invoice, type UiLanguage } from '../domain'
import * as storage from '../storage'
import type { Repository } from '../storage'
import { makeT, type Translate } from './i18n'
import { errorMessage, nowISO, sortInvoices } from './util'

export interface AppData {
  ready: boolean
  /** Set when the database could not be opened. */
  loadError: string | null
  repo: Repository
  profile: CompanyProfile | null
  settings: AppSettings
  clients: Client[]
  invoices: Invoice[]
  lang: UiLanguage
  t: Translate
  reload(): Promise<void>
  saveProfile(profile: CompanyProfile): Promise<void>
  saveSettings(patch: Partial<AppSettings>): Promise<void>
  saveClient(client: Client): Promise<void>
  deleteClient(id: string): Promise<void>
  saveInvoice(invoice: Invoice): Promise<void>
  deleteInvoice(id: string): Promise<void>
  issueInvoice(id: string): Promise<Invoice>
}

const AppContext = createContext<AppData | null>(null)

function fallbackSettings(): AppSettings {
  try {
    return createDefaultSettings()
  } catch {
    return { uiLanguage: 'et', driveFolderName: 'Arved', registryLiveLookup: false, updatedAt: nowISO() }
  }
}

type Subscribe = (listener: () => void) => () => void

/** Holds repository-backed app data, settings and the UI language. */
export function AppProvider({ children, repository }: { children: ReactNode; repository?: Repository }) {
  const repo = useMemo<Repository>(() => {
    if (repository) return repository
    try {
      return storage.getRepository()
    } catch (e) {
      return new Proxy({} as Repository, {
        get: () => () => Promise.reject(e),
      })
    }
  }, [repository])

  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings)
  const [clients, setClients] = useState<Client[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const reload = useCallback(async () => {
    try {
      const [p, s, c, i] = await Promise.all([repo.getProfile(), repo.getSettings(), repo.listClients(), repo.listInvoices()])
      setProfile(p)
      if (s) setSettings(s)
      setClients([...c].sort((a, b) => a.name.localeCompare(b.name, 'et')))
      setInvoices(i)
      setLoadError(null)
    } catch (e) {
      console.error(e)
      setLoadError(errorMessage(e))
    } finally {
      setReady(true)
    }
  }, [repo])

  useEffect(() => {
    void reload()
  }, [reload])

  // Refresh when another tab (or a backup import) changes the database, if storage offers a change feed.
  useEffect(() => {
    const subscribe = (storage as unknown as { subscribe?: Subscribe }).subscribe
    if (typeof subscribe !== 'function') return
    try {
      return subscribe(() => void reload())
    } catch {
      return
    }
  }, [reload])

  const lang: UiLanguage = settings.uiLanguage === 'en' ? 'en' : 'et'
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const t = useMemo(() => makeT(lang), [lang])

  const saveProfile = useCallback(
    async (p: CompanyProfile) => {
      const next = { ...p, updatedAt: nowISO() }
      await repo.saveProfile(next)
      setProfile(next)
    },
    [repo],
  )

  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...settingsRef.current, ...patch, updatedAt: nowISO() }
      setSettings(next)
      await repo.saveSettings(next)
    },
    [repo],
  )

  const saveClient = useCallback(
    async (c: Client) => {
      const next = { ...c, updatedAt: nowISO() }
      await repo.saveClient(next)
      setClients((list) => [...list.filter((x) => x.id !== c.id), next].sort((a, b) => a.name.localeCompare(b.name, 'et')))
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
    async (inv: Invoice) => {
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
      try {
        setProfile(await repo.getProfile())
      } catch {
        /* ignore */
      }
      return issued
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
    }),
    [ready, loadError, repo, profile, settings, clients, invoices, lang, t, reload, saveProfile, saveSettings, saveClient, deleteClient, saveInvoice, deleteInvoice, issueInvoice],
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
