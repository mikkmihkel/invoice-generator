import { useEffect, useId, useRef, useState } from 'react'
import type { RegistryCompany } from '../../domain'
import { getCompanyByCode, REGISTRY_ATTRIBUTION, searchCompanies } from '../../registry'
import { useApp } from '../AppContext'
import { formatAddress, addressFromRegistry } from '../util'

interface Props {
  onPick: (company: RegistryCompany) => void
  label?: string
  autoFocus?: boolean
  placeholder?: string
}

/** Debounced autocomplete over the e-Business Register (bundled index + optional live API). */
export function CompanySearch({ onPick, label, autoFocus, placeholder }: Props) {
  const { t, settings, lang } = useApp()
  const id = useId()
  const listId = id + '-list'
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RegistryCompany[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [searched, setSearched] = useState(false)
  const [active, setActive] = useState(-1)
  const [picking, setPicking] = useState(false)
  const live = settings.registryLiveLookup
  const pickAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearched(false)
      setFailed(false)
      setLoading(false)
      return
    }
    const ctrl = new AbortController()
    // Never leave the previous query's results pickable while the new search runs.
    setResults([])
    setActive(-1)
    setLoading(true)
    const show = (r: RegistryCompany[]) => {
      if (ctrl.signal.aborted) return
      setResults(r)
      setFailed(false)
      setActive(r.length ? 0 : -1)
    }
    const handle = setTimeout(() => {
      // Bundled index first (fast), then refine with the live API when enabled.
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
          setResults([])
          setFailed(true)
        })
        .finally(() => {
          if (ctrl.signal.aborted) return
          setLoading(false)
          setSearched(true)
        })
    }, 250)
    return () => {
      clearTimeout(handle)
      ctrl.abort()
    }
  }, [query, live])

  useEffect(() => () => pickAbort.current?.abort(), [])

  const pick = async (r: RegistryCompany) => {
    pickAbort.current?.abort()
    const ctrl = new AbortController()
    pickAbort.current = ctrl
    setPicking(true)
    let full: RegistryCompany = r
    try {
      const detailed = await getCompanyByCode(r.registryCode, { live, signal: ctrl.signal })
      if (detailed) full = { ...r, ...detailed }
    } catch {
      /* fall back to the search result */
    }
    if (ctrl.signal.aborted) return
    setPicking(false)
    setQuery('')
    setResults([])
    setSearched(false)
    onPick(full)
  }

  const open = results.length > 0

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      void pick(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setResults([])
    }
  }

  return (
    <div className="company-search">
      <label htmlFor={id}>{label ?? t('registry.searchLabel')}</label>
      <div className="company-search-input">
        <input
          id={id}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={placeholder ?? t('registry.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {(loading || picking) && <span className="spinner" aria-label={t('common.loading')} />}
      </div>
      <ul id={listId} role="listbox" className="search-results" hidden={!open} aria-label={t('registry.results')}>
        {results.map((r, i) => (
          <li
            key={r.registryCode}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={i === active ? 'active' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => void pick(r)}
          >
            <div className="sr-name">
              {r.name}
              {r.status && !/registrisse kantud/i.test(r.status) && <span className="chip chip-warn">{r.status}</span>}
            </div>
            <div className="sr-meta">
              {r.registryCode}
              {r.vatNumber ? ` · ${r.vatNumber}` : ''}
              {(r.address || r.addressText) && ` · ${r.addressText || formatAddress(addressFromRegistry(r))}`}
            </div>
          </li>
        ))}
      </ul>
      <div className="field-hint" aria-live="polite">
        {failed ? t('registry.failed') : searched && !loading && results.length === 0 ? t('registry.noResults') : t('registry.hint')}
      </div>
      <RegistryAttribution lang={lang} />
    </div>
  )
}

export function RegistryAttribution({ lang }: { lang: 'et' | 'en' }) {
  return (
    <p className="attribution">
      <a href={REGISTRY_ATTRIBUTION.sourceUrl} target="_blank" rel="noreferrer">
        {REGISTRY_ATTRIBUTION[lang]}
      </a>
      {' · '}
      <a href={REGISTRY_ATTRIBUTION.licenceUrl} target="_blank" rel="noreferrer">
        {lang === 'et' ? 'litsents' : 'licence'}
      </a>
    </p>
  )
}
