import { describe, expect, it } from 'vitest'
import { createDefaultSettings, type AppSettings, type BackupFile, type Invoice } from '../../domain'
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
  const OWN = '222-own.apps.googleusercontent.com'
  const OTHER = '333-other.apps.googleusercontent.com'
  const mine = { id: 'mine-123456', name: 'Minu', clientId: OWN }
  const here = (patch: Partial<AppSettings> = {}): AppSettings => ({ ...createDefaultSettings(), googleClientId: OWN, ...patch })
  const backup = (patch: Partial<AppSettings>) => ({ settings: here(patch) }) as unknown as BackupFile

  it('keeps the folder chosen in this browser, with this browser’s PDF choice', () => {
    const res = keepDriveFolder(backup({ driveFolder: { id: 'other-123456', name: 'Teine', clientId: OWN }, autoSavePdf: true }), here({ driveFolder: mine, autoSavePdf: false }))
    expect(res.settings).toMatchObject({ driveFolder: mine, autoSavePdf: false })
  })

  it('takes over the backup’s folder of the same client, but leaves automatic PDFs off until chosen here', () => {
    const theirs = { id: 'other-123456', name: 'Teine', clientId: OWN }
    const res = keepDriveFolder(backup({ driveFolder: theirs, autoSavePdf: true }), here())
    expect(res.settings?.driveFolder).toEqual(theirs)
    expect(res.settings?.autoSavePdf).toBe(false)
    // A browser that opted in keeps its choice.
    expect(keepDriveFolder(backup({ driveFolder: theirs }), here({ autoSavePdf: true })).settings?.autoSavePdf).toBe(true)
  })

  it('does not take over a folder chosen with another client (or with none recorded)', () => {
    expect(keepDriveFolder(backup({ driveFolder: { id: 'other-123456', name: 'Teine', clientId: OTHER } }), here()).settings).not.toHaveProperty('driveFolder')
    expect(keepDriveFolder(backup({ driveFolder: { id: 'other-123456', name: 'Teine' } }), here()).settings).not.toHaveProperty('driveFolder')
    // A folder chosen here with another client does not count either.
    expect(keepDriveFolder(backup({}), here({ driveFolder: { ...mine, clientId: OTHER } })).settings).not.toHaveProperty('driveFolder')
  })

  it('leaves backups without settings alone', () => {
    const noSettings = { settings: null } as unknown as BackupFile
    expect(keepDriveFolder(noSettings, here({ driveFolder: mine }))).toBe(noSettings)
  })
})

describe('changesHeading', () => {
  const change = (field: PaymentChange['field']): PaymentChange => ({ field, from: 'a', to: 'b' })
  const t = makeT('et')
  it('warns about payments only when the IBANs change', () => {
    expect(changesHeading([change('name'), change('ibans')], t)).toEqual({
      title: 'Varukoopia muudab makseandmeid',
      intro: 'Kontrolli, et muudatused on õiged – vale IBAN-i korral laekuvad maksed valele pangakontole.',
    })
  })
  it('names a change of company details as such, without the IBAN warning', () => {
    const h = changesHeading([change('name')], t)
    expect(h.title).toBe('Varukoopia muudab ettevõtte andmeid')
    expect(h.intro).not.toMatch(/IBAN/)
    expect(changesHeading([change('googleClientId')], makeT('en')).title).toBe('The backup changes settings')
  })
})
