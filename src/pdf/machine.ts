// Machine-readable layer of the invoice PDF: document metadata, the embedded UBL e-invoice and the
// EPC "SEPA Credit Transfer" QR payload. Templates only need `paymentQrPayload(invoice)`; render.ts applies
// `withMachineLayer` to every document definition so templates never deal with metadata or attachments.
import type { TDocumentDefinitions, TDocumentInformation } from 'pdfmake/interfaces'
import { computeTotals, isValidIban, normalizeIban, selectedBankAccounts } from '../domain'
import type { Invoice, InvoiceLanguage } from '../domain/types'
import { buildUblXml } from '../einvoice/ubl'
import { formatAmount, formatDate } from './format'
import { invoiceFileName } from './fileName'

/** Value of the PDF `Creator` entry. */
export const PDF_CREATOR = 'Arvegeneraator'

// ---------------------------------------------------------------------------------------------------------
// EPC069-12 QR code ("GiroCode" / "SEPA QR")
// ---------------------------------------------------------------------------------------------------------

/** Payload limits from EPC069-12 (v3.1, 2022). */
export const EPC_LIMITS = {
  name: 70,
  iban: 34,
  /** Creditor reference (ISO 11649 RF…) */
  structuredReference: 35,
  unstructuredRemittance: 140,
  /** Whole payload in bytes (UTF-8). */
  payloadBytes: 331,
  minAmount: 0.01,
  maxAmount: 999_999_999.99,
} as const

const BIC_RE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/

/** ISO 11649 creditor reference ("RF18 5390 0754 7034"): RF + 2 check digits + 1–21 alphanumerics, mod-97 = 1. */
export function isRfCreditorReference(ref: string | undefined): boolean {
  const r = (ref ?? '').replace(/\s+/g, '').toUpperCase()
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(r)) return false
  const rearranged = r.slice(4) + r.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const n = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of n) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length

/** Cut to at most `max` characters (code points, so no broken surrogate pairs). */
function cut(s: string, max: number): string {
  const chars = Array.from(s)
  return chars.length <= max ? s : chars.slice(0, max).join('')
}

