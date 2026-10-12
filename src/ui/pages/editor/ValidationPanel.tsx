import type { ValidationIssue } from '../../../domain'
import { useApp } from '../../AppContext'
import { fieldId } from '../../components/fields'
import { pick } from '../../i18n'

/** Focus the input for an issue's field path, or its closest ancestor path that has an input. */
export function focusField(path: string) {
  const parts = path.split('.')
  while (parts.length) {
    const el = document.getElementById(fieldId(parts.join('.')))
    if (el) {
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      el.focus({ preventScroll: true })
      return
    }
    parts.pop()
  }
}

export function ValidationPanel({ issues, readOnly }: { issues: ValidationIssue[]; readOnly?: boolean }) {
  const { t, lang } = useApp()
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  return (
    <section className="card validation" aria-labelledby="validation-title">
      <h2 id="validation-title">{t('validation.title')}</h2>
      {issues.length === 0 ? (
        <p className="validation-ok">
          <span aria-hidden="true">✓ </span>
          {t('validation.allGood')}
        </p>
      ) : (
        <>
          <p className="muted small">
            {errors.length > 0 && t('validation.errorCount', { count: errors.length })}
            {errors.length > 0 && warnings.length > 0 && ' · '}
            {warnings.length > 0 && t('validation.warningCount', { count: warnings.length })}
          </p>
          <ul className="issues">
            {[...errors, ...warnings].map((issue, i) => (
              <li key={issue.field + i} className={`issue issue-${issue.severity}`}>
                <span className="issue-icon" aria-hidden="true">
                  {issue.severity === 'error' ? '!' : 'i'}
                </span>
                <div>
                  <span className="visually-hidden">{issue.severity === 'error' ? t('validation.error') : t('validation.warning')}: </span>
                  {readOnly ? (
                    <span>{pick(issue.message, lang)}</span>
                  ) : (
                    <button type="button" className="link-btn" onClick={() => focusField(issue.field)}>
                      {pick(issue.message, lang)}
                    </button>
                  )}
                  {issue.legalBasis && <div className="legal-basis">{issue.legalBasis}</div>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
