import type { ValidationIssue } from '../../../domain'
import { useApp } from '../../AppContext'
import { pick } from '../../i18n'

/**
 * The warnings left on a document, listed in the issue confirmation itself: on phones the check list is folded away
 * behind the dialog, so a bare count would send the user back to find them.
 */
export function IssueWarnings({ warnings, summary }: { warnings: ValidationIssue[]; summary: string }) {
  const { lang } = useApp()
  if (warnings.length === 0) return null
  return (
    <div className="notice notice-warn issue-warnings">
      <p>{summary}</p>
      <ul>
        {warnings.map((w, i) => (
          <li key={w.field + i}>
            {pick(w.message, lang)}
            {w.legalBasis && <span className="legal-basis">{w.legalBasis}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