/** EPC field text: single line, no control characters, trimmed. */
function clean(s: string | undefined): string {
  return (s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

const isEnglish = (lang: InvoiceLanguage) => lang === 'en'

/** Payment remittance text, e.g. "Arve 2026-0007, viitenumber 202600075" / "Invoice 2026-0007, reference 202600075". */
export function remittanceText(invoice: Invoice): string {
  const en = isEnglish(invoice.language)
  const number = clean(invoice.number)
  const parts: string[] = []
  if (number) parts.push(`${en ? 'Invoice' : 'Arve'} ${number}`)
  const ref = clean(invoice.referenceNumber).replace(/\s+/g, '')
  if (ref && !isRfCreditorReference(ref)) parts.push(`${en ? 'reference' : 'viitenumber'} ${ref}`)
  return parts.join(', ')
}

/**
 * EPC069-12 "SEPA Credit Transfer" QR payload (version 002, UTF-8), lines joined with "\n":
 *
 *     BCD / 002 / 1 / SCT / <BIC or empty> / <name ≤70> / <IBAN> / EUR<amount> / <purpose: empty> /
 *     <RF creditor reference or empty> / <remittance text ≤140>
 *
 * The optional last element (beneficiary-to-originator information) is omitted; nothing follows the
 * remittance line. Exactly one of structured reference (only for ISO 11649 `RF…` references) or
 * unstructured remittance is filled. The Estonian national reference number (viitenumber) has no field of
 * its own in the EPC format, so it goes into the remittance text, after the invoice number.
 *
 * Returns null when a SEPA credit transfer QR would be wrong or useless: non-EUR currency, credit notes,
 * cancelled invoices, total ≤ 0 or > 999 999 999,99, or no valid IBAN among the invoice's bank accounts
 * (the first selected account with a valid IBAN is used, i.e. the first one printed).
 */
export function epcQrPayload(invoice: Invoice): string | null {
  if ((invoice.currency || 'EUR').toUpperCase() !== 'EUR') return null
  if (invoice.type === 'credit-note' || invoice.status === 'cancelled') return null
  const total = computeTotals(invoice).gross
  if (!(total >= EPC_LIMITS.minAmount && total <= EPC_LIMITS.maxAmount)) return null
  const account = selectedBankAccounts(invoice).find((a) => isValidIban(a.iban ?? ''))
  if (!account) return null
  const iban = normalizeIban(account.iban)
  if (iban.length > EPC_LIMITS.iban) return null
  const name = cut(clean(invoice.seller.name), EPC_LIMITS.name)
  if (!name) return null
  const bicRaw = (account.bic ?? '').replace(/\s+/g, '').toUpperCase()
  const bic = BIC_RE.test(bicRaw) ? bicRaw : ''

  const ref = (invoice.referenceNumber ?? '').replace(/\s+/g, '').toUpperCase()
  const structured = isRfCreditorReference(ref) ? ref : ''
  let remittance = structured ? '' : cut(remittanceText(invoice), EPC_LIMITS.unstructuredRemittance)

  const build = () =>
    ['BCD', '002', '1', 'SCT', bic, name, iban, `EUR${total.toFixed(2)}`, '', structured, remittance]
      // Trailing empty elements may be left out; keep the payload as short as possible for a sparser QR.
      .join('\n')
      .replace(/\n+$/, '')
  let payload = build()
  // Multi-byte letters (õ ä ö ü š ž) can push a maximal payload over 331 bytes: shorten the free text.
  while (utf8Length(payload) > EPC_LIMITS.payloadBytes && remittance) {
    remittance = Array.from(remittance).slice(0, -1).join('').trimEnd()
    payload = build()
  }
  return utf8Length(payload) <= EPC_LIMITS.payloadBytes ? payload : null
}

/** Whether the invoice asks for a payment QR code (opt-in per invoice; default off). */
export function paymentQrEnabled(invoice: Pick<Invoice, 'paymentQr'>): boolean {
  return invoice.paymentQr === true
}

/**
 * What a template should render as the payment QR: the EPC payload when the invoice opted in and a
 * payment QR makes sense, otherwise null (render no QR block at all). Use pdfmake `{ qr: payload, eccLevel: 'M' }`.
 */
export function paymentQrPayload(invoice: Invoice): string | null {
  return paymentQrEnabled(invoice) ? epcQrPayload(invoice) : null
}

// ---------------------------------------------------------------------------------------------------------
// Document metadata
// ---------------------------------------------------------------------------------------------------------

const TITLE = {
  invoice: { et: 'Arve', en: 'Invoice' },
  'credit-note': { et: 'Kreeditarve', en: 'Credit note' },
  prepayment: { et: 'Ettemaksuarve', en: 'Prepayment invoice' },
} as const

/** Information dictionary plus custom keys (pdfmake writes any extra `info` key as a custom PDF Info entry). */
export type PdfInfo = TDocumentInformation & Record<string, string | Date | undefined>

/** BCP 47 tag for the PDF `/Lang` entry; bilingual documents are primarily Estonian. */
export function pdfLanguage(lang: InvoiceLanguage): 'et-EE' | 'en-GB' {
  return lang === 'en' ? 'en-GB' : 'et-EE'
}

const plainSpaces = (s: string) => s.replace(/[  ]/g, ' ')

/** Machine-friendly facts shared by the keywords and the custom Info entries. */
export function invoiceFacts(invoice: Invoice): Record<string, string> {
  const totals = computeTotals(invoice)
  const facts: Record<string, string | undefined> = {
    InvoiceNumber: invoice.number || undefined,
    InvoiceType: invoice.type,
    IssueDate: invoice.issueDate || undefined,
    DueDate: invoice.type === 'credit-note' ? undefined : invoice.dueDate || undefined,
    SellerName: invoice.seller.name || undefined,
    SellerRegistryCode: invoice.seller.registryCode?.trim() || undefined,
    SellerVatNumber: invoice.seller.vatNumber?.replace(/\s+/g, '').toUpperCase() || undefined,
    BuyerName: invoice.buyer.name || undefined,
    BuyerRegistryCode: invoice.buyer.registryCode?.trim() || undefined,
    BuyerVatNumber: invoice.buyer.vatNumber?.replace(/\s+/g, '').toUpperCase() || undefined,
    NetAmount: totals.net.toFixed(2),
    VatAmount: totals.vat.toFixed(2),
    TotalAmount: totals.gross.toFixed(2),
    Currency: (invoice.currency || 'EUR').toUpperCase(),
    ReferenceNumber: invoice.referenceNumber?.replace(/\s+/g, '') || undefined,
    Iban: selectedBankAccounts(invoice).map((a) => normalizeIban(a.iban)).filter(Boolean).join(' ') || undefined,
  }
  return Object.fromEntries(Object.entries(facts).filter((e): e is [string, string] => !!e[1]))
}

const KEYWORD_KEYS: [string, string][] = [
  ['InvoiceNumber', 'invoice'],
  ['IssueDate', 'issued'],
  ['DueDate', 'due'],
  ['SellerRegistryCode', 'seller'],
  ['SellerVatNumber', 'sellerVat'],
  ['BuyerRegistryCode', 'buyer'],
  ['BuyerVatNumber', 'buyerVat'],
  ['TotalAmount', 'total'],
  ['Currency', 'currency'],
  ['ReferenceNumber', 'reference'],
]

/**
 * PDF Info dictionary: Title "Arve 2026-0007", Author = seller, Subject
 * "Arve 2026-0007, Kalda Puutöö OÜ, 2 083,20 EUR, tasuda 28.10.2026", Keywords as `key:value` pairs
 * separated by "; " (ISO dates, amount with a dot), plus custom entries (InvoiceNumber, TotalAmount, …).
 */
export function pdfMetadata(invoice: Invoice): PdfInfo {
  const lang = invoice.language === 'en' || invoice.language === 'et-en' ? invoice.language : 'et'
  const words = TITLE[invoice.type] ?? TITLE.invoice
  const kind = lang === 'et' ? words.et : lang === 'en' ? words.en : `${words.et} / ${words.en}`
  const draft = lang === 'en' ? 'draft' : 'mustand'
  const title = invoice.number ? `${kind} ${invoice.number}` : `${kind} (${draft})`
  const facts = invoiceFacts(invoice)
  const total = computeTotals(invoice).gross
  const currency = facts.Currency
  const amountText = plainSpaces(`${formatAmount(total, lang)} ${currency}`)
  const subject = [title, invoice.seller.name, amountText]
  if (invoice.type !== 'credit-note' && invoice.dueDate) {
    const dueWord = lang === 'en' ? 'due' : 'tasuda'
    subject.push(`${dueWord} ${formatDate(invoice.dueDate, lang)}`)
  }
  const keywords = KEYWORD_KEYS.filter(([k]) => facts[k]).map(([k, key]) => `${key}:${facts[k]}`)
  return {
    title,
    author: invoice.seller.name || undefined,
    subject: subject.filter(Boolean).join(', '),
    keywords: keywords.join('; '),
    creator: PDF_CREATOR,
    ...facts,
  }
}

// ---------------------------------------------------------------------------------------------------------
// Embedded e-invoice + metadata on the document definition
// ---------------------------------------------------------------------------------------------------------

/** Key of the embedded UBL file in the doc definition's `files`. */
export const EINVOICE_FILE_KEY = 'einvoice'

/** Name of the embedded XML, e.g. "Arve_2026-0007.xml" / "Invoice_2026-0007.xml". */
export function embeddedXmlFileName(invoice: Invoice): string {
  // Same prefix as the downloadable files, without the buyer part (the attachment lives inside the PDF).
  const full = invoiceFileName({ ...invoice, buyer: { ...invoice.buyer, name: '' } }, 'xml')
  return full
}

/** Whether the PDF gets the embedded e-invoice: only real (numbered, non-draft) documents. */
export function embedsEInvoice(invoice: Invoice): boolean {
  return invoice.status !== 'draft' && !!invoice.number?.trim()
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

type DocDefinition = TDocumentDefinitions & { language?: string }

/**
 * Add the machine layer to a finished document definition (pure: returns a new object):
 * PDF Info metadata, `/Lang`, and — for issued documents — the UBL 2.1 / Peppol BIS 3 XML as an embedded
 * file (AFRelationship /Alternative, MIME application/xml). The XML is built without the PDF to avoid recursion.
 */
export function withMachineLayer(def: TDocumentDefinitions, invoice: Invoice, opts: { embedEInvoice?: boolean } = {}): DocDefinition {
  const out: DocDefinition = { ...def, info: pdfMetadata(invoice), language: pdfLanguage(invoice.language) }
  if (opts.embedEInvoice === false || !embedsEInvoice(invoice)) return out
  const lang = invoice.language === 'en' ? 'en' : 'et'
  const description =
    lang === 'en'
      ? `E-invoice ${invoice.number} (UBL 2.1, Peppol BIS Billing 3.0 / EN 16931)`
      : `E-arve ${invoice.number} (UBL 2.1, Peppol BIS Billing 3.0 / EN 16931)`
  const name = embeddedXmlFileName(invoice)
  const stamp = invoice.issuedAt ? new Date(invoice.issuedAt) : undefined
  // pdfmake passes the whole object to PDFKit's `doc.file()`, which also understands type/relationship/dates.
  const file = {
    src: `data:application/xml;base64,${base64Utf8(buildUblXml(invoice))}`,
    name,
    description,
    type: 'application/xml',
    relationship: 'Alternative',
    ...(stamp && !Number.isNaN(stamp.getTime()) ? { creationDate: stamp, modifiedDate: stamp } : {}),
  }
  out.files = { ...def.files, [EINVOICE_FILE_KEY]: file }
  return out
}
