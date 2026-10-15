import { useEffect, useRef } from 'react'
import { prepareRecurringDrafts } from '../domain'
import { useApp } from './AppContext'
import { useToast } from './Toasts'
import { localTodayISO, nowISO } from './util'

/** Runs `fn` while holding a lock shared by all tabs of the app, where the browser supports it. */
async function exclusive<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks?.request ? locks.request(name, fn) : fn()
}

/**
 * Prepares the drafts of recurring invoices that are due: once the data has loaded, and again whenever the rules
 * change. Each due rule gets its draft(s) and its next date moves forward; one toast tells how many drafts were
 * made. Nothing is issued automatically. Mount once inside the app providers.
 *
 * Drafts have ids derived from the rule and the date, and the run reads the stored rules and invoices afresh
 * (one tab at a time), so two tabs or two merged devices do not end up with the same draft twice.
 */
export function useRecurringDrafts(): void {
  const { ready, profile, repo, recurringRules, saveInvoice, saveRecurringRule, t } = useApp()
  const toast = useToast()
  const running = useRef(false)
  // Latest values for the async run without re-triggering it on every invoice edit.
  const latest = useRef({ repo, saveInvoice, saveRecurringRule, t, toast })
  useEffect(() => {
    latest.current = { repo, saveInvoice, saveRecurringRule, t, toast }
  })

  useEffect(() => {
    if (!ready || !profile || running.current) return
    const today = localTodayISO()
    if (!recurringRules.some((r) => r.active && r.nextDate <= today)) return
    running.current = true
    const { repo: store, saveInvoice: saveDraft, saveRecurringRule: saveRule, t: tr, toast: notify } = latest.current
    void (async () => {
      try {
        const created = await exclusive('recurring-drafts', async () => {
          const [rules, all] = await Promise.all([store.listRecurringRules(), store.listInvoices()])
          const run = prepareRecurringDrafts(rules, all, profile, today, nowISO())
          let count = 0
          // Drafts first: if a rule cannot be saved, the next run finds the drafts and does not repeat them.
          for (const draft of run.drafts) {
            if (await store.getInvoice(draft.id)) continue
            await saveDraft(draft)
            count++
          }
          for (const rule of run.rules) await saveRule(rule)
          return count
        })
        if (created > 0) notify.success(created === 1 ? tr('recurring.createdOne') : tr('recurring.created', { count: created }))
      } catch (e) {
        console.error(e)
        notify.error(tr('recurring.failed'))
      } finally {
        running.current = false
      }
    })()
  }, [ready, profile, recurringRules])
}
