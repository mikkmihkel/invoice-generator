import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_EMAIL_BODY_EN,
  DEFAULT_EMAIL_BODY_ET,
  DEFAULT_EMAIL_SUBJECT_EN,
  DEFAULT_EMAIL_SUBJECT_ET,
  type InvoiceDefaults,
  type Invoice,
  type InvoiceLanguage,
} from '../../../domain'
import { buildMailtoUrl, canShareFiles, downloadBlob, googleSignIn, sendViaGmail, shareFiles, type EmailDraft } from '../../../integrations'
import { invoiceFileName, renderInvoicePdf } from '../../../pdf'
import { formatDate as formatDocumentDate } from '../../../pdf/format'
import { useApp } from '../../AppContext'
import { Dialog } from '../../components/Dialog'
import { TextAreaField, TextField } from '../../components/fields'
import { formatDate, formatMoney } from '../../format'
import { useToast } from '../../Toasts'
import { errorMessage, fillTemplate, safeTotals } from '../../util'

export interface Recipient {
  /** As typed, e.g. "Jaan Tamm <jaan@firma.ee>" or "jaan@firma.ee". */
  display: string
  address: string
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/

/**
 * Split a recipient field on commas, semicolons and line breaks (not inside quotes), accepting
 * "Name <address>" as well as bare addresses. Invalid entries are returned separately.
 */
export function parseRecipients(input: string): { valid: Recipient[]; invalid: string[] } {
  const parts: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of input) {
    if (ch === '"') quoted = !quoted
    if (!quoted && (ch === ',' || ch === ';' || ch === '\n' || ch === '\r')) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  const valid: Recipient[] = []
  const invalid: string[] = []
  for (const raw of parts) {
    const display = raw.trim()
    if (!display) continue
    const m = /^(.*?)\s*<([^<>]*)>$/.exec(display)
    const address = (m ? m[2] : display).trim()
    if (EMAIL_RE.test(address)) valid.push({ display: m && m[1].trim() ? display : address, address })
    else invalid.push(display)
  }
  return { valid, invalid }
}

/** Template variables; amounts and dates follow the invoice language like the PDF does. */
export function emailVars(inv: Invoice, companyName: string): Record<string, string> {
  const en = inv.language === 'en'
  return {
    number: inv.number,
    company: companyName,
    client: inv.buyer.name,
    total: formatMoney(safeTotals(inv).gross, inv.currency, inv.language),
    dueDate: en ? formatDocumentDate(inv.dueDate, 'en') : formatDate(inv.dueDate),
  }
}

/**
 * Subject/body templates for the invoice language: Estonian, English, or for bilingual invoices an Estonian
 * subject and the Estonian body followed by the English one. Profiles saved before the English templates
 * existed fall back to the built-in defaults.
 */
export function emailTemplates(lang: InvoiceLanguage, d: Partial<InvoiceDefaults> | undefined): { subject: string; body: string } {
  const et = { subject: d?.emailSubject || DEFAULT_EMAIL_SUBJECT_ET, body: d?.emailBody || DEFAULT_EMAIL_BODY_ET }
  const en = { subject: d?.emailSubjectEn || DEFAULT_EMAIL_SUBJECT_EN, body: d?.emailBodyEn || DEFAULT_EMAIL_BODY_EN }
  if (lang === 'en') return en
  if (lang === 'et-en') return { subject: et.subject, body: `${et.body}\n\n---\n\n${en.body}` }
  return et
}

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
              {busy === 'gmail' ? t('common.working') : t('email.gmail')}
            </button>
          )}
          {shareable && (
            <button type="button" className={`btn${hasGmail ? '' : ' btn-primary'}`} onClick={() => void share()} disabled={!pdf || !addressesOk || busy !== null}>
              {t('email.share')}
            </button>
          )}
          <button type="button" className={`btn${hasGmail || shareable ? '' : ' btn-primary'}`} onClick={() => void mailApp()} disabled={!pdf || !addressesOk || busy !== null}>
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
          <strong>{t('email.attachment')}: </strong>
          {pdf ? fileName : pdfError ? t('pdf.failed') + ' ' + pdfError : t('email.preparingPdf')}
        </p>
        <p className="muted small">{hasGmail ? t('email.gmailHint') : t('email.noGmailHint')}</p>
      </div>
    </Dialog>
  )
}
