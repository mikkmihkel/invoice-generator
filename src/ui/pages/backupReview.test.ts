import { describe, expect, it } from 'vitest'
import type { BackupFile, Invoice } from '../../domain'
import { makeT } from '../i18n'
import { backupContents, changesHeading, type PaymentChange } from './backupReview'

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

describe('changesHeading', () => {
  const change = (field: PaymentChange['field']): PaymentChange => ({ field, from: 'a', to: 'b' })
  const t = makeT('et')
  it('warns about payments only when the IBANs change', () => {
    expect(changesHeading([change('name'), change('ibans')], t)).toEqual({
      title: 'Varukoopia muudab makseandmeid',
      intro: 'Kontrolli, et muudatused on õiged – vale IBANi korral laekuvad maksed valele kontole.',
    })
  })
  it('names a change of company details as such, without the IBAN warning', () => {
    const h = changesHeading([change('name')], t)
    expect(h.title).toBe('Varukoopia muudab ettevõtte andmeid')
    expect(h.intro).not.toMatch(/IBAN/)
    expect(changesHeading([change('googleClientId')], makeT('en')).title).toBe('The backup changes settings')
  })
})
