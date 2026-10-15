import { ReceiptIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { invoiceFromQuote, markQuoteAccepted, quoteStatus, quoteToInvoiceDraft, type Invoice } from '../../../domain'
import { useApp } from '../../AppContext'
import { formatDate } from '../../format'
import { localDateOf } from '../invoice-detail/status'
import { useToast } from '../../Toasts'
import { errorMessage, localTodayISO } from '../../util'

/**
 * Turn the quote into an invoice in one step ("Koosta arve"): the new draft gets the quote's buyer, lines,
 * currency, notes and text rows with today's dates, the quote is marked accepted, and the draft opens.
 * Once converted, links to that invoice instead. Renders nothing for other document types or a cancelled quote.
 */
export function QuoteActions({ invoice, className, primary = true }: { invoice: Invoice; className?: string; /** Set false when another primary button is next to it. */ primary?: boolean }) {
  const { t, profile, invoices, saveInvoice } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  if (invoice.type !== 'quote' || !profile) return null
  const today = localTodayISO()
  const status = quoteStatus(invoice, today, invoices)
  if (status === 'cancelled') return null
  const converted = invoiceFromQuote(invoice, invoices)

  const convert = async () => {
    setBusy(true)
    try {
      const draft = quoteToInvoiceDraft(invoice, profile, today)
      await saveInvoice(draft)
      try {
        await saveInvoice(markQuoteAccepted(invoice, draft.id))
      } catch (e) {
        // The draft already links back to the quote (convertedFromQuoteId), which is enough to show it accepted.
        console.warn('Could not record the conversion on the quote', e)
      }
      toast.success(t('quote.convertedDone', { number: invoice.number || t('quote.draftNumber') }))
      navigate(`/invoices/${draft.id}`)
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className={`quote-actions${className ? ' ' + className : ''}`}>
      {converted ? (
        <p className="quote-converted">
          {invoice.quoteAcceptedAt && <span className="muted">{t('quote.acceptedOn', { date: formatDate(localDateOf(invoice.quoteAcceptedAt)) })}. </span>}
          {t('quote.converted')} <Link to={`/invoices/${converted.id}`}>{converted.number || t('quote.draftNumber')}</Link>
        </p>
      ) : (
        <>
          <button type="button" className={primary ? 'btn btn-primary' : 'btn'} onClick={() => void convert()} disabled={busy}>
            <ReceiptIcon />
            {busy ? t('common.working') : t('quote.convert')}
          </button>
          <p className="quote-hint muted small">{t(status === 'expired' ? 'quote.convertExpired' : 'quote.convertHint')}</p>
        </>
      )}
    </div>
  )
}
