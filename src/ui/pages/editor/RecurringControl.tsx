import { useState } from 'react'
import {
  addDays,
  canRecur,
  createRecurringRule,
  isRecurrenceInterval,
  RECURRENCE_INTERVALS,
  ruleForInvoice,
  undoStop,
  upcomingOccurrence,
  type Invoice,
  type RecurrenceInterval,
  type RecurringRule,
} from '../../../domain'
import { useApp } from '../../AppContext'
import { SelectField, TextField } from '../../components/fields'
import { formatDate } from '../../format'
import { useToast } from '../../Toasts'
import { errorMessage, localTodayISO, nowISO } from '../../util'

type Choice = RecurrenceInterval | 'none'

/**
 * "Korda": repeat an issued invoice monthly, quarterly or yearly. The rule keeps the date of the next draft,
 * which the app prepares when it is opened on or after that date (never issued automatically).
 * Only ordinary invoices start recurring; a rule still active on another document (e.g. a cancelled invoice) can only
 * be stopped. Renders nothing otherwise.
 */
export function RecurringControl({ invoice, className }: { invoice: Invoice; className?: string }) {
  const { t, repo, recurringRules, saveRecurringRule, deleteRecurringRule } = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const rule = ruleForInvoice(recurringRules, invoice.id)
  const active = rule?.active ? rule : undefined
  // A rule still running for another kind of invoice, or for a cancelled one, can be stopped here.
  const earlier = !!active && invoice.status !== 'draft'
  if (!canRecur(invoice) && !earlier) return null
  const intervals = invoice.status === 'cancelled' ? RECURRENCE_INTERVALS.filter((v) => v === active?.interval) : RECURRENCE_INTERVALS
  const value: Choice = active && isRecurrenceInterval(active.interval) ? active.interval : 'none'
  const today = localTodayISO()

  const save = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const choose = (choice: Choice) =>
    save(async () => {
      if (choice === 'none') {
        // "Ei kordu" stops the repeating: the rule is removed (pausing lives in the recurring overview).
        if (active) await stop(active)
        return
      }
      const nextDate = active && active.interval === choice ? active.nextDate : upcomingOccurrence(invoice, choice, today)
      const base = rule ?? createRecurringRule(invoice, choice)
      await saveRecurringRule({ ...base, interval: choice, nextDate, active: true, updatedAt: nowISO() })
    })

  const stop = async (stopped: RecurringRule) => {
    await deleteRecurringRule(stopped.id)
    const client = invoice.buyer.name || t('list.noClient')
    toast.success(t('recurring.stopped', { client }), {
      label: t('payment.undo'),
      onClick: () => {
        void (async () => {
          const back = undoStop(await repo.listRecurringRules(), stopped, nowISO())
          if (!back) return toast.info(t('recurring.undoStale', { client }))
          await saveRecurringRule(back)
          toast.info(t('recurring.restored', { client }))
        })().catch((e: unknown) => toast.error(e))
      },
    })
  }

  const setNextDate = (date: string) => {
    if (!active || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= today) return
    void save(() => saveRecurringRule({ ...active, nextDate: date, updatedAt: nowISO() }))
  }

  return (
    <div className={`recurring-control${className ? ' ' + className : ''}`}>
      <SelectField<Choice>
        label={t('recurring.label')}
        value={value}
        onChange={(v) => void choose(v)}
        disabled={busy}
        options={[{ value: 'none', label: t('recurring.none') }, ...intervals.map((v) => ({ value: v as Choice, label: t(`recurring.${v}`) }))]}
        hint={active ? t('recurring.hint', { date: formatDate(active.nextDate) }) : rule ? t('recurring.pausedHint') : t('recurring.offHint')}
      />
      {active && invoice.status !== 'cancelled' && (
        <TextField label={t('recurring.next')} type="date" value={active.nextDate} min={addDays(today, 1)} onChange={setNextDate} disabled={busy} />
      )}
    </div>
  )
}
