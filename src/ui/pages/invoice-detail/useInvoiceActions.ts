import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Invoice } from '../../../domain'
import { buildUblXml } from '../../../einvoice'
import { downloadBlob, googleSignIn, uploadToDrive } from '../../../integrations'
import { invoiceFileName, renderInvoicePdf, renderInvoicePdfBase64 } from '../../../pdf'
import { useApp } from '../../AppContext'
import { useConfirm } from '../../components/Dialog'
import { useToast } from '../../Toasts'
import { errorMessage } from '../../util'
import { creditNoteFor, duplicateInvoice } from '../editor/builders'

export type ActionKey = 'pdf' | 'print' | 'xml' | 'drive' | 'copy' | 'cancel' | 'unpaid' | 'delete'

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
  const creditNote = () => profile && openCopy(creditNoteFor(invoice, profile), t('actions.creditCreated', { number: invoice.number }))

  const cancel = async () => {
    const ok = await confirm({
      title: t('actions.cancelTitle', { number: invoice.number }),
      message: t('actions.cancelConfirm'),
      confirmLabel: t('actions.cancelInvoice'),
      cancelLabel: t('common.back'),
      danger: true,
    })
    if (ok) await act('cancel', async () => void (await app.cancelInvoice(invoice.id)))
  }

  const markUnpaid = () => act('unpaid', async () => void (await app.markInvoiceUnpaid(invoice.id)))

  const deleteDraft = async () => {
    const ok = await confirm({ title: t('actions.deleteDraftTitle'), message: t('actions.deleteDraftConfirm'), confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), danger: true })
    if (!ok) return
    await act('delete', async () => {
      await app.deleteInvoice(invoice.id)
      toast.success(t('actions.draftDeleted'))
      navigate('/')
    })
  }

  return { busy, downloadPdf, print, downloadXml, saveToDrive, duplicate, creditNote, cancel, markUnpaid, deleteDraft }
}
