// "Copy payment details": amount, payee, IBAN, reference number, due date and number as plain text for a chat.
import { useCallback } from 'react'
import { outstandingAmount, selectedBankAccounts, type Invoice, type InvoiceLanguage } from '../../../domain'
import { formatDate, formatIban, formatMoney } from '../../../pdf/format'
import { useApp } from '../../AppContext'
import { useToast } from '../../Toasts'

type Label = 'invoice' | 'amount' | 'payee' | 'iban' | 'reference' | 'due'

const LABELS: Record<'et' | 'en', Record<Label, string>> = {
  et: { invoice: 'Arve', amount: 'Summa', payee: 'Saaja', iban: 'IBAN', reference: 'Viitenumber', due: 'Maksetähtaeg' },
  en: { invoice: 'Invoice', amount: 'Amount', payee: 'Payee', iban: 'IBAN', reference: 'Reference number', due: 'Due date' },
}

function label(key: Label, lang: InvoiceLanguage): string {
  if (lang === 'et-en') return LABELS.et[key] === LABELS.en[key] ? LABELS.et[key] : `${LABELS.et[key]} / ${LABELS.en[key]}`
  return LABELS[lang === 'en' ? 'en' : 'et'][key]
}

/** Whether the document is one the client still has to pay (issued invoice or prepayment invoice, not settled). */
export function hasPaymentDetails(inv: Invoice, all: readonly Invoice[]): boolean {
  return (inv.type === 'invoice' || inv.type === 'prepayment') && inv.status === 'issued' && !!inv.number && outstandingAmount(inv, all) > 0
}

/**
 * The payment details as plain text in the invoice language (bilingual labels for a bilingual invoice). `amount`
 * is what is still owed (after credit notes). Spaces are plain, so the text pastes cleanly into any chat.
 */
export function paymentDetailsText(inv: Invoice, amount: number): string {
  const lang = inv.language
  const rows: [Label, string][] = [
    ['invoice', inv.number],
    ['amount', formatMoney(amount, inv.currency || 'EUR', lang)],
    ['payee', inv.seller?.name ?? ''],
    ...selectedBankAccounts(inv).map((a): [Label, string] => ['iban', formatIban(a.iban) + (a.bankName ? ` (${a.bankName})` : '')]),
    ['reference', inv.referenceNumber ?? ''],
    ['due', formatDate(inv.dueDate, lang)],
  ]
  return rows
    .filter(([, value]) => value.trim() !== '')
    .map(([key, value]) => `${label(key, lang)}: ${value}`)
    .join('\n')
    .replace(/[  ]/g, ' ')
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  // Older browsers: a hidden text area and the copy command.
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand?.('copy')
  area.remove()
  if (!ok) throw new Error('copy failed')
}

/** Copies the payment details of an invoice (pass the effective invoice, so drafts use the current profile). */
export function useCopyPaymentDetails() {
  const { t, invoices } = useApp()
  const toast = useToast()
  return useCallback(
    async (inv: Invoice) => {
      try {
        await writeClipboard(paymentDetailsText(inv, outstandingAmount(inv, invoices)))
        toast.success(t('payment.detailsCopied'))
      } catch {
        toast.error(t('payment.detailsCopyFailed'))
      }
    },
    [t, invoices, toast],
  )
}
