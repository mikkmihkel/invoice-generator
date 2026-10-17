import { ArrowsClockwiseIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { computeTotals, resumeRule, undoPause, undoResume, undoStop, type RecurringEntry, type RecurringRule } from '../../../domain'
import { useApp } from '../../AppContext'
import { formatDate, formatMoney } from '../../format'
import { useToast } from '../../Toasts'
import { localTodayISO, nowISO } from '../../util'

/**
 * "Korduvarved": every active rule with its client, amount, interval and next draft date, with pause and stop;
 * paused rules below with resume and stop. Each change can be undone from its toast.
 */
export function RecurringPanel({ active, paused, selectedId }: { active: RecurringEntry[]; paused: RecurringEntry[]; selectedId?: string }) {
  const { t, repo, saveRecurringRule, deleteRecurringRule } = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (rule: RecurringRule, fn: () => Promise<void>) => {
    setBusy(rule.id)
    try {
      await fn()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(null)
    }
  }
  const client = (e: RecurringEntry) => e.source.buyer.name || t('list.noClient')
  /**
   * The toast's undo: `revert` works out, from the rules as they are now (read afresh), what takes back only this
   * action; an older toast's undo then never rolls back a later change.
   */
  const undo = (e: RecurringEntry, revert: (rules: RecurringRule[]) => RecurringRule | null) => ({
    label: t('payment.undo'),
    onClick: () => {
      void (async () => {
        const back = revert(await repo.listRecurringRules())
        if (!back) {
          toast.info(t('recurring.undoStale', { client: client(e) }))
          return
        }
        await saveRecurringRule(back)
        toast.info(t('recurring.restored', { client: client(e) }))
      })().catch((err: unknown) => toast.error(err))
    },
  })

  const pause = (e: RecurringEntry) =>
    run(e.rule, async () => {
      const paused = { ...e.rule, active: false, updatedAt: nowISO() }
      await saveRecurringRule(paused)
      toast.success(t('recurring.paused', { client: client(e) }), undo(e, (rules) => undoPause(rules, paused, nowISO())))
    })
  const resume = (e: RecurringEntry) =>
    run(e.rule, async () => {
      const next = resumeRule(e.rule, e.source, localTodayISO(), nowISO())
      await saveRecurringRule(next)
      toast.success(t('recurring.resumed', { client: client(e), date: formatDate(next.nextDate) }), undo(e, (rules) => undoResume(rules, e.rule, next, nowISO())))
    })
  const stop = (e: RecurringEntry) =>
    run(e.rule, async () => {
      await deleteRecurringRule(e.rule.id)
      toast.success(t('recurring.stopped', { client: client(e) }), undo(e, (rules) => undoStop(rules, e.rule, nowISO())))
    })

  const row = (e: RecurringEntry, on: boolean) => {
    const name = client(e)
    const interval = t(`recurring.${e.rule.interval}`)
    return (
      <li key={e.rule.id} className={`rec-row${on ? '' : ' rec-paused'}`}>
        <Link to={`/?id=${e.source.id}`} className="rec-main" aria-current={selectedId === e.source.id ? 'true' : undefined}>
          <span className="row-client">{name}</span>
          <span className="row-amount tnum">{formatMoney(computeTotals(e.source).gross, e.source.currency)}</span>
          <span className="rec-when">{on ? t('recurring.rowNext', { interval, date: formatDate(e.rule.nextDate) }) : t('recurring.rowPaused', { interval })}</span>
        </Link>
        <div className="rec-actions">
          {on ? (
            <button type="button" className="btn btn-sm" onClick={() => void pause(e)} disabled={busy !== null} aria-label={t('recurring.pauseFor', { client: name })}>
              {t('recurring.pause')}
            </button>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => void resume(e)} disabled={busy !== null} aria-label={t('recurring.resumeFor', { client: name })}>
              {t('recurring.resume')}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-text" onClick={() => void stop(e)} disabled={busy !== null} aria-label={t('recurring.stopFor', { client: name })}>
            {t('recurring.stop')}
          </button>
        </div>
      </li>
    )
  }

  return (
    <section className="rec-panel" aria-labelledby="rec-title">
      <h2 id="rec-title" className="month-label">
        <ArrowsClockwiseIcon size={12} className="row-recurring-icon" aria-hidden="true" />
        {t('recurring.panelTitle')}
      </h2>
      <p className="rec-note">{t('recurring.panelNote')}</p>
      {active.length > 0 ? <ul className="rec-rows">{active.map((e) => row(e, true))}</ul> : <p className="rec-note">{t('recurring.noneActive')}</p>}
      {paused.length > 0 && (
        <>
          <h3 className="month-label">{t('recurring.pausedTitle')}</h3>
          <ul className="rec-rows" aria-label={t('recurring.pausedTitle')}>
            {paused.map((e) => row(e, false))}
          </ul>
        </>
      )}
    </section>
  )
}
