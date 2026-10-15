import { useEffect, useRef } from 'react'
import { prepareRecurringDrafts } from '../domain'
import { useApp } from './AppContext'
import { useToast } from './Toasts'
import { localTodayISO, nowISO } from './util'

/**
 * Prepares the drafts of recurring invoices that are due: once the data has loaded, and again whenever the rules
 * change. Each due rule gets its draft(s) and its next date moves forward; one toast tells how many drafts were
 * made. Nothing is issued automatically. Mount once inside the app providers.
 */
export function useRecurringDrafts(): void {
  const { ready, profile, invoices, recurringRules, saveInvoice, saveRecurringRule, t } = useApp()
  const toast = useToast()
  const running = useRef(false)
  // Latest values for the async run without re-triggering it on every invoice edit.
  const latest = useRef({ profile, invoices, saveInvoice, saveRecurringRule, t, toast })
  useEffect(() => {
    latest.current = { profile, invoices, saveInvoice, saveRecurringRule, t, toast }
  })

  useEffect(() => {
    if (!ready || !profile || running.current) return
    const today = localTodayISO()
    if (!recurringRules.some((r) => r.active && r.nextDate <= today)) return
    running.current = true
    const { invoices: all, saveInvoice: saveDraft, saveRecurringRule: saveRule, t: tr, toast: notify } = latest.current
    const run = prepareRecurringDrafts(recurringRules, all, profile, today, nowISO())
    void (async () => {
      let created = 0
      try {
        // Drafts first: if a rule cannot be saved, the next run finds the drafts and does not repeat them.
        for (const draft of run.drafts) {
          await saveDraft(draft)
          created++
        }
        for (const rule of run.rules) await saveRule(rule)
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
