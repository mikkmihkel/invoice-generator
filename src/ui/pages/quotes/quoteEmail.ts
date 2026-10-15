import type { Invoice, InvoiceLanguage } from '../../../domain'
import { formatDate as formatDocumentDate } from '../../../pdf/format'
import { translate } from '../../i18n'
import { BILINGUAL_SEPARATOR } from '../editor/email'
import { formatDate } from '../../format'

/**
 * E-mail templates for sending a quote, in the quote's language (bilingual: Estonian subject, both bodies).
 * The validity date is filled in here; {number} {company} {client} {total} stay as placeholders for the usual
 * e-mail filling (`fillEmailText`).
 */
export function quoteEmailTemplates(quote: Pick<Invoice, 'language' | 'validUntil'>): { subject: string; body: string } {
  const valid = (lang: 'et' | 'en') => (quote.validUntil ? (lang === 'en' ? formatDocumentDate(quote.validUntil, 'en') : formatDate(quote.validUntil)) : '—')
  const pick = (lang: 'et' | 'en') => ({
    subject: translate(lang, 'quote.emailSubject'),
    body: translate(lang, 'quote.emailBody', { validUntil: valid(lang) }),
  })
  const lang: InvoiceLanguage = quote.language
  if (lang === 'en') return pick('en')
  const et = pick('et')
  if (lang === 'et-en') return { subject: et.subject, body: et.body + BILINGUAL_SEPARATOR + pick('en').body }
  return et
}
