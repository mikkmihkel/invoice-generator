import type { Invoice } from '../domain/types'
import { fileNameSegment } from './format'

const PREFIX = {
  et: { invoice: 'Arve', 'credit-note': 'Kreeditarve', prepayment: 'Ettemaksuarve', quote: 'Hinnapakkumine', draft: 'mustand' },
  en: { invoice: 'Invoice', 'credit-note': 'Credit-note', prepayment: 'Prepayment-invoice', quote: 'Quote', draft: 'draft' },
} as const

/** ASCII-safe file name, e.g. "Arve_2026-0007_Klient-OU.pdf"; drafts: "Arve_mustand_2026-10-12_Klient-OU.pdf". */
export function invoiceFileName(invoice: Invoice, ext: 'pdf' | 'xml' = 'pdf'): string {
  const words = invoice.language === 'en' ? PREFIX.en : PREFIX.et
  const type = invoice.type in words ? invoice.type : 'invoice'
  const parts: string[] = [words[type]]
  const number = fileNameSegment(invoice.number ?? '', 40)
  if (number) parts.push(number)
  else parts.push(words.draft, fileNameSegment(invoice.issueDate ?? '', 10))
  const buyer = fileNameSegment(invoice.buyer?.name ?? '', 40)
  if (buyer) parts.push(buyer)
  return `${parts.filter(Boolean).join('_')}.${ext}`
}
