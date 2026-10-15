import { createElement, Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { computeTotals, holdsNumber, newId, outstandingAmount, planDeletion, reopenBlocker, stopRulesFor, type Invoice, type InvoiceLanguage } from '../../../domain'
import { remainingCreditLines } from '../../../domain/settlement'
import { buildUblXml } from '../../../einvoice'
import { downloadBlob, googleSignIn, uploadToDrive } from '../../../integrations'
import { noteDeletedDocuments } from '../../../integrations/autoBackup'
import { invoiceFileName, renderInvoicePdf, renderInvoicePdfBase64 } from '../../../pdf'
import { useApp } from '../../AppContext'
import { useConfirm } from '../../components/Dialog'
import { formatMoney } from '../../format'
import { useToast } from '../../Toasts'
import { errorMessage, isCreditSettled, localTodayISO, nowISO } from '../../util'
import { creditNoteFor, duplicateInvoice } from '../editor/builders'

export type ActionKey = 'pdf' | 'print' | 'xml' | 'drive' | 'copy' | 'cancel' | 'paid' | 'unpaid' | 'delete' | 'reopen'

/**
 * Delete a document (and what goes with it, see planDeletion) with an undo button in the confirmation toast.
 * Errors are shown as a toast and rethrown.
 */
export function useDeleteDocument() {
  const { t, invoices, invoiceEvents, settings, deleteInvoice, restoreDeletedInvoice } = useApp()
  const toast = useToast()
  return useCallback(
    async (invoice: Invoice): Promise<void> => {
      // Issued documents deleted on purpose: the next automatic backup may have fewer of them. Recorded before the
      // deletion, so a backup that runs meanwhile already knows, and taken back if the deletion fails.
      const clientId = settings.googleClientId ?? ''
      const folder = settings.driveFolderName
      const expected = planDeletion(invoice, invoices, null, invoiceEvents).documents.filter(holdsNumber).length
      if (expected) noteDeletedDocuments(expected, clientId, folder)
      let deleted
      try {
        deleted = await deleteInvoice(invoice.id)
      } catch (e) {
        if (expected) noteDeletedDocuments(-expected, clientId, folder)
        toast.error(e)
        throw e
      }
      const issued = deleted ? deleted.invoices.filter(holdsNumber).length : 0
      if (issued !== expected) noteDeletedDocuments(issued - expected, clientId, folder)
      const numbered = holdsNumber(invoice)
      const doc = t(`invoice.type.${invoice.type}`)
      const params = { doc, number: invoice.number }
      if (!deleted) {
        toast.success(t('actions.draftDeleted'))
        return
      }
      const restore = deleted
      toast.success(numbered ? t(deleted.invoices.length > 1 ? 'delete.doneWithCredit' : 'delete.done', params) : t('actions.draftDeleted'), {
        label: t('payment.undo'),
        onClick: () => {
          restoreDeletedInvoice(restore).then(
            () => {
              if (issued) noteDeletedDocuments(-issued, clientId, folder)
              toast.info(numbered ? t(restore.invoices.length > 1 ? 'delete.undoneWithCredit' : 'delete.undone', params) : t('delete.draftUndone'))
            },
            (e: unknown) => toast.error(e),
          )
        },
      })
    },
    [t, toast, invoices, invoiceEvents, settings.googleClientId, settings.driveFolderName, deleteInvoice, restoreDeletedInvoice],
  )
}

/** The rule shown when reopening: until it is sent, and what to do with a sent document of this type. */
export function reopenRuleKey(type: Invoice['type']): 'reopen.sentRule' | 'reopen.sentRuleCredit' | 'reopen.sentRuleQuote' {
  return type === 'quote' ? 'reopen.sentRuleQuote' : type === 'credit-note' ? 'reopen.sentRuleCredit' : 'reopen.sentRule'
}

/** Whether the document can be reopened for editing now (issued, not sent, paid, cancelled or credited). */
export function useCanReopen(invoice: Invoice): boolean {
  const { invoices, invoiceEvents } = useApp()
  return reopenBlocker(invoice, invoices, invoiceEvents) === null
}

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

  const deleteDocument = useDeleteDocument()
  const deleteDraft = async () => {
    const ok = await confirm({ title: t('actions.deleteDraftTitle'), message: t('actions.deleteDraftConfirm'), confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), danger: true })
    if (!ok) return
    setBusy('delete')
    try {
      await deleteDocument(invoice)
      navigate('/')
    } catch {
      // shown by deleteDocument
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  const reopen = async () => {
    const doc = t(`invoice.type.${invoice.type}`)
    const ok = await confirm({
      title: t('reopen.title', { doc: doc.toLocaleLowerCase(), number: invoice.number }),
      message: createElement(
        Fragment,
        null,
        createElement('p', null, t('reopen.text', { doc, number: invoice.number })),
        createElement('p', { className: 'muted small' }, t(reopenRuleKey(invoice.type))),
      ),
      confirmLabel: t('reopen.action'),
      cancelLabel: t('common.cancel'),
    })
    if (!ok) return
    await act('reopen', async () => {
      await app.reopenInvoice(invoice.id)
      toast.success(t('reopen.done', { doc, number: invoice.number }))
      navigate(`/invoices/${invoice.id}`)
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
    reopen,
  }
}
