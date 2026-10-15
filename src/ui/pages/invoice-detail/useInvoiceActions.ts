import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { computeTotals, newId, outstandingAmount, stopRulesFor, type Invoice, type InvoiceLanguage } from '../../../domain'
import { remainingCreditLines } from '../../../domain/settlement'
import { buildUblXml } from '../../../einvoice'
import { downloadBlob, googleSignIn, uploadToDrive } from '../../../integrations'
import { invoiceFileName, renderInvoicePdf, renderInvoicePdfBase64 } from '../../../pdf'
import { useApp } from '../../AppContext'
import { useConfirm } from '../../components/Dialog'
import { formatMoney } from '../../format'
import { useToast } from '../../Toasts'
import { errorMessage, isCreditSettled, localTodayISO, nowISO } from '../../util'
import { creditNoteFor, duplicateInvoice } from '../editor/builders'

export type ActionKey = 'pdf' | 'print' | 'xml' | 'drive' | 'copy' | 'cancel' | 'paid' | 'unpaid' | 'delete'

/**
 * "Mark paid" in one click: paid today, with an undo button in the confirmation toast. Usable from any list of
 * invoices; the returned function resolves to false when the change failed (the error is shown as a toast, or
 * rethrown with `rethrow`, e.g. for a dialog that shows it itself).
 */
export function useMarkPaid() {
  const { t, markInvoicePaid, markInvoiceUnpaid } = useApp()
  const toast = useToast()
  return useCallback(
    async (invoice: Pick<Invoice, 'id' | 'number'>, paidAt: string = localTodayISO(), opts: { rethrow?: boolean } = {}): Promise<boolean> => {
      try {
        await markInvoicePaid(invoice.id, paidAt)
      } catch (e) {
        if (opts.rethrow) throw e
        toast.error(e)
        return false
      }
      toast.success(t('payment.markedPaid', { number: invoice.number }), {
        label: t('payment.undo'),
        onClick: () => {
          markInvoiceUnpaid(invoice.id).then(
            () => toast.info(t('payment.undone', { number: invoice.number })),
            (e: unknown) => toast.error(e),
          )
        },
      })
      return true
    },
    [t, toast, markInvoicePaid, markInvoiceUnpaid],
  )
}

/** Description of the single credit line per VAT rate used when earlier credit notes do not match the lines. */
function remainderLabel(inv: Invoice, rate: number, multipleRates: boolean): string {
  const et = `Arve ${inv.number} krediteerimata jääk`
  const en = `Remaining amount of invoice ${inv.number}`
  const byLang: Record<InvoiceLanguage, string> = { et, en, 'et-en': `${et} / ${en}` }
  return byLang[inv.language] + (multipleRates ? ` (${rate}%)` : '')
}

/**
 * The document actions of the selected invoice (same behaviour as in the editor). `invoice` is the stored record,
 * `effective` the one to render (drafts take the current company profile).
 */
