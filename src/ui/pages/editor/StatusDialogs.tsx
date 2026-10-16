import { useState } from 'react'
import { invoiceFromQuote, outstandingAmount, planDeletion, type Invoice, type ValidationIssue } from '../../../domain'
import { useApp } from '../../AppContext'
import { Dialog } from '../../components/Dialog'
import { CheckboxField, TextField } from '../../components/fields'
import { formatDate, formatMoney } from '../../format'
import { useToast } from '../../Toasts'
import { errorMessage, localTodayISO } from '../../util'
import { eventDate } from '../invoice-detail/events'
import { docNoun } from '../invoice-detail/status'
import { useDeleteDocument } from '../invoice-detail/useInvoiceActions'
import { IssueWarnings } from './IssueWarnings'

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

/**
 * Deleting a numbered document (issued, paid, cancelled or reopened): what the deletion means for the accounting
 * records and the numbering, which linked documents go with it, a warning when the document was already sent,
 * reminded or paid, and the credit note as the alternative for an invoice that still has something to credit.
 */
export function DeleteInvoiceDialog({
  invoice,
  onClose,
  onDeleted,
  onCreditNote,
  beforeDelete,
}: {
  invoice: Invoice
  onClose: () => void
  /** After a successful deletion (e.g. leave the page). */
  onDeleted: () => void
  /** Offered for invoices that still have something to credit. */
  onCreditNote?: () => void
  /** Runs before deleting (e.g. let a pending autosave finish). */
  beforeDelete?: () => Promise<void>
}) {
  const { t, invoices, profile, invoiceEvents, recurringRules } = useApp()
  const deleteDocument = useDeleteDocument()
  const [busy, setBusy] = useState(false)
  const plan = planDeletion(invoice, invoices, profile, invoiceEvents)
  const ids = new Set(plan.documents.map((d) => d.id))
  const quote = invoice.type === 'quote'
  // Sent or reminded: the document is with the client.
  const sent = invoiceEvents.filter((e) => e.invoiceId === invoice.id).at(-1)
  const paidAt = quote ? undefined : invoice.paidAt
  const leftApp = !!sent || !!paidAt
  const recurring = recurringRules.some((r) => ids.has(r.sourceInvoiceId))
  const fromQuote = quote ? invoiceFromQuote(invoice, invoices) : undefined
  const canCredit =
    !!onCreditNote && (invoice.type === 'invoice' || invoice.type === 'prepayment') && (invoice.status === 'issued' || invoice.status === 'paid') && outstandingAmount(invoice, invoices) > 0
  const list = (docs: Invoice[]) => docs.map((d) => d.number || t('list.draftNumber').toLocaleLowerCase()).join(', ')
  const numbers = (n: string[]) => n.join(', ')

  const remove = async () => {
    setBusy(true)
    try {
      await beforeDelete?.()
      await deleteDocument(invoice)
      onClose()
      onDeleted()
    } catch {
      // deleteDocument has shown the error
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t('delete.title', { doc: docNoun(t, invoice), number: invoice.number })}
      onClose={onClose}
      closeLabel={t('common.close')}
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-autofocus>
            {t('common.cancel')}
          </button>
          {canCredit && (
            <button
              type="button"
              className={`btn${leftApp ? ' btn-primary' : ''}`}
              disabled={busy}
              onClick={() => {
                onClose()
                onCreditNote()
              }}
            >
              {t('actions.creditNote')}
            </button>
          )}
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
            {busy ? t('common.working') : t('common.delete')}
          </button>
        </>
      }
    >
      {leftApp && (
        <p className="notice notice-warn">
          {[
            sent && t('delete.sent', { doc: t(`invoice.type.${invoice.type}`), noun: docNoun(t, invoice), date: formatDate(eventDate(sent.at)) }),
            paidAt && t('delete.paid', { date: formatDate(paidAt) }),
            canCredit ? t('delete.creditInstead') : !quote && t('delete.keepRecord'),
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}
      <p>
        {[
          quote ? t('delete.quoteText') : t('delete.sourceDocument'),
          plan.released.length > 0 && t(plan.released.length > 1 ? 'delete.releasedMany' : 'delete.releasedOne', { numbers: numbers(plan.released) }),
          plan.gaps.length > 0 && t('delete.gap', { numbers: numbers(plan.gaps) }),
          plan.kept.length > 0 && t('delete.gapKept'),
        ]
          .filter(Boolean)
          .join(' ')}
      </p>
      {(plan.creditNotes.length > 0 || plan.creditedInvoice || recurring || fromQuote) && (
        <p>
          {[
            plan.creditNotes.length > 0 && t(plan.creditNotes.length > 1 ? 'delete.withCreditMany' : 'delete.withCreditOne', { numbers: list(plan.creditNotes) }),
            plan.creditedInvoice &&
              (plan.reinstated
                ? t(plan.reinstated.status === 'paid' ? 'delete.creditOfCancelledPaid' : 'delete.creditOfCancelled', { number: plan.creditedInvoice.number })
                : t('delete.creditOf', { number: plan.creditedInvoice.number })),
            fromQuote && t('delete.quoteInvoiceStays', { number: fromQuote.number || t('list.draftNumber').toLocaleLowerCase() }),
            recurring && t('delete.recurring'),
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}
      {!leftApp && canCredit && <p className="muted small">{t('delete.ifSent')}</p>}
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
  keepsNumber,
  warnings,
  stale,
  onClose,
  onConfirm,
}: {
  /** Issuing a credit note: the title says so. */
  credit?: boolean
  predictedNumber: string
  /** A reopened document is issued again under its own number. */
  keepsNumber?: boolean
  warnings: ValidationIssue[]
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
      <p>{t(keepsNumber ? 'reopen.issueNumber' : 'issue.number', { number })}</p>
      <p>{t('issue.lockExplain')}</p>
      <p className="muted small">{t('issue.creditHint')}</p>
      <IssueWarnings warnings={warnings} summary={t('issue.warnings', { count: warnings.length })} />
    </Dialog>
  )
}
