import { ArrowRightIcon, CaretDownIcon, CheckCircleIcon, InfoIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState } from 'react'
import type { ValidationIssue } from '../../../domain'
import { useApp } from '../../AppContext'
import { fieldId } from '../../components/fields'
import { pick } from '../../i18n'

/** Focus the input for an issue's field path, or its closest ancestor path that has an input. Opens collapsed sections on the way. */
export function focusField(path: string): boolean {
  const parts = path.split('.')
  while (parts.length) {
    const el = document.getElementById(fieldId(parts.join('.')))
    if (el) {
      for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      el.focus({ preventScroll: true })
      return true
    }
    parts.pop()
  }
  return false
}

/** Seller data comes from the company profile, so `seller.*` issues are fixed there (the profile form uses unprefixed paths). */
function companyFixHref(field: string): string | null {
  if (!field.startsWith('seller.')) return null
  return '#/company?focus=' + encodeURIComponent(field.slice('seller.'.length))
}

/** Wide layouts have room to list blocking problems right away; the phone bar starts as one line. */
function roomToExpand(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1024px)').matches
}

/**
 * The requirements check as one quiet line ("All required details are present. 1 suggestion") that expands
 * into the list of problems. Each problem focuses its field; seller problems link to the company page.
 */
export function ValidationPanel({
  issues,
  readOnly,
  summaryId,
  reveal = 0,
}: {
  issues: ValidationIssue[]
  readOnly?: boolean
  summaryId?: string
  /** Increase to open the list and move focus to it (e.g. after a blocked attempt to issue). */
  reveal?: number
}) {
  const { t, lang } = useApp()
  const listId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const [open, setOpen] = useState(() => errors.length > 0 && roomToExpand())
  const [revealed, setRevealed] = useState(reveal)
  if (revealed !== reveal) {
    setRevealed(reveal)
    setOpen(true)
  }
  useEffect(() => {
    if (reveal > 0) toggleRef.current?.focus()
  }, [reveal])

  const suggestions = warnings.length === 1 ? t('editor.checkOneSuggestion') : t('editor.checkSuggestions', { count: warnings.length })
  const summary = errors.length > 0 ? t('issue.errorsSummary', { count: errors.length }) : t('validation.allGood')

  return (
    <section className={`check${open ? ' check-open' : ''}`} id="validation-panel" aria-labelledby="validation-title" tabIndex={-1}>
      <h2 id="validation-title" className="visually-hidden">
        {t('validation.title')}
      </h2>
      {issues.length === 0 ? (
        <p className="check-line check-ok">
          <CheckCircleIcon size={16} className="check-icon" />
          <span>{summary}</span>
        </p>
      ) : (
        <button
          ref={toggleRef}
          type="button"
          id={summaryId}
          className={`check-line check-toggle${errors.length ? ' check-has-errors' : ''}`}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
        >
          {errors.length ? <WarningCircleIcon size={16} className="check-icon" /> : <CheckCircleIcon size={16} className="check-icon" />}
          <span className="check-text">
            {summary}
            {errors.length === 0 && ' '}
            {errors.length === 0 && <span className="check-more">{suggestions}</span>}
          </span>
          <CaretDownIcon size={14} className="check-caret" aria-hidden="true" />
        </button>
      )}
      {issues.length > 0 && (
        <ul id={listId} className="issues" hidden={!open}>
          {[...errors, ...warnings].map((issue, i) => {
            const fix = companyFixHref(issue.field)
            return (
              <li key={issue.field + i} className={`issue issue-${issue.severity}`}>
                <span className="issue-icon">{issue.severity === 'error' ? <WarningCircleIcon size={14} /> : <InfoIcon size={14} />}</span>
                <div className="issue-body">
                  <span className="visually-hidden">{issue.severity === 'error' ? t('validation.error') : t('validation.warning')}: </span>
                  {readOnly ? (
                    <span>{pick(issue.message, lang)}</span>
                  ) : fix ? (
                    <>
                      <span>{pick(issue.message, lang)}</span>{' '}
                      <a href={fix} className="issue-fix-link">
                        {t('validation.fixInProfile')}
                        <ArrowRightIcon size={12} />
                      </a>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="link-btn issue-link"
                      onClick={() => {
                        focusField(issue.field)
                        // On phones the list sits in the pinned bar over the form: get it out of the way.
                        if (!roomToExpand()) setOpen(false)
                      }}
                    >
                      {pick(issue.message, lang)}
                    </button>
                  )}
                  {issue.legalBasis && <span className="legal-basis">{issue.legalBasis}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
