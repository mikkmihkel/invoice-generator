import { useState } from 'react'
import type { Invoice } from '../../../domain'
import { useApp } from '../../AppContext'
import { Dialog } from '../../components/Dialog'
import { CheckboxField, TextField } from '../../components/fields'
import { formatDate } from '../../format'
import { useToast } from '../../Toasts'
import { errorMessage, localTodayISO } from '../../util'

export function MarkPaidDialog({ invoice, onClose, onConfirm }: { invoice: Invoice; onClose: () => void; onConfirm: (paidAt: string) => Promise<void> }) {
  const { t } = useApp()
  const toast = useToast()
  const [date, setDate] = useState(localTodayISO())
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
      title={t('actions.markPaidTitle', { number: invoice.number })}
      onClose={onClose}
      closeLabel={t('common.close')}
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !date}>
            {t('actions.markPaid')}
          </button>
        </>
      }
    >
      <TextField label={t('actions.paidDate')} type="date" value={date} onChange={setDate} max={localTodayISO()} data-autofocus />
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
  predictedNumber,
  warnings,
  stale,
  onClose,
  onConfirm,
}: {
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
      title={t('issue.title')}
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
