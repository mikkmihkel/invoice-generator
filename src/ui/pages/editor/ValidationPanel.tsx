import { ArrowRightIcon, CheckCircleIcon, InfoIcon, WarningCircleIcon } from '@phosphor-icons/react'
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

export function ValidationPanel({ issues, readOnly }: { issues: ValidationIssue[]; readOnly?: boolean }) {
  const { t, lang } = useApp()
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  return (
    <section className="panel validation" id="validation-panel" aria-labelledby="validation-title" tabIndex={-1}>
      <div className="validation-head">
        <h2 id="validation-title">{t('validation.title')}</h2>
        {issues.length > 0 && (
          <p className="validation-count">
            {errors.length > 0 && t('validation.errorCount', { count: errors.length })}
            {errors.length > 0 && warnings.length > 0 && ' · '}
            {warnings.length > 0 && t('validation.warningCount', { count: warnings.length })}
          </p>
        )}
      </div>
      {issues.length === 0 ? (
        <p className="validation-ok">
          <CheckCircleIcon size={18} />
          {t('validation.allGood')}
        </p>
      ) : (
        <ul className="issues">
          {[...errors, ...warnings].map((issue, i) => {
            const fix = companyFixHref(issue.field)
            return (
              <li key={issue.field + i} className={`issue issue-${issue.severity}`}>
                <span className="issue-icon">{issue.severity === 'error' ? <WarningCircleIcon /> : <InfoIcon />}</span>
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
                    <button type="button" className="link-btn issue-link" onClick={() => focusField(issue.field)}>
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
