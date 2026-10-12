import { vatSchemeAllowsRates } from './law'
import type { Invoice, VatScheme } from './types'

/**
 * Switch an invoice to another VAT scheme, keeping line VAT rates consistent with it:
 * schemes without Estonian VAT get 0 on every line (so nothing prints "24%" on a reverse-charge invoice),
 * and switching back to domestic restores the default rate on lines that were zeroed.
 * The VAT note (`vatExemptionNote`) is scheme-specific, so it is dropped on a scheme change: otherwise an old
 * exemption reference would replace the statutory wording of the new scheme on the printed invoice.
 */
export function withVatScheme<T extends Pick<Invoice, 'lines' | 'vatScheme' | 'vatExemptionNote'>>(invoice: T, scheme: VatScheme, defaultVatRate: number): T {
  const allowsRates = vatSchemeAllowsRates(scheme)
  const hadRates = vatSchemeAllowsRates(invoice.vatScheme)
  const lines = invoice.lines.map((l) => {
    if (!allowsRates) return l.vatRate === 0 ? l : { ...l, vatRate: 0 }
    if (!hadRates && l.vatRate === 0) return { ...l, vatRate: defaultVatRate }
    return l
  })
  if (scheme === invoice.vatScheme) return { ...invoice, lines }
  return { ...invoice, vatScheme: scheme, lines, vatExemptionNote: undefined }
}
