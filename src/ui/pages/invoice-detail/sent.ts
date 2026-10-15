import { refreshInvoiceEvents } from './events'

/**
 * Kept for callers that signal a sent e-mail: the e-mail dialog now records the 'sent' event itself, so this
 * only refreshes the invoice's history on screen.
 */
export function markSent(id: string): void {
  refreshInvoiceEvents(id)
}
