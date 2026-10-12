import { useState } from 'react'
import type { Invoice } from '../../../domain'
import { useApp } from '../../AppContext'
import { Dialog } from '../../components/Dialog'
import { TextField } from '../../components/fields'
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
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
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

export function IssueDialog({
  predictedNumber,
  warnings,
  onClose,
  onConfirm,
}: {
  predictedNumber: string
  warnings: number
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const { t } = useApp()
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title={t('issue.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
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
                await onConfirm()
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
      <p>{t('issue.number', { number: predictedNumber })}</p>
      <p>{t('issue.lockExplain')}</p>
      <p className="muted small">{t('issue.creditHint')}</p>
      {warnings > 0 && <p className="notice notice-warn">{t('issue.warnings', { count: warnings })}</p>}
    </Dialog>
  )
}
