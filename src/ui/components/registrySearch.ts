import { useCallback, useEffect, useRef, useState } from 'react'
import type { RegistryCompany } from '../../domain'
import { getCompanyByCode, searchCompanies } from '../../registry'
import { useApp } from '../AppContext'
import { useToast } from '../Toasts'

const STATUS_EN: Record<string, string> = { likvideerimisel: 'in liquidation', pankrotis: 'bankrupt', kustutatud: 'deleted' }

/** A register status other than "Registrisse kantud" (entered in the register), e.g. in liquidation or bankrupt. */
export function inactiveStatus(c: Pick<RegistryCompany, 'status'>, lang: 'et' | 'en'): string | null {
  const s = c.status?.trim()
  if (!s || /registrisse kantud/i.test(s)) return null
  return lang === 'en' ? (STATUS_EN[s.toLowerCase()] ?? s) : s
}

export interface RegistrySearchState {
  results: RegistryCompany[]
  loading: boolean
  failed: boolean
  /** A search for the current query has finished. */
  searched: boolean
}

/** Debounced search over the bundled register index, refined with the live API when enabled. */
export function useRegistrySearch(query: string): RegistrySearchState {
  const { settings } = useApp()
  const live = settings.registryLiveLookup
  const [state, setState] = useState<RegistrySearchState>({ results: [], loading: false, failed: false, searched: false })

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setState({ results: [], loading: false, failed: false, searched: false })
      return
    }
    const ctrl = new AbortController()
    // Never leave the previous query's results pickable while the new search runs.
    setState({ results: [], loading: true, failed: false, searched: false })
    const show = (r: RegistryCompany[]) => {
      if (!ctrl.signal.aborted) setState((s) => ({ ...s, results: r, failed: false }))
    }
    const handle = setTimeout(() => {
      searchCompanies(q, { limit: 10, live: false, signal: ctrl.signal })
        .then(async (r) => {
          show(r)
          if (live && !ctrl.signal.aborted) {
            const withLive = await searchCompanies(q, { limit: 10, live: true, signal: ctrl.signal })
            if (withLive.length) show(withLive)
          }
        })
        .catch((e) => {
          if (ctrl.signal.aborted) return
          console.warn('registry search failed', e)
          setState((s) => ({ ...s, results: [], failed: true }))
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setState((s) => ({ ...s, loading: false, searched: true }))
        })
    }, 250)
    return () => {
      clearTimeout(handle)
      ctrl.abort()
    }
  }, [query, live])

  return state
}

/** Completes a picked search result with the register's details and warns about inactive companies. */
export function useRegistryPick(onPick: (company: RegistryCompany) => void) {
  const { t, settings, lang } = useApp()
  const toast = useToast()
  const [picking, setPicking] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const onPickRef = useRef(onPick)
  useEffect(() => {
    onPickRef.current = onPick
  })

  useEffect(() => () => abort.current?.abort(), [])

  const pick = useCallback(
    async (r: RegistryCompany) => {
      abort.current?.abort()
      const ctrl = new AbortController()
      abort.current = ctrl
      setPicking(true)
      let full: RegistryCompany = r
      try {
        const detailed = await getCompanyByCode(r.registryCode, { live: settings.registryLiveLookup, signal: ctrl.signal })
        if (detailed) full = { ...r, ...detailed }
      } catch {
        /* fall back to the search result */
      }
      if (ctrl.signal.aborted) return
      setPicking(false)
      onPickRef.current(full)
      const inactive = inactiveStatus(full, lang)
      if (inactive) toast.warning(t('registry.inactiveWarning', { name: full.name, status: inactive }))
    },
    [settings.registryLiveLookup, lang, t, toast],
  )

  return { pick, picking }
}
