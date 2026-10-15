import {
  computeTotals,
  DEFAULT_EMAIL_BODY_EN,
  DEFAULT_EMAIL_BODY_ET,
  DEFAULT_EMAIL_SUBJECT_EN,
  DEFAULT_EMAIL_SUBJECT_ET,
  type Invoice,
  type InvoiceDefaults,
  type InvoiceLanguage,
} from '../../../domain'
// Directly from the pure module (not the integrations index, which UI tests mock).
import { assertValidEmail, parseAddress } from '../../../integrations/mime'
import { formatDate as formatDocumentDate } from '../../../pdf/format'
import { formatDate, formatMoney } from '../../format'

export interface Recipient {
  /** As typed, e.g. "Jaan Tamm <jaan@firma.ee>" or "jaan@firma.ee". */
  display: string
  address: string
}

/** Same rules as the MIME builder used for sending (ASCII addr-spec), plus a dotted domain. */
function isValidRecipient(email: string): boolean {
  try {
    assertValidEmail(email)
  } catch {
    return false
  }
  return email.slice(email.lastIndexOf('@') + 1).includes('.')
}

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
    let parsed: { name: string; email: string }
    try {
      parsed = parseAddress(display)
    } catch {
      invalid.push(display)
      continue
    }
    if (isValidRecipient(parsed.email)) valid.push({ display: parsed.name ? display : parsed.email, address: parsed.email })
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
    total: formatMoney(computeTotals(inv).gross, inv.currency, inv.language),
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

export type EmailKind = 'invoice' | 'reminder'

const REMINDER_ET = {
  subject: 'Meeldetuletus: arve {number} on tasumata',
  body:
    'Tere!\n\n' +
    'Tuletame meelde, et arve nr {number} summas {total} maksetähtaeg oli {dueDate} ja meile ei ole makset veel laekunud. ' +
    'Arve on uuesti manuses. Kui olete arve juba tasunud, pole selle kirjaga vaja midagi teha.\n\n' +
    'Lugupidamisega\n{company}',
}
const REMINDER_EN = {
  subject: 'Reminder: invoice {number} is unpaid',
  body:
    'Hello,\n\n' +
    'This is a friendly reminder that invoice no. {number} for {total} was due on {dueDate} and we have not received the payment yet. ' +
    'The invoice is attached again. If you have already paid it, please ignore this message.\n\n' +
    'Best regards,\n{company}',
}

/** Payment reminder for an overdue invoice, in the invoice language (bilingual: Estonian subject, both bodies). */
export function reminderTemplates(lang: InvoiceLanguage): { subject: string; body: string } {
  if (lang === 'en') return REMINDER_EN
  if (lang === 'et-en') return { subject: REMINDER_ET.subject, body: `${REMINDER_ET.body}\n\n---\n\n${REMINDER_EN.body}` }
  return REMINDER_ET
}
