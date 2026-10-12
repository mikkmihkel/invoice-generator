import { describe, expect, it } from 'vitest'
import { selectedBankAccounts } from './accounts'

const a = { id: 'a', iban: 'EE382200221020145685' }
const b = { id: 'b', iban: 'EE471000001020145685' }
const seller = { bankAccounts: [a, b] }

describe('selectedBankAccounts', () => {
  it('uses all accounts when nothing is selected', () => {
    expect(selectedBankAccounts({ bankAccountIds: [], seller })).toEqual([a, b])
  })

  it('keeps only the selected accounts, in profile order', () => {
    expect(selectedBankAccounts({ bankAccountIds: ['b'], seller })).toEqual([b])
    expect(selectedBankAccounts({ bankAccountIds: ['b', 'a'], seller })).toEqual([a, b])
  })

  it('falls back to all accounts when the selection is stale', () => {
    expect(selectedBankAccounts({ bankAccountIds: ['gone'], seller })).toEqual([a, b])
  })

  it('selects from an explicit account list (current profile for drafts)', () => {
    expect(selectedBankAccounts({ bankAccountIds: ['a'], seller: { bankAccounts: [] } }, [a, b])).toEqual([a])
  })

  it('tolerates malformed records', () => {
    expect(selectedBankAccounts({ bankAccountIds: undefined as unknown as string[] })).toEqual([])
  })
})
