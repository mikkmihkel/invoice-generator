import { ArrowClockwiseIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useEffect, useId, useState } from 'react'
import type { RegistryCompany } from '../../domain'
import { REGISTRY_ATTRIBUTION } from '../../registry'
import { useApp } from '../AppContext'
import { formatAddress, addressFromRegistry } from '../util'
import { inactiveStatus, searchNotice, useRegistryPick, useRegistrySearch } from './registrySearch'

interface Props {
  onPick: (company: RegistryCompany) => void
  label?: string
  autoFocus?: boolean
  placeholder?: string
}

/** One register result: name, status and the identifying codes in mono. */
export function RegistryResult({ company: r, lang }: { company: RegistryCompany; lang: 'et' | 'en' }) {
  const inactive = inactiveStatus(r, lang)
  const address = r.addressText || (r.address ? formatAddress(addressFromRegistry(r)) : '')
  return (
    <>
      <span className="opt-name">
        {r.name}
        {inactive && <span className="chip chip-warn">{r.status}</span>}
      </span>
      <span className="opt-meta">
        <span className="mono">{r.registryCode}</span>
        {r.vatNumber && <span className="mono">{r.vatNumber}</span>}
        {address && <span className="opt-addr">{address}</span>}
      </span>
    </>
  )
}

/** Debounced autocomplete over the e-Business Register (bundled index + optional live API). */
export function CompanySearch({ onPick, label, autoFocus, placeholder }: Props) {
  const { t, lang } = useApp()
  const id = useId()
  const listId = id + '-list'
  const [query, setQuery] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const { results, loading, failed, searched, unavailable, retry } = useRegistrySearch(query)
  const [active, setActive] = useState(-1)
  const { pick, picking } = useRegistryPick((c) => {
    setQuery('')
    onPick(c)
  })

  useEffect(() => {
    setActive(results.length ? 0 : -1)
    setDismissed(false)
  }, [results])

  const open = results.length > 0 && !dismissed

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
      setDismissed(true)
    }
  }

  return (
    <div className="company-search">
      <label htmlFor={id}>{label ?? t('registry.searchLabel')}</label>
      <div className="combo-input">
        <MagnifyingGlassIcon className="combo-icon" />
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
        <ul id={listId} role="listbox" className="combo-list" hidden={!open} aria-label={t('registry.results')}>
          {results.map((r, i) => (
            <li
              key={r.registryCode}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'combo-opt active' : 'combo-opt'}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => void pick(r)}
            >
              <RegistryResult company={r} lang={lang} />
            </li>
          ))}
        </ul>
      </div>
      <div className="field-hint" aria-live="polite">
        {failed ? t('registry.failed') : searchNotice(t, { query, loading, searched, unavailable, count: results.length })}
      </div>
      {unavailable && searched && !loading && <RegistryRetry onRetry={retry} />}
      <RegistryAttribution lang={lang} />
    </div>
  )
}

/** "Try again" for a register search that could not reach every source. */
export function RegistryRetry({ onRetry }: { onRetry: () => void }) {
  const { t } = useApp()
  return (
    <button type="button" className="btn btn-sm btn-ghost registry-retry" onClick={onRetry}>
      <ArrowClockwiseIcon aria-hidden="true" />
      {t('registry.retry')}
    </button>
  )
}

export function RegistryAttribution({ lang }: { lang: 'et' | 'en' }) {
  return (
    <p className="attribution">
      <a href={REGISTRY_ATTRIBUTION.sourceUrl} target="_blank" rel="noreferrer">
        {REGISTRY_ATTRIBUTION[lang]}
      </a>
      {', '}
      <a href={REGISTRY_ATTRIBUTION.licenceUrl} target="_blank" rel="noreferrer">
        {lang === 'et' ? 'litsents' : 'licence'}
      </a>
    </p>
  )
}
