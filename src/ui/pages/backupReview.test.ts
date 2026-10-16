import { describe, expect, it } from 'vitest'
import { createDefaultSettings, type BackupFile, type Invoice } from '../../domain'
import { makeT } from '../i18n'
import { backupContents, changesHeading, keepDriveFolder, type PaymentChange } from './backupReview'

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

describe('keepDriveFolder', () => {
  const withSettings = (driveFolder?: { id: string; name: string }) => ({ settings: { ...createDefaultSettings(), driveFolder } }) as unknown as BackupFile
  it('keeps the folder chosen in this browser over the imported one', () => {
    const mine = { id: 'mine-123456', name: 'Minu' }
    expect(keepDriveFolder(withSettings({ id: 'other-123456', name: 'Teine' }), mine).settings?.driveFolder).toEqual(mine)
  })
  it('takes over the backup’s folder when none is chosen here, and leaves backups without settings alone', () => {
    const theirs = { id: 'other-123456', name: 'Teine' }
    expect(keepDriveFolder(withSettings(theirs), undefined).settings?.driveFolder).toEqual(theirs)
    const noSettings = { settings: null } as unknown as BackupFile
    expect(keepDriveFolder(noSettings, { id: 'mine-123456', name: 'Minu' })).toBe(noSettings)
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
