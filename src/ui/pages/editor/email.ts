import {
  computeTotals,
  DEFAULT_EMAIL_BODY_EN,
  DEFAULT_EMAIL_BODY_ET,
  DEFAULT_EMAIL_SUBJECT_EN,
  DEFAULT_EMAIL_SUBJECT_ET,
  type Invoice,
  type InvoiceDefaults,
  type InvoiceLanguage,
  type InvoiceType,
} from '../../../domain'
// Directly from the pure module (not the integrations index, which UI tests mock).
import { assertValidEmail, parseAddress } from '../../../integrations/mime'
import { formatDate as formatDocumentDate } from '../../../pdf/format'
import { formatDate, formatMoney, formatNumber } from '../../format'
import { fillTemplate } from '../../util'

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

/** Late interest stated in a payment reminder (see `lateInterest` in src/domain/interest.ts). */
export interface ReminderInterest {
  amount: number
  days: number
  ratePercentPerDay: number
}

/**
 * Template variables; amounts and dates follow the invoice language like the PDF does (`lang` overrides it,
 * e.g. for the English half of a bilingual e-mail). `amount` replaces the invoice total, e.g. with the amount
 * still owed after credit notes in a payment reminder; `interest` fills {interest} {interestRate} {overdueDays}.
 */
export function emailVars(inv: Invoice, companyName: string, opts: { lang?: InvoiceLanguage; amount?: number; interest?: ReminderInterest } = {}): Record<string, string> {
  const lang = opts.lang ?? inv.language
  const en = lang === 'en'
  const vars: Record<string, string> = {
    number: inv.number,
    company: companyName,
    client: inv.buyer.name,
    total: formatMoney(opts.amount ?? computeTotals(inv).gross, inv.currency, lang),
    dueDate: en ? formatDocumentDate(inv.dueDate, 'en') : formatDate(inv.dueDate),
  }
  if (inv.validUntil) vars.validUntil = en ? formatDocumentDate(inv.validUntil, 'en') : formatDate(inv.validUntil)
  if (opts.interest) {
    const rate = formatNumber(opts.interest.ratePercentPerDay)
    vars.interest = formatMoney(opts.interest.amount, inv.currency, lang)
    vars.interestRate = en ? rate.replace(',', '.') : rate
    vars.overdueDays = String(opts.interest.days)
  }
  return vars
}

/** Separates the Estonian and the English body of a bilingual e-mail. */
export const BILINGUAL_SEPARATOR = '\n\n---\n\n'

/**
 * Fill an e-mail template. For bilingual invoices the part after the separator is the English text and gets
 * English amounts and dates ("€1,180.18", "26 Oct 2026"); the rest uses the Estonian formats.
 */
export function fillEmailText(text: string, inv: Invoice, companyName: string, amount?: number, interest?: ReminderInterest): string {
  const fill = (s: string, lang: InvoiceLanguage) => fillTemplate(s, emailVars(inv, companyName, { lang, amount, interest }))
  if (inv.language !== 'et-en') return fill(text, inv.language)
  const i = text.indexOf(BILINGUAL_SEPARATOR)
  if (i < 0) return fill(text, 'et-en')
  return fill(text.slice(0, i), 'et-en') + BILINGUAL_SEPARATOR + fill(text.slice(i + BILINGUAL_SEPARATOR.length), 'en')
}

const QUOTE_ET = {
  subject: 'Hinnapakkumine {number} – {company}',
  body:
    'Tere!\n\n' +
    'Saadame manuses hinnapakkumise nr {number} summas {total}. Pakkumine kehtib kuni {validUntil}.\n\n' +
    'Küsimuste korral vastake julgelt sellele kirjale.\n\n' +
    'Lugupidamisega\n{company}',
}
const QUOTE_EN = {
  subject: 'Quote {number} from {company}',
  body:
    'Hello,\n\n' +
    'Please find attached quote no. {number} for {total}. The offer is valid until {validUntil}.\n\n' +
    'If you have any questions, just reply to this e-mail.\n\n' +
    'Best regards,\n{company}',
}

/**
 * Subject/body templates for the invoice language: Estonian, English, or for bilingual invoices an Estonian
 * subject and the Estonian body followed by the English one. Profiles saved before the English templates
 * existed fall back to the built-in defaults.
 */
