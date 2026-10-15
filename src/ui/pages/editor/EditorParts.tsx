import { CaretRightIcon, CheckCircleIcon, CheckIcon, CloudArrowUpIcon, DownloadSimpleIcon, EnvelopeSimpleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Invoice, InvoiceTotals, QuoteStatus } from '../../../domain'
import { invoiceFileName } from '../../../pdf'
import { useApp } from '../../AppContext'
import { IconButton } from '../../components/ui'
import { formatMoney } from '../../format'
import type { DisplayStatus } from '../../util'
import type { SaveState } from './useAutosave'

/** One calm block of the editor column: a heading, an optional quiet note on the right, then the fields. */
export function EdSection({ id, title, aside, hint, children }: { id: string; title: string; aside?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="ed-section" id={id} aria-labelledby={id + '-title'}>
      <div className="ed-section-head">
        <h2 id={id + '-title'}>{title}</h2>
        {aside && <span className="ed-section-aside">{aside}</span>}
      </div>
      {hint && <p className="ed-section-hint">{hint}</p>}
      <div className="ed-section-body">{children}</div>
    </section>
  )
}

/** Rare fields, closed by default. Validation can open it (focusField opens enclosing <details>). */
export function MoreOptions({ initiallyOpen, summary, children }: { initiallyOpen: boolean; summary: string; children: ReactNode }) {
  const { t } = useApp()
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <details className="ed-more" id="sec-more" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <CaretRightIcon size={16} className="ed-more-caret" />
        <span className="ed-more-text">
          <span className="ed-more-title">{t('editor.more')}</span>
          <span className="ed-more-hint">{summary}</span>
        </span>
      </summary>
      <div className="ed-more-body">{children}</div>
    </details>
  )
}

/** Invoice status as a coloured word, never a pill. */
export function StatusWord({ status }: { status: DisplayStatus }) {
  const { t } = useApp()
  return <span className={`ed-status ed-status-${status}`}>{t(`status.${status}`)}</span>
}

/** Quote status as a coloured word: Saadetud, Aktsepteeritud, Aegunud… */
export function QuoteStatusWord({ status }: { status: QuoteStatus }) {
  const { t } = useApp()
  return <span className={`ed-status ed-status-quote-${status}`}>{t(`quote.status.${status}`)}</span>
}

export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const { t } = useApp()
  if (state === 'error') {
    return (
      <span className="save-state save-error" aria-live="polite">
        <WarningCircleIcon />
        {t('editor.saveError')}{' '}
        <button type="button" className="link-btn" onClick={onRetry}>
          {t('editor.retrySave')}
        </button>
      </span>
    )
  }
  const text = state === 'saving' || state === 'pending' ? t('editor.saving') : state === 'saved' ? t('editor.saved') : t('editor.autosaveHint')
  return (
    <span className={`save-state save-${state}`} aria-live="polite">
      {state === 'saved' && <CheckIcon />}
      {text}
    </span>
  )
}

/** Amount due, large, with the VAT included in it underneath. */
export function DueAmount({ totals, currency, label }: { totals: InvoiceTotals; currency: string; label?: string }) {
  const { t } = useApp()
  return (
    <div className="ed-total">
      <p className="ed-total-label">{label ?? t('totals.gross')}</p>
      <p className="ed-total-amount">{formatMoney(totals.gross, currency)}</p>
      {totals.showVat && <p className="ed-total-sub">{t('editor.inclVat', { amount: formatMoney(totals.vat, currency) })}</p>}
    </div>
  )
}

/** The moment right after issuing: the number, and the three ways to send it on. */
export function NextStep({
  invoice,
  busy,
  hasGoogle,
  folder,
  onEmail,
  onPdf,
  onDrive,
  onDismiss,
}: {
  invoice: Invoice
  busy: string | null
  hasGoogle: boolean
  folder: string
  onEmail: () => void
  onPdf: () => void
  onDrive: () => void
  onDismiss: () => void
}) {
  const { t } = useApp()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  const quote = invoice.type === 'quote'
  return (
    <section ref={ref} className="next-step" aria-labelledby="next-title" tabIndex={-1}>
      <div className="next-head">
        <span className="next-icon">
          <CheckCircleIcon size={20} />
        </span>
        <div className="next-text">
          <h2 id="next-title">{t(quote ? 'quote.nextTitle' : 'next.title', { number: invoice.number })}</h2>
          <p>{t(quote ? 'quote.nextText' : 'next.text')}</p>
        </div>
        <IconButton label={t('next.dismiss')} icon={<XIcon />} onClick={onDismiss} />
      </div>
      <div className="next-actions" role="group" aria-label={t(quote ? 'quote.nextActions' : 'next.actions')}>
        <button type="button" className="next-action next-primary" onClick={onEmail} disabled={busy !== null}>
          <EnvelopeSimpleIcon size={18} />
          <span className="na-text">
            <span className="na-title">{t('actions.email')}</span>
            <span className="na-sub">{invoice.buyer.email ? t('next.emailTo', { email: invoice.buyer.email }) : t('next.emailNoAddress')}</span>
          </span>
        </button>
        <button type="button" className="next-action" onClick={onPdf} disabled={busy !== null}>
          <DownloadSimpleIcon size={18} />
          <span className="na-text">
            <span className="na-title">{busy === 'pdf' ? t('common.working') : t('actions.downloadPdf')}</span>
            <span className="na-sub">{t('next.pdf', { file: invoiceFileName(invoice, 'pdf') })}</span>
          </span>
        </button>
        <button type="button" className="next-action" onClick={onDrive} disabled={busy !== null}>
          <CloudArrowUpIcon size={18} />
          <span className="na-text">
            <span className="na-title">{busy === 'drive' ? t('common.working') : t('actions.drive')}</span>
            <span className="na-sub">{hasGoogle ? t('next.driveFolder', { folder }) : t('next.driveSetup')}</span>
          </span>
        </button>
      </div>
    </section>
  )
}
