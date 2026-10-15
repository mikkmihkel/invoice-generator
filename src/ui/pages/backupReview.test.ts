import { describe, expect, it } from 'vitest'
import type { BackupFile, Invoice } from '../../domain'
import { makeT } from '../i18n'
import { backupContents } from './backupReview'

const backup = (types: Invoice['type'][]): BackupFile =>
  ({ exportedAt: '2026-10-15T09:00:00.000Z', invoices: types.map((type, i) => ({ id: String(i), type }) as Invoice), clients: [{}, {}] }) as unknown as BackupFile

describe('backupContents', () => {
  it('counts quotes apart from invoices', () => {
    const et = backupContents(backup(['invoice', 'credit-note', 'quote', 'quote']), makeT('et'))
    expect(et).toMatch(/sisaldab arveid: 2, hinnapakkumisi: 2, kliente: 2\.$/)
    expect(backupContents(backup(['invoice', 'quote']), makeT('en'))).toMatch(/contains 1 invoices, 1 quotes and 2 clients\.$/)
  })
  it('leaves quotes out of the sentence when there are none', () => {
    expect(backupContents(backup(['invoice']), makeT('et'))).toMatch(/sisaldab arveid: 1, kliente: 2\.$/)
  })
})