export function emailTemplates(lang: InvoiceLanguage, d: Partial<InvoiceDefaults> | undefined, type?: InvoiceType): { subject: string; body: string } {
  if (type === 'quote') {
    if (lang === 'en') return QUOTE_EN
    if (lang === 'et-en') return { subject: QUOTE_ET.subject, body: QUOTE_ET.body + BILINGUAL_SEPARATOR + QUOTE_EN.body }
    return QUOTE_ET
  }
  const et = { subject: d?.emailSubject || DEFAULT_EMAIL_SUBJECT_ET, body: d?.emailBody || DEFAULT_EMAIL_BODY_ET }
  const en = { subject: d?.emailSubjectEn || DEFAULT_EMAIL_SUBJECT_EN, body: d?.emailBodyEn || DEFAULT_EMAIL_BODY_EN }
  if (lang === 'en') return en
  if (lang === 'et-en') return { subject: et.subject, body: et.body + BILINGUAL_SEPARATOR + en.body }
  return et
}

export type EmailKind = 'invoice' | 'reminder'

interface ReminderText {
  subject: string
  /** Body before and after the optional late interest paragraph. */
  intro: string
  outro: string
  interest: string
}

const REMINDER_ET: ReminderText = {
  subject: 'Meeldetuletus: arve {number} on tasumata',
  intro:
    'Tere!\n\n' +
    'Tuletame meelde, et arve nr {number} summas {total} maksetähtaeg oli {dueDate}, kuid makset ei ole meile veel laekunud. ' +
    'Palume arve tasuda esimesel võimalusel. Arve on uuesti manuses ja makseandmed leiate arvelt.',
  interest: 'Arvel kokku lepitud viivis on {interestRate}% päevas. Makse on hilinenud {overdueDays} päeva ja tänaseks on viivist kogunenud {interest}.',
  outro: 'Kui olete arve vahepeal juba tasunud, võite selle kirja tähelepanuta jätta.\n\nLugupidamisega\n{company}',
}
const REMINDER_EN: ReminderText = {
  subject: 'Reminder: invoice {number} is unpaid',
  intro:
    'Hello,\n\n' +
    'This is a friendly reminder that invoice no. {number} for {total} was due on {dueDate} and we have not received the payment yet. ' +
    'The invoice is attached again.',
  interest: 'The late payment interest agreed on the invoice is {interestRate}% per day. Days overdue: {overdueDays}; interest accrued to date: {interest}.',
  outro: 'If you have already paid it, please ignore this message.\n\nBest regards,\n{company}',
}
const SECOND_ET: ReminderText = {
  subject: 'Teine meeldetuletus: arve {number} on endiselt tasumata',
  intro:
    'Tere!\n\n' +
    'Saatsime Teile varem meeldetuletuse, kuid arve nr {number} summas {total} on endiselt tasumata. Maksetähtaeg oli {dueDate}.\n\n' +
    'Palume arve tasuda 7 päeva jooksul. Kui makset selleks ajaks ei laeku, oleme sunnitud alustama võla sissenõudmist.',
  interest: REMINDER_ET.interest,
  outro: 'Kui olete arve vahepeal tasunud, saatke meile palun maksekorralduse koopia.\n\nLugupidamisega\n{company}',
}
const SECOND_EN: ReminderText = {
  subject: 'Second reminder: invoice {number} is still unpaid',
  intro:
    'Hello,\n\n' +
    'We sent you a reminder earlier, but invoice no. {number} for {total} is still unpaid. It was due on {dueDate}.\n\n' +
    'Please pay the invoice within 7 days. If we do not receive the payment by then, we will have to start debt collection.',
  interest: REMINDER_EN.interest,
  outro: 'If you have paid in the meantime, please send us a copy of the payment order.\n\nBest regards,\n{company}',
}

export interface ReminderOptions {
  /** Firmer text for the second and later reminders. */
  second?: boolean
  /** Add the late interest paragraph ({interest} {interestRate} {overdueDays}). */
  interest?: boolean
}

function reminderBody(t: ReminderText, interest: boolean): string {
  return [t.intro, interest ? t.interest : '', t.outro].filter(Boolean).join('\n\n')
}

/** Payment reminder for an overdue invoice, in the invoice language (bilingual: Estonian subject, both bodies). */
export function reminderTemplates(lang: InvoiceLanguage, opts: ReminderOptions = {}): { subject: string; body: string } {
  const et = opts.second ? SECOND_ET : REMINDER_ET
  const en = opts.second ? SECOND_EN : REMINDER_EN
  const interest = !!opts.interest
  if (lang === 'en') return { subject: en.subject, body: reminderBody(en, interest) }
  if (lang === 'et-en') return { subject: et.subject, body: reminderBody(et, interest) + BILINGUAL_SEPARATOR + reminderBody(en, interest) }
  return { subject: et.subject, body: reminderBody(et, interest) }
}
