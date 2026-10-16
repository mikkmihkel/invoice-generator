import { useCallback } from 'react'
import { newId, type Invoice, type InvoiceEvent } from '../../../domain'
import { useApp } from '../../AppContext'
import { useToast } from '../../Toasts'
import { refreshInvoiceEvents } from './events'

/** What was sent: the document itself, or a payment reminder about it. */
export type SentKind = InvoiceEvent['kind']

/**
 * Whether a document can be marked as sent by hand (sent outside the app: a downloaded PDF or e-invoice XML, a
 * printout, the user's own mail app): issued with a number, not paid or cancelled, and not sent yet.
 */
export function canMarkSent(inv: Pick<Invoice, 'id' | 'status' | 'number'>, events: readonly Pick<InvoiceEvent, 'invoiceId' | 'kind'>[]): boolean {
  return inv.status === 'issued' && !!inv.number && !events.some((e) => e.invoiceId === inv.id && e.kind === 'sent')
}

/** Message key of the "Did you send it to the client?" prompt for the document type (or for a reminder). */
export function sentPromptKey(type: Invoice['type'], kind: SentKind = 'sent'): 'sent.prompt' | 'sent.promptCredit' | 'sent.promptQuote' | 'sent.promptReminder' {
  if (kind === 'reminder') return 'sent.promptReminder'
  return type === 'quote' ? 'sent.promptQuote' : type === 'credit-note' ? 'sent.promptCredit' : 'sent.prompt'
}

/**
 * "Mark as sent": records the same event as sending by e-mail through Gmail ('sent', or 'reminder' for a payment
 * reminder), so the document counts as sent everywhere (status line, next action, and it can no longer be reopened
 * for editing, see reopenBlocker). The confirmation toast has an undo button that removes the event again.
 * Resolves to false when it failed (shown as a toast).
 */
export function useMarkSent() {
  const { t, addInvoiceEvent, deleteInvoiceEvent } = useApp()
  const toast = useToast()
  return useCallback(
    async (invoice: Pick<Invoice, 'id' | 'type' | 'number'>, kind: SentKind = 'sent'): Promise<boolean> => {
      let stored: InvoiceEvent
      try {
        stored = await addInvoiceEvent({ id: newId(), invoiceId: invoice.id, kind, at: new Date().toISOString() })
      } catch (e) {
        toast.error(e)
        return false
      }
      refreshInvoiceEvents(invoice.id)
      const params = { doc: t(`invoice.type.${invoice.type}`), number: invoice.number }
      const reminder = kind === 'reminder'
      toast.success(t(reminder ? 'sent.reminderMarked' : 'sent.marked', params), {
        label: t('payment.undo'),
        onClick: () => {
          deleteInvoiceEvent(stored.id).then(
            () => {
              refreshInvoiceEvents(invoice.id)
              toast.info(t(reminder ? 'sent.reminderUnmarked' : 'sent.unmarked', params))
            },
            (e: unknown) => toast.error(e),
          )
        },
      })
      return true
    },
    [t, toast, addInvoiceEvent, deleteInvoiceEvent],
  )
}
