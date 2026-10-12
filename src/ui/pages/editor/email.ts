import {
  DEFAULT_EMAIL_BODY_EN,
  DEFAULT_EMAIL_BODY_ET,
  DEFAULT_EMAIL_SUBJECT_EN,
  DEFAULT_EMAIL_SUBJECT_ET,
  type Invoice,
  type InvoiceDefaults,
  type InvoiceLanguage,
} from '../../../domain'
import { formatDate as formatDocumentDate } from '../../../pdf/format'
import { formatDate, formatMoney } from '../../format'
import { safeTotals } from '../../util'

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
