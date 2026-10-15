import type { ReactNode } from 'react'
import { reopenBlocker, type Invoice } from '../../../domain'
import { useApp } from '../../AppContext'
import { formatDate } from '../../format'
import { eventDate } from './events'
import { docNoun } from './status'
import { interpolate } from './text'

/**
 * Why an issued document is locked and what can still be done: while it can be reopened only the lead sentence
 * (the caller adds the way to reopen it); otherwise the reason (sent, paid, credited, accepted) and the way to
 * correct it, a credit note for invoices and a copy for quotes.
 */
export function LockNote({ invoice, creditLink }: { invoice: Invoice; creditLink?: ReactNode }) {
  const { t, invoices, invoiceEvents } = useApp()
  const quote = invoice.type === 'quote'
  if (invoice.status === 'cancelled') {
    return <>{quote ? t('lock.cancelledQuote') : t('lock.cancelled', { doc: t(`invoice.type.${invoice.type}`), noun: docNoun(t, invoice) })}</>
  }
  const lead = t(`lock.${invoice.type}`)
  const block = reopenBlocker(invoice, invoices, invoiceEvents)
  if (!block) return <>{lead}</>
  const sent = invoiceEvents.filter((e) => e.invoiceId === invoice.id).at(-1)
  const date = sent ? formatDate(eventDate(sent.at)) : invoice.paidAt ? formatDate(invoice.paidAt) : ''
  const link = creditLink ?? t('detail.lockedLink')
  let reason: ReactNode = null
  if (quote) reason = block === 'accepted' ? t('lock.acceptedQuote') : sent ? t('lock.sentQuote', { date }) : null
  else if (invoice.type === 'credit-note') reason = sent ? t('lock.sentFinal', { date }) : invoice.paidAt ? t('lock.paidFinal', { date }) : null
  else if (sent) reason = interpolate(t('lock.sentFix', { date }), { link })
  else if (block === 'paid') reason = interpolate(t('lock.paidFix', { date }), { link })
  else if (block === 'credited') reason = interpolate(t('lock.creditedFix'), { link })
  return (
    <>
      {lead}
      {reason && <> {reason}</>}
    </>
  )
}
