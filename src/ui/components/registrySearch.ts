import { useCallback, useEffect, useRef, useState } from 'react'
import type { RegistryCompany } from '../../domain'
import { getCompanyByCode, searchCompanies } from '../../registry'
import { useApp } from '../AppContext'
import type { Translate } from '../i18n'
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
  /**
   * Part of the search could not run (bundled index missing, live API offline or blocked), so the results
   * may be incomplete: an empty list does not mean the company does not exist.
   */
  unavailable: boolean
  /** Runs the current query again (e.g. once the connection is back). */
  retry: () => void
}

type SearchData = Omit<RegistrySearchState, 'retry'>
const IDLE: SearchData = { results: [], loading: false, failed: false, searched: false, unavailable: false }

/** Debounced search over the bundled register index, refined with the live API when enabled. */
export function useRegistrySearch(query: string): RegistrySearchState {
  const { settings } = useApp()
  const live = settings.registryLiveLookup
  const [state, setState] = useState<SearchData>(IDLE)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setState(IDLE)
      return
    }
    const ctrl = new AbortController()
    // Never leave the previous query's results pickable while the new search runs.
    setState({ ...IDLE, loading: true })
    let unavailable = false
    const onUnavailable = () => {
      unavailable = true
    }
    const show = (r: RegistryCompany[]) => {
      if (!ctrl.signal.aborted) setState((s) => ({ ...s, results: r, failed: false }))
    }
    const handle = setTimeout(() => {
      searchCompanies(q, { limit: 10, live: false, signal: ctrl.signal, onUnavailable })
        .then(async (r) => {
          show(r)
          if (live && !ctrl.signal.aborted) {
            // The live pass searches the index again too, so only its outcome counts from here on.
            unavailable = false
            const withLive = await searchCompanies(q, { limit: 10, live: true, signal: ctrl.signal, onUnavailable })
            if (withLive.length) show(withLive)
          }
        })
        .catch((e) => {
          if (ctrl.signal.aborted) return
          console.warn('registry search failed', e)
          setState((s) => ({ ...s, results: [], failed: true }))
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setState((s) => ({ ...s, loading: false, searched: true, unavailable }))
        })
    }, 250)
    return () => {
      clearTimeout(handle)
      ctrl.abort()
    }
  }, [query, live, attempt])

  return { ...state, retry }
}

/**
 * The hint under a register search box. When part of the search could not run (offline, live API blocked,
 * index missing) an empty list must not read as "no such company".
 */
export function searchNotice(
  t: Translate,
  s: { query: string; loading: boolean; searched: boolean; unavailable: boolean; count: number },
): string | null {
  if (s.query.trim().length < 2) return t('registry.hint')
  if (!s.searched || s.loading) return null
  if (s.unavailable) return s.count ? t('registry.unavailablePartial') : t('registry.unavailable')
  return s.count ? null : t('registry.noResults')
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
