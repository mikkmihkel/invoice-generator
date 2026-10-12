// OWNER: documents agent. Machine-readable e-invoice export (EN 16931 / Peppol BIS Billing 3.0 UBL 2.1).
import type { Invoice } from '../domain/types'

/** Build UBL 2.1 Invoice (or CreditNote) XML compliant with Peppol BIS Billing 3.0 / EN 16931. */
export function buildUblXml(_invoice: Invoice): string {
  throw new Error('not implemented')
}
