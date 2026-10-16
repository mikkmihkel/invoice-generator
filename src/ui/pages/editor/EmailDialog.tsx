import { AppWindowIcon, EnvelopeSimpleIcon, PaperclipIcon, ShareNetworkIcon } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { outstandingAmount, type Invoice } from '../../../domain'
import { buildMailtoUrl, canShareFiles, downloadBlob, googleSignIn, sendViaGmail, shareFiles, type EmailDraft } from '../../../integrations'
import { invoiceFileName, renderInvoicePdf } from '../../../pdf'
import { useApp } from '../../AppContext'
import { Dialog } from '../../components/Dialog'
import { TextAreaField, TextField } from '../../components/fields'
import { useToast } from '../../Toasts'
import { lateInterest } from '../../../domain/interest'
import { errorMessage, localTodayISO } from '../../util'
import { recordInvoiceEvent, useInvoiceEvents } from '../invoice-detail/events'
import { canMarkSent, sentPromptKey, useMarkSent, type SentKind } from '../invoice-detail/markSent'
import { emailTemplates, fillEmailText, parseRecipients, reminderTemplates, type EmailKind, type ReminderInterest } from './email'

/**
 * Send the invoice PDF by e-mail; `kind="reminder"` starts from the payment reminder text instead (with the late
 * interest when the invoice has a rate, and a firmer text once `previousReminders` > 0). A send through Gmail is
 * recorded as a 'sent' or 'reminder' event of the invoice. Handing the e-mail to the mail app or the share sheet
 * does not say it was sent, so it is not recorded: `onHandedOff` is called to ask the user (without it, a toast
 * asks), and "Mark as sent" records it.
 */
export function EmailDialog({
  invoice,
  onClose,
  kind = 'invoice',
  onSent,
  onHandedOff,
  previousReminders,
}: {
  invoice: Invoice
  onClose: () => void
  kind?: EmailKind
  onSent?: () => void
  /** The e-mail went to the mail app or the share sheet; the caller asks whether it was sent. */
  onHandedOff?: (kind: SentKind) => void
  /** Reminders sent before this one; read from the invoice's history when not given. */
  previousReminders?: number
}) {
  const { t, profile, settings, invoices, repo } = useApp()
  const history = useInvoiceEvents(invoice.id)
  const second = (previousReminders ?? history.reminders.length) > 0
  const toast = useToast()
  const markSent = useMarkSent()
  const company = invoice.seller.name || profile?.name || ''
  // A reminder asks for what is still owed after credit notes, not the original total.
  const amount = kind === 'reminder' ? outstandingAmount(invoice, invoices) : undefined
  const [interest] = useState<ReminderInterest | undefined>(() => {
    if (kind !== 'reminder' || amount === undefined) return undefined
    const rate = invoice.lateInterestPercentPerDay
    const li = lateInterest(amount, rate, invoice.dueDate, localTodayISO())
    return li.amount > 0 && rate ? { ...li, ratePercentPerDay: rate } : undefined
  })
  const tpl = useMemo(
    () =>
      kind === 'reminder'
        ? reminderTemplates(invoice.language, { second, interest: !!interest })
        : emailTemplates(invoice.language, profile?.defaults, invoice.type),
    [kind, invoice.language, invoice.type, profile, second, interest],
  )
  const [to, setTo] = useState(invoice.buyer.email ?? '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(() => fillEmailText(tpl.subject, invoice, company, amount, interest))
  const [body, setBody] = useState(() => fillEmailText(tpl.body, invoice, company, amount, interest))
  // The reminder history loads after opening: switch to the second-reminder text unless the user already edited.
  const [edited, setEdited] = useState(false)
  const [shownTpl, setShownTpl] = useState(tpl)
  if (shownTpl !== tpl && !edited) {
    setShownTpl(tpl)
    setSubject(fillEmailText(tpl.subject, invoice, company, amount, interest))
    setBody(fillEmailText(tpl.body, invoice, company, amount, interest))
  }
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

  const sent = async () => {
    if (invoice.status !== 'draft') {
      try {
        await recordInvoiceEvent(repo, invoice.id, kind === 'reminder' ? 'reminder' : 'sent', toList.valid.map((r) => r.address).join(', '))
      } catch (e) {
        console.warn('Could not record the e-mail', e)
      }
    }
    onSent?.()
  }

  /** Mail app or share sheet: the app cannot tell whether the e-mail went out, so it asks instead of recording it. */
  const handedOff = () => {
    const event: SentKind = kind === 'reminder' ? 'reminder' : 'sent'
    if (invoice.status === 'draft' || (event === 'sent' && !canMarkSent(invoice, history.events))) return
    if (onHandedOff) onHandedOff(event)
    else toast.info(t(sentPromptKey(invoice.type, event)), { label: t('sent.mark'), onClick: () => void markSent(invoice, event) })
  }

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
      await sent()
      onClose()
    })

  const share = () =>
    run('share', async () => {
      const shared = await shareFiles(draft())
      if (!shared) return // dismissed by the user
      toast.success(t('email.shared'))
      handedOff()
      onClose()
    })

  const mailApp = () =>
    run('mailto', async () => {
      if (pdf) downloadBlob(pdf, fileName)
      const { attachments: _a, ...rest } = draft()
      // mailto: only takes bare addresses (RFC 6068).
      window.location.href = buildMailtoUrl({ ...rest, to: toList.valid.map((r) => r.address), cc: ccList.valid.map((r) => r.address) })
      toast.info(t('email.attachHint', { file: fileName }))
      handedOff()
      onClose()
    })

  const hasGmail = !!settings.googleClientId
  const addressesOk = toList.invalid.length === 0 && ccList.invalid.length === 0
  const ready = !!pdf && recipients.length > 0 && addressesOk && busy === null

  return (
    <Dialog
      title={t(kind === 'reminder' ? (second ? 'reminder.secondTitle' : 'editor.reminderTitle') : invoice.type === 'quote' ? 'email.quoteTitle' : 'email.title', { number: invoice.number })}
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
        <TextField
          label={t('email.subject')}
          value={subject}
          onChange={(v) => {
            setEdited(true)
            setSubject(v)
          }}
        />
        <TextAreaField
          label={t('email.body')}
          value={body}
          onChange={(v) => {
            setEdited(true)
            setBody(v)
          }}
          rows={8}
        />
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
