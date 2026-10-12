import type { Invoice, ValidationIssue } from './types'

/** Check an invoice against Estonian legal requirements (KMS § 37, RPS § 7) and sanity rules. */
export function validateInvoice(_invoice: Invoice): ValidationIssue[] {
  throw new Error('not implemented')
}

/** True when there are no 'error' severity issues. */
export function canIssue(_invoice: Invoice): boolean {
  throw new Error('not implemented')
}
