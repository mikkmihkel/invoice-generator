import { useState } from 'react'
import { useApp } from '../../AppContext'
import { Dialog } from '../../components/Dialog'
import { CheckboxField } from '../../components/fields'
import { formatDate } from '../../format'
import type { ValidationIssue } from '../../../domain'
import { IssueWarnings } from '../editor/IssueWarnings'

/** A quote dated before today: the dates "set to today" would give it. */
export interface StaleQuoteDate {
  date: string
  today: string
  validUntil: string
  numberWithToday: string
}

/** Confirm issuing a quote: it gets its number from the quote series and is locked. */
export function QuoteIssueDialog({
  predictedNumber,
  keepsNumber,
  warnings,
  stale,
  onClose,
  onConfirm,
}: {
  predictedNumber: string
  /** A reopened quote is issued again under its own number. */
  keepsNumber?: boolean
  warnings: ValidationIssue[]
  stale?: StaleQuoteDate | null
  onClose: () => void
  /** `useToday` = move the quote date to today before issuing. */
  onConfirm: (useToday: boolean) => Promise<void>
}) {
  const { t } = useApp()
  const [busy, setBusy] = useState(false)
  const [useToday, setUseToday] = useState(true)
  const moving = !!stale && useToday
  const number = moving ? stale.numberWithToday : predictedNumber
  return (
    <Dialog
      title={t('quote.issue')}
      onClose={onClose}
      closeLabel={t('common.close')}
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            data-autofocus
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm(moving)
                onClose()
              } catch {
                setBusy(false)
              }
            }}
          >
            {busy ? t('common.working') : t('quote.issueConfirm')}
          </button>
        </>
      }
    >
      {stale && (
        <div className="notice notice-info stale-date">
          <p>{t('quote.staleDate', { date: formatDate(stale.date), today: formatDate(stale.today) })}</p>
          <CheckboxField label={t('quote.setToday')} checked={useToday} onChange={setUseToday} disabled={busy} />
          {useToday && <p className="small">{t('quote.setTodayValid', { date: formatDate(stale.validUntil) })}</p>}
        </div>
      )}
      <p>{t(keepsNumber ? 'reopen.issueNumber' : 'quote.issueText', { number })}</p>
      <p className="muted small">{t('quote.issueHint')}</p>
      <IssueWarnings warnings={warnings} summary={t(warnings.length === 1 ? 'quote.issueWarningsOne' : 'quote.issueWarnings', { count: warnings.length })} />
    </Dialog>
  )
}
