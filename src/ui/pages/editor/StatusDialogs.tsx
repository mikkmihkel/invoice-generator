import { useState } from 'react'
import type { Invoice } from '../../../domain'
import { useApp } from '../../AppContext'
import { Dialog } from '../../components/Dialog'
import { CheckboxField, TextField } from '../../components/fields'
import { formatDate, formatMoney } from '../../format'
import { useToast } from '../../Toasts'
import { errorMessage, localTodayISO } from '../../util'

/** Pick the payment date: marking paid on another day than today, or (`change`) correcting the date of a paid invoice. */
export function MarkPaidDialog({
  invoice,
  onClose,
  onConfirm,
  change,
}: {
  invoice: Invoice
  onClose: () => void
  onConfirm: (paidAt: string) => Promise<void>
  change?: boolean
}) {
  const { t } = useApp()
  const toast = useToast()
  const [date, setDate] = useState((change && invoice.paidAt) || localTodayISO())
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await onConfirm(date)
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t(change ? 'payment.changeDateTitle' : 'actions.markPaidTitle', { number: invoice.number })}
      onClose={onClose}
      closeLabel={t('common.close')}
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !date}>
            {t(change ? 'common.save' : 'actions.markPaid')}
          </button>
        </>
      }
    >
      <TextField label={t('actions.paidDate')} type="date" value={date} onChange={setDate} max={localTodayISO()} data-autofocus />
    </Dialog>
  )
}

/**
 * Cancelling an issued invoice: one sentence on why a credit note is needed, then one confirmed step that
 * credits the open amount. Crediting only part of it (editing the lines first) stays available as a link.
 */
export function CancelInvoiceDialog({
  invoice,
  amount,
  partiallyCredited,
  onClose,
  onConfirm,
  onPartial,
}: {
  invoice: Invoice
  /** What the credit note will credit (the open amount). */
  amount: number
  partiallyCredited: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
  onPartial: () => void
}) {
  const { t } = useApp()
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title={t('actions.cancelTitle', { number: invoice.number })}
      onClose={onClose}
      closeLabel={t('common.close')}
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-autofocus>
            {t('common.back')}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
              } finally {
                onClose()
              }
            }}
          >
            {busy ? t('common.working') : t('payment.cancelConfirm')}
          </button>
        </>
      }
    >
      <p>{t('payment.cancelExplain')}</p>
      <p>
        {t('payment.cancelWhat', { amount: formatMoney(amount, invoice.currency), number: invoice.number })}
        {partiallyCredited && ` ${t('payment.cancelRemaining')}`}
      </p>
      <p className="muted small">
        <button
          type="button"
          className="link-btn"
          disabled={busy}
          onClick={() => {
            onClose()
            onPartial()
          }}
        >
          {t('payment.partialCredit')}
        </button>
      </p>
    </Dialog>
  )
}

/** Shown when a draft is dated before today: what "set to today" would change. */
export interface StaleIssueDate {
  date: string
  today: string
  /** Due date after moving the issue date (same payment term). */
  newDueDate: string
  supplyDateMoves: boolean
  /** Number the invoice gets with today's date (differs when the numbering prefix contains the year). */
  numberWithToday: string
}

export function IssueDialog({
  credit,
  predictedNumber,
  warnings,
  stale,
  onClose,
  onConfirm,
}: {
  /** Issuing a credit note: the title says so. */
  credit?: boolean
  predictedNumber: string
  warnings: number
  stale?: StaleIssueDate | null
  onClose: () => void
  /** `useToday` = move the issue date to today before issuing. */
  onConfirm: (useToday: boolean) => Promise<void>
}) {
  const { t } = useApp()
  const [busy, setBusy] = useState(false)
  const [useToday, setUseToday] = useState(true)
  const moving = !!stale && useToday
  const number = moving ? stale.numberWithToday : predictedNumber
  return (
    <Dialog
      title={t(credit ? 'issue.titleCredit' : 'issue.title')}
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
            {busy ? t('common.working') : t('issue.confirm')}
          </button>
        </>
      }
    >
      {stale && (
        <div className="notice notice-info stale-date">
          <p>{t('issue.staleDate', { date: formatDate(stale.date), today: formatDate(stale.today) })}</p>
          <CheckboxField label={t('issue.setToday')} checked={useToday} onChange={setUseToday} disabled={busy} />
          {useToday && (
            <ul className="small">
              <li>{t('issue.setTodayDue', { due: formatDate(stale.newDueDate) })}</li>
              {stale.supplyDateMoves && <li>{t('issue.setTodaySupply')}</li>}
              {stale.date.slice(0, 4) !== stale.today.slice(0, 4) && stale.numberWithToday !== predictedNumber && (
                <li>{t('issue.yearChanged', { number: stale.numberWithToday })}</li>
              )}
            </ul>
          )}
        </div>
      )}
      <p>{t('issue.number', { number })}</p>
      <p>{t('issue.lockExplain')}</p>
      <p className="muted small">{t('issue.creditHint')}</p>
      {warnings > 0 && <p className="notice notice-warn">{t('issue.warnings', { count: warnings })}</p>}
    </Dialog>
  )
}
