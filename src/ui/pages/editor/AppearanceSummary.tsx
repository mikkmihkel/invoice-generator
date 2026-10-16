import { Fragment } from 'react'
import type { Invoice } from '../../../domain'
import { useApp } from '../../AppContext'
import type { MessageKey } from '../../i18n'
import { templateName } from '../../options'
import { accentColor } from '../../util'

/**
 * The appearance of a draft that follows the company defaults, as one line: "Standard · eesti keel · ■ ühevärviline
 * · Muuda". "Muuda" opens the full section.
 */
export function AppearanceSummary({ invoice, onChange }: { invoice: Invoice; onChange: () => void }) {
  const { t, lang } = useApp()
  const lower = (s: string) => (lang === 'et' ? s.toLocaleLowerCase('et') : s)
  const mode = invoice.colorMode ?? 'accent'
  const parts = [
    <span key="template">{templateName(invoice.templateId, lang)}</span>,
    <span key="lang">{lower(t(`lang.${invoice.language}` as MessageKey))}</span>,
    <span key="colour" className="ed-appearance-colour">
      {mode !== 'mono' && <span className="ed-swatch" style={{ background: accentColor(invoice.accentColor) }} aria-hidden="true" />}
      {mode === 'duo' && invoice.secondaryColor && <span className="ed-swatch" style={{ background: accentColor(invoice.secondaryColor) }} aria-hidden="true" />}
      {lower(t(`appearance.mode.${mode}`))}
    </span>,
    ...(invoice.paymentQr && invoice.type !== 'quote' ? [<span key="qr">{lower(t('editor.paymentQrShort'))}</span>] : []),
  ]
  return (
    <div className="ed-appearance-summary">
      <p className="ed-appearance-facts">
        {parts.map((p, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <span className="ed-appearance-sep" aria-hidden="true">
                {' · '}
              </span>
            )}
            {i > 0 && <span className="visually-hidden">, </span>}
            {p}
          </Fragment>
        ))}
      </p>
      <button type="button" className="ed-text-btn" aria-expanded="false" aria-label={t('appearance.changeLabel')} onClick={onChange}>
        {t('appearance.change')}
      </button>
    </div>
  )
}
