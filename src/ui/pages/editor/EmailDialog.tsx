import { useEffect, useMemo, useState } from 'react'
import type { Invoice } from '../../../domain'
import { buildMailtoUrl, canShareFiles, downloadBlob, googleSignIn, sendViaGmail, shareFiles, type EmailDraft } from '../../../integrations'
import { invoiceFileName, renderInvoicePdf } from '../../../pdf'
import { useApp } from '../../AppContext'
import { Dialog } from '../../components/Dialog'
import { TextAreaField, TextField } from '../../components/fields'
import { formatDate, formatMoney } from '../../format'
import { useToast } from '../../Toasts'
import { errorMessage, fillTemplate, safeTotals } from '../../util'

function splitAddresses(s: string): string[] {
  return s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

export function emailVars(inv: Invoice, companyName: string): Record<string, string> {
  return {
    number: inv.number,
    company: companyName,
    client: inv.buyer.name,
    total: formatMoney(safeTotals(inv).gross, inv.currency),
    dueDate: formatDate(inv.dueDate),
  }
}

export function EmailDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t, profile, settings } = useApp()
  const toast = useToast()
  const vars = useMemo(() => emailVars(invoice, invoice.seller.name || profile?.name || ''), [invoice, profile])
  const [to, setTo] = useState(invoice.buyer.email ?? '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(() => fillTemplate(profile?.defaults.emailSubject || t('email.defaultSubject'), vars))
  const [body, setBody] = useState(() => fillTemplate(profile?.defaults.emailBody || t('email.defaultBody'), vars))
  const [pdf, setPdf] = useState<Blob | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const fileName = useMemo(() => {
    try {
      return invoiceFileName(invoice, 'pdf')
    } catch {
      return `invoice-${invoice.number || invoice.id}.pdf`
    }
  }, [invoice])

  useEffect(() => {
    let alive = true
    renderInvoicePdf(invoice)
      .then((b) => alive && setPdf(b))
      .catch((e) => alive && setPdfError(errorMessage(e)))
    return () => {
      alive = false
    }
  }, [invoice])

  const file = useMemo(() => (pdf ? new File([pdf], fileName, { type: 'application/pdf' }) : null), [pdf, fileName])
  const shareable = useMemo(() => {
    if (!file) return false
    try {
      return canShareFiles([file])
    } catch {
      return false
    }
  }, [file])

  const recipients = splitAddresses(to)
  const draft = (): EmailDraft => ({
    to: recipients,
    cc: splitAddresses(cc),
    subject,
    body,
    attachments: pdf ? [{ fileName, blob: pdf }] : [],
  })

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      toast.error(t('email.failed') + ' ' + errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const gmail = () =>
    run('gmail', async () => {
      if (!settings.googleClientId) return
      // Sign in first: the consent popup must open directly from the click.
      await googleSignIn(settings.googleClientId, ['gmail'])
      await sendViaGmail(settings.googleClientId, draft())
      toast.success(t('email.sent', { to: recipients.join(', ') }))
      onClose()
    })

  const share = () =>
    run('share', async () => {
      const shared = await shareFiles(draft())
      if (!shared) return // dismissed by the user
      toast.success(t('email.shared'))
      onClose()
    })

  const mailApp = () =>
    run('mailto', async () => {
      if (pdf) downloadBlob(pdf, fileName)
      const { attachments: _a, ...rest } = draft()
      window.location.href = buildMailtoUrl(rest)
      toast.info(t('email.attachHint', { file: fileName }))
      onClose()
    })

  const hasGmail = !!settings.googleClientId
  const ready = !!pdf && recipients.length > 0 && busy === null

  return (
    <Dialog
      title={t('email.title', { number: invoice.number })}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide
      footer={
        <div className="email-actions">
          {hasGmail && (
            <button type="button" className="btn btn-primary" onClick={() => void gmail()} disabled={!ready}>
              {busy === 'gmail' ? t('common.working') : t('email.gmail')}
            </button>
          )}
          {shareable && (
            <button type="button" className={`btn${hasGmail ? '' : ' btn-primary'}`} onClick={() => void share()} disabled={!pdf || busy !== null}>
              {t('email.share')}
            </button>
          )}
          <button type="button" className={`btn${hasGmail || shareable ? '' : ' btn-primary'}`} onClick={() => void mailApp()} disabled={!pdf || busy !== null}>
            {t('email.mailApp')}
          </button>
        </div>
      }
    >
      <div className="stack-sm">
        <TextField label={t('email.to')} type="email" multiple value={to} onChange={setTo} required hint={t('email.toHint')} data-autofocus={!to || undefined} />
        <TextField label={t('email.cc')} type="email" multiple value={cc} onChange={setCc} />
        <TextField label={t('email.subject')} value={subject} onChange={setSubject} />
        <TextAreaField label={t('email.body')} value={body} onChange={setBody} rows={8} />
        <p className="attachment">
          <strong>{t('email.attachment')}: </strong>
          {pdf ? fileName : pdfError ? t('pdf.failed') + ' ' + pdfError : t('email.preparingPdf')}
        </p>
        <p className="muted small">{hasGmail ? t('email.gmailHint') : t('email.noGmailHint')}</p>
      </div>
    </Dialog>
  )
}
