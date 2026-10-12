import type { BankAccount, Invoice } from './types'

/**
 * Bank accounts printed on the invoice (PDF, e-invoice) and checked by validation.
 * Empty `bankAccountIds` = all accounts. If none of the selected ids exists any more, all accounts are used,
 * so the buyer still sees where to pay (validation warns about the stale selection).
 * `accounts` defaults to the seller snapshot's accounts; pass the current profile's accounts for a draft
 * whose seller has not been snapshotted.
 */
export function selectedBankAccounts(
  invoice: Pick<Invoice, 'bankAccountIds'> & { seller?: Pick<Invoice['seller'], 'bankAccounts'> },
  accounts: BankAccount[] = invoice.seller?.bankAccounts ?? [],
): BankAccount[] {
  const ids = invoice.bankAccountIds ?? []
  if (ids.length === 0) return accounts
  const selected = accounts.filter((a) => ids.includes(a.id))
  return selected.length ? selected : accounts
}