export function useInvoiceActions(invoice: Invoice, effective: Invoice) {
  const app = useApp()
  const { t, profile, settings } = app
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<ActionKey | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const act = async (key: ActionKey, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  const renderPdf = async () => {
    try {
      return await renderInvoicePdf(effective)
    } catch (e) {
      throw new Error(t('pdf.failed') + ' ' + errorMessage(e))
    }
  }

  const downloadPdf = () => act('pdf', async () => downloadBlob(await renderPdf(), invoiceFileName(effective, 'pdf')))

  const print = () =>
    act('print', async () => {
      // Open the window synchronously (inside the click) so popup blockers allow it, then load the PDF.
      const w = window.open('', '_blank')
      if (w) w.opener = null
      const blob = await renderPdf().catch((e) => {
        w?.close()
        throw e
      })
      if (!w) {
        downloadBlob(blob, invoiceFileName(effective, 'pdf'))
        return
      }
      const url = URL.createObjectURL(blob)
      w.location.href = url
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    })

  const downloadXml = () =>
    act('xml', async () => {
      let pdf: { base64: string; fileName: string } | undefined
      try {
        // The PDF goes inside the XML, so it must not carry its own embedded copy of the XML.
        pdf = { base64: await renderInvoicePdfBase64(invoice, { embedEInvoice: false }), fileName: invoiceFileName(invoice, 'pdf') }
      } catch (e) {
        console.warn('PDF embedding failed', e)
      }
      const xml = buildUblXml(invoice, pdf ? { pdf } : {})
      downloadBlob(new Blob([xml], { type: 'application/xml' }), invoiceFileName(invoice, 'xml'))
      toast.success(t('einvoice.downloaded'))
    })

  const saveToDrive = () =>
    act('drive', async () => {
      if (!settings.googleClientId) {
        toast.info(t('google.needClientId'))
        navigate('/settings')
        return
      }
      // Sign in first: the consent popup must open directly from the click.
      await googleSignIn(settings.googleClientId, ['drive'])
      const blob = await renderPdf()
      const res = await uploadToDrive(settings.googleClientId, blob, invoiceFileName(effective, 'pdf'), settings.driveFolderName)
      toast.success(t('drive.saved', { folder: settings.driveFolderName }), res.webViewLink ? { label: t('drive.open'), href: res.webViewLink } : undefined)
    })

  const openCopy = (inv: Invoice, msg: string) =>
    act('copy', async () => {
      await app.saveInvoice(inv)
      toast.success(msg)
      navigate(`/invoices/${inv.id}`)
    })

  const duplicate = () => profile && openCopy(duplicateInvoice(effective, profile), t('actions.duplicated'))
  /** Switch off the rules repeating this invoice once it is cancelled; true when there was one. */
  const stopRecurring = async () => {
    const rules = stopRulesFor(app.recurringRules, invoice.id, nowISO())
    for (const rule of rules) await app.saveRecurringRule(rule)
    return rules.length > 0
  }
  const stoppedNote = (stopped: boolean) => (stopped ? ' ' + t('recurring.stoppedOnCancel') : '')

  const creditNote = () => profile && openCopy(creditNoteFor(invoice, profile), t('actions.creditCreated', { number: invoice.number }))

  const cancel = async () => {
    const quote = invoice.type === 'quote'
    const ok = await confirm({
      title: t(quote ? 'payment.cancelQuoteTitle' : 'actions.cancelTitle', { number: invoice.number }),
      message: t(quote ? 'payment.cancelQuoteConfirm' : 'actions.cancelConfirm'),
      confirmLabel: t(quote ? 'payment.cancelQuote' : 'actions.cancelInvoice'),
      cancelLabel: t('common.back'),
      danger: true,
    })
    if (!ok) return
    await act('cancel', async () => {
      await app.cancelInvoice(invoice.id)
      if (await stopRecurring()) toast.success(t('payment.cancelledOnly', { number: invoice.number }) + stoppedNote(true))
    })
  }

  const markUnpaid = () => act('unpaid', async () => void (await app.markInvoiceUnpaid(invoice.id)))

  const markPaidNow = useMarkPaid()
  const markPaid = () => act('paid', async () => void (await markPaidNow(invoice)))
  /** From the date dialog: errors propagate so the dialog stays open. */
  const markPaidOn = async (paidAt: string) => void (await markPaidNow(invoice, paidAt, { rethrow: true }))
  const changePaidDate = async (paidAt: string) => {
    await app.markInvoicePaid(invoice.id, paidAt)
    toast.success(t('payment.dateChanged'))
  }

  /**
   * Whether cancelling goes through a credit note: issued invoices (not quotes or credit notes) that still
   * have something left to credit.
   */
  const cancelsWithCredit = (invoice.type === 'invoice' || invoice.type === 'prepayment') && invoice.status === 'issued' && !isCreditSettled(invoice, app.invoices)
  const remaining = cancelsWithCredit ? outstandingAmount(invoice, app.invoices) : 0

  /**
   * Cancel an issued invoice in one step: create a credit note for whatever is still open, issue it and mark the
   * invoice cancelled. If the credit note cannot be issued (e.g. the profile became incomplete), its draft opens
   * in the editor instead and the invoice stays as it was.
   */
  const cancelWithCredit = () =>
    act('cancel', async () => {
      if (!profile) return
      const rates = new Set(invoice.lines.map((l) => l.vatRate))
      const lines = remainingCreditLines(invoice, app.invoices, (rate) => remainderLabel(invoice, rate, rates.size > 1 && invoice.vatScheme === 'domestic'))
      if (lines === null) {
        // No credit note comes to exactly the remainder: the user adjusts the lines, the invoice stays as it was.
        const manual = creditNoteFor(invoice, profile)
        await app.saveInvoice(manual)
        toast.warning(t('payment.creditManual', { amount: formatMoney(remaining, invoice.currency) }))
        navigate(`/invoices/${manual.id}`)
        return
      }
      if (lines.length === 0 || computeTotals({ ...invoice, lines: lines.map((l) => ({ ...l, id: '' })) }).gross === 0) {
        await app.cancelInvoice(invoice.id)
        toast.success(t('payment.cancelledOnly', { number: invoice.number }) + stoppedNote(await stopRecurring()))
        return
      }
      const draft: Invoice = { ...creditNoteFor(invoice, profile), lines: lines.map((l) => ({ ...l, id: newId() })) }
      await app.saveInvoice(draft)
      let credit: Invoice
      try {
        credit = await app.issueInvoice(draft.id)
      } catch (e) {
        toast.error(t('payment.creditIssueFailed') + ' ' + errorMessage(e))
        navigate(`/invoices/${draft.id}`)
        return
      }
      await app.cancelInvoice(invoice.id)
      toast.success(t('payment.cancelled', { number: invoice.number, credit: credit.number }) + stoppedNote(await stopRecurring()))
      // Keep the cancelled invoice in view (the new credit note would otherwise be first in the list).
      navigate(`/?id=${invoice.id}`)
    })

  const deleteDraft = async () => {
    const ok = await confirm({ title: t('actions.deleteDraftTitle'), message: t('actions.deleteDraftConfirm'), confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), danger: true })
    if (!ok) return
    await act('delete', async () => {
      await app.deleteInvoice(invoice.id)
      toast.success(t('actions.draftDeleted'))
      navigate('/')
    })
  }

  return {
    busy,
    downloadPdf,
    print,
    downloadXml,
    saveToDrive,
    duplicate,
    creditNote,
    cancel,
    cancelsWithCredit,
    remaining,
    cancelWithCredit,
    markPaid,
    markPaidOn,
    changePaidDate,
    markUnpaid,
    deleteDraft,
  }
}
