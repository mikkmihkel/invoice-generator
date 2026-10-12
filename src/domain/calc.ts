import type { Invoice, InvoiceTotals } from './types'

/** Round to 2 decimals using half-up (commercial) rounding on cents. */
export function roundMoney(_value: number): number {
  throw new Error('not implemented')
}

/** Compute line, VAT-breakdown and grand totals. VAT is calculated per rate on the rate's taxable sum. */
export function computeTotals(_invoice: Pick<Invoice, 'lines' | 'vatScheme'>): InvoiceTotals {
  throw new Error('not implemented')
}
