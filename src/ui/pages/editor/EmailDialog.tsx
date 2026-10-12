import { AppWindowIcon, EnvelopeSimpleIcon, PaperclipIcon, ShareNetworkIcon } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import type { Invoice } from '../../../domain'
import { buildMailtoUrl, canShareFiles, downloadBlob, googleSignIn, sendViaGmail, shareFiles, type EmailDraft } from '../../../integrations'
import { invoiceFileName, renderInvoicePdf } from '../../../pdf'
import { useApp } from '../../AppContext'
import { Dialog } from '../../components/Dialog'
import { TextAreaField, TextField } from '../../components/fields'
import { useToast } from '../../Toasts'
import { errorMessage, fillTemplate } from '../../util'
import { emailTemplates, emailVars, parseRecipients } from './email'

export function EmailDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t, profile, settings } = useApp()
  const toast = useToast()
  const vars = useMemo(() => emailVars(invoice, invoice.seller.name || profile?.name || ''), [invoice, profile])
  const tpl = useMemo(() => emailTemplates(invoice.language, profile?.defaults), [invoice.language, profile])
  const [to, setTo] = useState(invoice.buyer.email ?? '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(() => fillTemplate(tpl.subject, vars))
  const [body, setBody] = useState(() => fillTemplate(tpl.body, vars))
  const [pdf, setPdf] = useState<Blob | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const fileName = useMemo(() => invoiceFileName(invoice, 'pdf'), [invoice])

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
  const shareable = useMemo(() => !!file && canShareFiles([file]), [file])

  const toList = parseRecipients(to)
  const ccList = parseRecipients(cc)
  const recipients = toList.valid.map((r) => r.display)
  const draft = (): EmailDraft => ({
    to: recipients,
    cc: ccList.valid.map((r) => r.display),
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
      // mailto: only takes bare addresses (RFC 6068).
      window.location.href = buildMailtoUrl({ ...rest, to: toList.valid.map((r) => r.address), cc: ccList.valid.map((r) => r.address) })
      toast.info(t('email.attachHint', { file: fileName }))
      onClose()
    })

  const hasGmail = !!settings.googleClientId
  const addressesOk = toList.invalid.length === 0 && ccList.invalid.length === 0
  const ready = !!pdf && recipients.length > 0 && addressesOk && busy === null

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
              <EnvelopeSimpleIcon />
              {busy === 'gmail' ? t('common.working') : t('email.gmail')}
            </button>
          )}
          {shareable && (
            <button type="button" className={`btn${hasGmail ? '' : ' btn-primary'}`} onClick={() => void share()} disabled={!pdf || !addressesOk || busy !== null}>
              <ShareNetworkIcon />
              {t('email.share')}
            </button>
          )}
          <button type="button" className={`btn${hasGmail || shareable ? '' : ' btn-primary'}`} onClick={() => void mailApp()} disabled={!pdf || !addressesOk || busy !== null}>
            <AppWindowIcon />
            {t('email.mailApp')}
          </button>
        </div>
      }
    >
      <div className="stack-sm">
        <TextField
          label={t('email.to')}
          inputMode="email"
          autoComplete="email"
          value={to}
          onChange={setTo}
          required
          hint={t('email.toHint')}
          error={toList.invalid.length ? t('email.invalidAddress', { list: toList.invalid.join(', ') }) : undefined}
          data-autofocus={!to || undefined}
        />
        <TextField
          label={t('email.cc')}
          inputMode="email"
          autoComplete="email"
          value={cc}
          onChange={setCc}
          error={ccList.invalid.length ? t('email.invalidAddress', { list: ccList.invalid.join(', ') }) : undefined}
        />
        <TextField label={t('email.subject')} value={subject} onChange={setSubject} />
        <TextAreaField label={t('email.body')} value={body} onChange={setBody} rows={8} />
        <p className="attachment">
          <PaperclipIcon />
          <span className="attachment-label">{t('email.attachment')}</span>
          <span className={pdf ? 'mono' : pdfError ? 'attachment-error' : 'muted'}>{pdf ? fileName : pdfError ? t('pdf.failed') + ' ' + pdfError : t('email.preparingPdf')}</span>
        </p>
        <p className="muted small">{hasGmail ? t('email.gmailHint') : t('email.noGmailHint')}</p>
      </div>
    </Dialog>
  )
}
