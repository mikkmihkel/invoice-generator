// Document labels for invoice PDFs. `et-en` renders "Estonian / English".
import type { InvoiceLanguage } from '../domain/types'
import { formatPercent } from './format'

type Pair = { et: string; en: string }

export const LABELS = {
  invoice: { et: 'Arve', en: 'Invoice' },
  creditNote: { et: 'Kreeditarve', en: 'Credit note' },
  prepayment: { et: 'Ettemaksuarve', en: 'Prepayment invoice' },
  quote: { et: 'Hinnapakkumine', en: 'Quote' },
  number: { et: 'Number', en: 'Number' },
  invoiceNo: { et: 'Arve nr', en: 'Invoice no.' },
  creditNoteNo: { et: 'Kreeditarve nr', en: 'Credit note no.' },
  quoteNo: { et: 'Pakkumise nr', en: 'Quote no.' },
  quoteDate: { et: 'Kuupäev', en: 'Date' },
  validUntil: { et: 'Kehtib kuni', en: 'Valid until' },
  issueDate: { et: 'Arve kuupäev', en: 'Date of issue' },
  dueDate: { et: 'Maksetähtaeg', en: 'Due date' },
  supplyDate: { et: 'Käibe tekkimise kuupäev', en: 'Date of supply' },
  period: { et: 'Periood', en: 'Period' },
  referenceNumber: { et: 'Viitenumber', en: 'Reference no.' },
  orderReference: { et: 'Tellimuse nr', en: 'Order reference' },
  creditedInvoice: { et: 'Krediteeritav arve', en: 'Credited invoice' },
  seller: { et: 'Müüja', en: 'Seller' },
  buyer: { et: 'Ostja', en: 'Buyer' },
  registryCode: { et: 'Registrikood', en: 'Registry code' },
  personalCode: { et: 'Isikukood', en: 'Personal ID code' },
  vatNumber: { et: 'KMKR nr', en: 'VAT no.' },
  contactPerson: { et: 'Kontaktisik', en: 'Contact person' },
  email: { et: 'E-post', en: 'Email' },
  phone: { et: 'Telefon', en: 'Phone' },
  website: { et: 'Veebileht', en: 'Website' },
  bankDetails: { et: 'Makseandmed', en: 'Payment details' },
  bank: { et: 'Pank', en: 'Bank' },
  recipient: { et: 'Saaja', en: 'Recipient' },
  iban: { et: 'IBAN', en: 'IBAN' },
  bic: { et: 'BIC', en: 'BIC' },
  scanToPay: { et: 'Makse QR-kood', en: 'Scan to pay' },
  lineNo: { et: 'Nr', en: 'No.' },
  description: { et: 'Kirjeldus', en: 'Description' },
  quantity: { et: 'Kogus', en: 'Qty' },
  unit: { et: 'Ühik', en: 'Unit' },
  unitPrice: { et: 'Ühikuhind', en: 'Unit price' },
  discount: { et: 'Allahindlus', en: 'Discount' },
  vatRate: { et: 'Käibemaks', en: 'VAT %' },
  lineTotal: { et: 'Summa', en: 'Amount' },
  vatBreakdown: { et: 'Käibemaksu jaotus', en: 'VAT breakdown' },
  /** Rate column of the VAT breakdown: „Käibemaks“ already heads its amount column, and a long header would squeeze the totals beside it. */
  breakdownRate: { et: 'Määr', en: 'VAT %' },
  taxableAmount: { et: 'Maksustatav summa', en: 'Taxable amount' },
  vatAmount: { et: 'Käibemaks', en: 'VAT' },
  netTotal: { et: 'Summa käibemaksuta', en: 'Total excl. VAT' },
  vatTotal: { et: 'Käibemaks kokku', en: 'Total VAT' },
  vatInEur: { et: 'Käibemaks eurodes', en: 'VAT in EUR' },
  total: { et: 'Kokku', en: 'Total' },
  amountDue: { et: 'Tasumisele kuulub', en: 'Amount due' },
  amountCredited: { et: 'Krediteeritav summa', en: 'Amount credited' },
  notes: { et: 'Lisainfo', en: 'Notes' },
  payment: { et: 'Tasumine', en: 'Payment' },
  lateInterest: { et: 'Viivis', en: 'Late payment interest' },
  page: { et: 'Lk', en: 'Page' },
  draft: { et: 'MUSTAND', en: 'DRAFT' },
  cancelled: { et: 'TÜHISTATUD', en: 'CANCELLED' },
  notVatRegistered: { et: 'Müüja ei ole käibemaksukohustuslane.', en: 'The seller is not registered for VAT.' },
} satisfies Record<string, Pair>

export type LabelKey = keyof typeof LABELS

export interface Translator {
  /** Single-line label; bilingual → "Arve / Invoice". */
  (key: LabelKey): string
  /** Label parts: `[primary, secondary?]` — secondary is the English part for bilingual documents. */
  parts(key: LabelKey): [string, string?]
  /** Pick from an arbitrary et/en pair using the same rules. */
  pick(pair: Pair): string
  lang: InvoiceLanguage
}

export function translator(lang: InvoiceLanguage): Translator {
  const pick = (pair: Pair) => (lang === 'et' ? pair.et : lang === 'en' ? pair.en : pair.et === pair.en ? pair.et : `${pair.et} / ${pair.en}`)
  const t = ((key: LabelKey) => pick(LABELS[key])) as Translator
  t.parts = (key) => {
    const p = LABELS[key]
    if (lang === 'et') return [p.et]
    if (lang === 'en') return [p.en]
    return p.et === p.en ? [p.et] : [p.et, p.en]
  }
  t.pick = pick
  t.lang = lang
  return t
}

/** Sentence-like texts with values. */
export function lateInterestText(percentPerDay: number, lang: InvoiceLanguage): string {
  // Each language half uses its own decimal separator ("0,05%" / "0.05%"), also on bilingual documents.
  const et = `Tähtaegselt tasumata arve korral arvestatakse viivist ${formatPercent(percentPerDay, 'et')} päevas.`
  const en = `Late payment interest of ${formatPercent(percentPerDay, 'en')} per day is charged on overdue amounts.`
  return lang === 'et' ? et : lang === 'en' ? en : `${et}\n${en}`
}

export function referenceHint(ref: string, lang: InvoiceLanguage): string {
  const et = `Palume maksmisel märkida viitenumbri ${ref}.`
  const en = `Please use reference number ${ref} when paying.`
  return lang === 'et' ? et : lang === 'en' ? en : `${et} / ${en}`
}

export function creditNoteText(invoiceNumber: string, lang: InvoiceLanguage): string {
  const et = `Kreeditarve arvele nr ${invoiceNumber}`
  const en = `Credit note for invoice no. ${invoiceNumber}`
  return lang === 'et' ? et : lang === 'en' ? en : `${et} / ${en}`
}
