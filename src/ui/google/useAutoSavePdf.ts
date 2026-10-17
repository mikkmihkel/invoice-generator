import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Invoice } from '../../domain'
import { googleSignIn, uploadToDrive } from '../../integrations'
import { autoSavePdfEnabled, driveFolderLabel, driveFolderRef, effectiveClientId } from '../../integrations/googleClient'
import { invoiceFileName, renderInvoicePdf } from '../../pdf'
import { useApp } from '../AppContext'
import { subscribeIssued } from '../issueEvents'
import { useToast } from '../Toasts'
import { errorMessage } from '../util'

/**
 * Uploads the PDF of every invoice issued in this tab to the chosen Drive folder ("Arved" subfolder), when the user
 * has a folder and has not switched the option off. Runs in the background after issuing: it never opens a Google
 * popup on its own and never makes issuing fail. A failure shows a toast whose button tries again (signing in first,
 * from that click). Quotes are not uploaded. Mount once in the app shell.
 */
export function useAutoSavePdf(): void {
  const { settings, t } = useApp()
  const toast = useToast()
  const latest = useRef({ settings, t, toast })
  useLayoutEffect(() => {
    latest.current = { settings, t, toast }
  }, [settings, t, toast])

  useEffect(() => {
    const save = async (invoice: Invoice, interactive: boolean) => {
      const { settings: s, t: tr, toast: tt } = latest.current
      const clientId = effectiveClientId(s)
      if (!clientId) return
      const params = { doc: tr(`invoice.type.${invoice.type}`), number: invoice.number }
      const retry = (label: string) => ({ label, onClick: () => void save(invoice, true) })
      try {
        // From the toast's button: the consent popup must open directly from that click.
        if (interactive) await googleSignIn(clientId, ['drive'])
        const blob = await renderInvoicePdf(invoice)
        const res = await uploadToDrive(clientId, blob, invoiceFileName(invoice, 'pdf'), driveFolderRef(s, 'pdf'), interactive ? {} : { interactive: false })
        tt.success(tr('drive.saved', { folder: driveFolderLabel(s, 'pdf') }), res.webViewLink ? { label: tr('drive.open'), href: res.webViewLink } : undefined)
      } catch (e) {
        // No token in this session (after a reload): background work waits for the user instead of opening a popup.
        if (!interactive && (e as { code?: string } | null)?.code === 'unauthorized') tt.warning(tr('gdrive.pdfNeedsSignin', params), retry(tr('gdrive.pdfSignInSave')))
        else tt.error(tr('gdrive.pdfFailed', { ...params, reason: errorMessage(e) }), retry(tr('gdrive.retry')))
      }
    }
    return subscribeIssued((issued) => {
      if (issued.type === 'quote' || !autoSavePdfEnabled(latest.current.settings)) return
      void save(issued, false)
    })
  }, [])
}
