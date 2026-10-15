import { describe, expect, it } from 'vitest'
import { BACKUP_LIMITS, BackupFormatError, parseBackup, validateBackup } from './backup'
import { makeClient, makeInvoice, makeProfile } from './testFixtures'

const base = () => ({
  app: 'invoice-generator',
  version: 1,
  exportedAt: '2026-06-01T00:00:00.000Z',
  profile: makeProfile() as unknown,
  settings: null as unknown,
  clients: [makeClient('c1')] as unknown[],
  invoices: [makeInvoice('i1'), makeInvoice('i2', { number: '2026-0002', status: 'issued' })] as unknown[],
})

function errorOf(data: unknown): BackupFormatError {
  try {
    validateBackup(data)
  } catch (e) {
    expect(e).toBeInstanceOf(BackupFormatError)
    return e as BackupFormatError
  }
  throw new Error('expected validateBackup to throw')
}

/** Replace invoice #3 (index 2) with a broken copy. */
function withInvoice(patch: (inv: Record<string, unknown>) => void) {
  const data = base()
  const inv = structuredClone(makeInvoice('i3', { number: '2026-0003', status: 'issued' })) as unknown as Record<string, unknown>
  patch(inv)
  data.invoices.push(inv)
  return data
}

describe('validateBackup', () => {
  it('accepts a well-formed backup', () => {
    const data = base()
    expect(validateBackup(data).invoices).toHaveLength(2)
    expect(validateBackup({ ...data, profile: undefined, settings: { uiLanguage: 'en', driveFolderName: 'x', registryLiveLookup: false, updatedAt: '' } }).profile).toBeNull()
  })

  it('accepts optional text rows before/after the lines as lists of strings, on invoices and profile defaults', () => {
    const ok = withInvoice((i) => {
      i.textBefore = ['Vastavalt lepingule nr 12/2026', '']
      i.textAfter = ['Täname!\nTeine rida']
    })
    const profile = makeProfile()
    ok.profile = { ...profile, defaults: { ...profile.defaults, textBefore: ['a'], textAfter: [] } }
    expect(validateBackup(ok).invoices[2].textBefore).toEqual(['Vastavalt lepingule nr 12/2026', ''])
    expect(errorOf(withInvoice((i) => (i.textBefore = 'x'))).messages.en).toMatch(/invalid text before the invoice lines/)
    expect(errorOf(withInvoice((i) => (i.textAfter = ['ok', 3]))).messages.et).toMatch(/vigane tekst pärast arveridu/)
    expect(errorOf(withInvoice((i) => (i.textAfter = Array.from({ length: BACKUP_LIMITS.textRows + 1 }, () => 'x')))).messages.en).toMatch(/too many entries/)
    expect(errorOf(withInvoice((i) => (i.textBefore = ['x'.repeat(BACKUP_LIMITS.stringLength + 1)]))).messages.en).toMatch(/too long \(invoices\.2\.textBefore\.0\)/)
    const bad = base()
    bad.profile = { ...profile, defaults: { ...profile.defaults, textAfter: [{}] } }
    expect(errorOf(bad).messages.en).toMatch(/invalid default text after the invoice lines/)
  })

  it('names the record and the field in natural bilingual messages', () => {
    const err = errorOf(withInvoice((i) => delete i.issueDate))
    expect(err.messages.et).toBe('Varukoopia arve nr 3 (2026-0003) on vigane: puudub arve kuupäev.')
    expect(err.messages.en).toBe('Backup invoice #3 (2026-0003) is invalid: missing issue date.')
    expect(err.message).toBe(err.messages.en)
  })

  it.each([
    ['id', (i: Record<string, unknown>) => (i.id = 7), /invalid id/],
    ['number', (i: Record<string, unknown>) => (i.number = null), /missing invoice number/],
    ['type', (i: Record<string, unknown>) => (i.type = 'gift'), /invalid invoice type/],
    ['status', (i: Record<string, unknown>) => (i.status = 'weird'), /invalid status/],
    ['issueDate', (i: Record<string, unknown>) => (i.issueDate = '2026-02-30'), /invalid issue date/],
    ['dueDate', (i: Record<string, unknown>) => (i.dueDate = '24.03.2026'), /invalid due date/],
    ['currency', (i: Record<string, unknown>) => (i.currency = ''), /missing currency/],
    ['language', (i: Record<string, unknown>) => (i.language = 'fi'), /invalid invoice language/],
    ['templateId', (i: Record<string, unknown>) => delete i.templateId, /missing template/],
    ['vatScheme', (i: Record<string, unknown>) => (i.vatScheme = 'magic'), /invalid VAT scheme/],
    ['seller', (i: Record<string, unknown>) => (i.seller = 'x'), /invalid seller details/],
    ['seller.name', (i: Record<string, unknown>) => delete (i.seller as Record<string, unknown>).name, /missing seller name/],
    ['seller.address', (i: Record<string, unknown>) => ((i.seller as Record<string, unknown>).address = []), /invalid seller address/],
    ['seller.bankAccounts', (i: Record<string, unknown>) => delete (i.seller as Record<string, unknown>).bankAccounts, /missing seller bank accounts/],
    ['buyer', (i: Record<string, unknown>) => delete i.buyer, /missing buyer details/],
    ['buyer.address', (i: Record<string, unknown>) => delete (i.buyer as Record<string, unknown>).address, /missing buyer address/],
    ['buyer.address.city', (i: Record<string, unknown>) => (((i.buyer as Record<string, unknown>).address as Record<string, unknown>).city = 5), /invalid buyer address \(city\)/],
    ['lines', (i: Record<string, unknown>) => (i.lines = {}), /invalid invoice lines/],
    ['line', (i: Record<string, unknown>) => (i.lines = [null]), /invalid invoice line 1/],
    ['line.quantity', (i: Record<string, unknown>) => ((i.lines as Record<string, unknown>[])[0].quantity = '2'), /invalid quantity on line 1/],
    ['line.unitPrice', (i: Record<string, unknown>) => ((i.lines as Record<string, unknown>[])[0].unitPrice = Infinity), /invalid unit price on line 1/],
    ['line.vatRate', (i: Record<string, unknown>) => delete (i.lines as Record<string, unknown>[])[0].vatRate, /missing VAT rate on line 1/],
    ['line.description', (i: Record<string, unknown>) => ((i.lines as Record<string, unknown>[])[0].description = 1), /invalid description on line 1/],
    ['bankAccountIds', (i: Record<string, unknown>) => delete i.bankAccountIds, /missing selected bank accounts/],
    ['bankAccountIds items', (i: Record<string, unknown>) => (i.bankAccountIds = [1]), /invalid selected bank accounts/],
    ['updatedAt', (i: Record<string, unknown>) => delete i.updatedAt, /missing modification time/],
  ])('rejects an invoice with a bad %s', (_name, patch, message) => {
    const err = errorOf(withInvoice(patch))
    // the number is shown when it is readable
    expect(err.message).toMatch(/^Backup invoice #3( \(2026-0003\))? is invalid: /)
    expect(err.message).toMatch(message)
    expect(err.messages.et).toMatch(/^Varukoopia arve nr 3( \(2026-0003\))? on vigane: (puudub|vigane) /)
  })

  it('reports Estonian line-level problems naturally', () => {
    const err = errorOf(withInvoice((i) => ((i.lines as Record<string, unknown>[])[0].quantity = 'kaks')))
    expect(err.messages.et).toBe('Varukoopia arve nr 3 (2026-0003) on vigane: vigane 1. rea kogus.')
  })

  it('allows an empty number on drafts and optional fields to be absent', () => {
    const data = base()
    const draft = makeInvoice('d', { number: '' }) as unknown as Record<string, unknown>
    delete draft.accentColor
    data.invoices.push(draft)
    expect(() => validateBackup(data)).not.toThrow()
  })

  it('rejects duplicate ids', () => {
    const data = base()
    data.invoices.push(makeInvoice('i1'))
    expect(errorOf(data).message).toMatch(/duplicate id i1/)
  })

  it('validates clients', () => {
    const cases: [(c: Record<string, unknown>) => void, RegExp][] = [
      [(c) => delete c.name, /missing name/],
      [(c) => (c.kind = 'robot'), /invalid client kind/],
      [(c) => delete c.address, /missing address/],
      [(c) => (c.id = ''), /missing id/],
    ]
    for (const [patch, message] of cases) {
      const data = base()
      const client = structuredClone(makeClient('c2')) as unknown as Record<string, unknown>
      patch(client)
      data.clients.push(client)
      const err = errorOf(data)
      expect(err.message).toMatch(/^Backup client #2 is invalid: /)
      expect(err.message).toMatch(message)
      expect(err.messages.et).toMatch(/^Varukoopia klient nr 2 on vigane: /)
    }
  })

  it('validates the profile', () => {
    const cases: [(p: Record<string, unknown>) => void, RegExp][] = [
      [(p) => delete p.name, /missing name/],
      [(p) => (p.address = null), /missing address/],
      [(p) => (p.bankAccounts = 'EE38'), /invalid bank accounts/],
      [(p) => (p.bankAccounts = [{ id: 'a' }]), /missing bank accounts \(account 1\) IBAN/],
      [(p) => delete p.defaults, /missing invoice defaults/],
      [(p) => delete p.numbering, /missing invoice numbering/],
      [(p) => ((p.numbering as Record<string, unknown>).nextNumber = '7'), /invalid next invoice number/],
      [(p) => ((p.numbering as Record<string, unknown>).padding = NaN), /invalid number padding/],
    ]
    for (const [patch, message] of cases) {
      const profile = structuredClone(makeProfile()) as unknown as Record<string, unknown>
      patch(profile)
      const err = errorOf({ ...base(), profile })
      expect(err.message).toMatch(/^The company profile in the backup is invalid: /)
      expect(err.message).toMatch(message)
      expect(err.messages.et).toMatch(/^Varukoopias olevad ettevõtte andmed on vigased: /)
    }
    expect(errorOf({ ...base(), profile: 'x' }).message).toMatch(/profile/)
  })

  it('validates settings', () => {
    expect(errorOf({ ...base(), settings: { uiLanguage: 'de' } }).message).toMatch(/settings .* invalid: invalid interface language/)
    expect(errorOf({ ...base(), settings: [] }).message).toMatch(/settings/)
  })

  it.each(['__proto__', 'constructor', 'prototype'])('rejects the prototype-pollution key %s anywhere', (key) => {
    const text = JSON.stringify(base()).replace('"street":"Pikk 1"', `"street":"Pikk 1","${key}":{"polluted":true}`)
    expect(text).toContain(key)
    let err: unknown
    try {
      parseBackup(text)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(BackupFormatError)
    expect((err as BackupFormatError).message).toContain(`"${key}"`)
    expect((err as BackupFormatError).message).toMatch(/clients\.0\.address/)
    expect((err as BackupFormatError).messages.et).toContain(`„${key}“`)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects a top-level __proto__ key from JSON', () => {
    const text = JSON.stringify(base()).replace(/^\{/, '{"__proto__":{"x":1},')
    expect(() => parseBackup(text)).toThrow(/__proto__/)
  })

  it('caps sizes', () => {
    const big = 'x'.repeat(BACKUP_LIMITS.stringLength + 1)
    expect(errorOf(withInvoice((i) => (i.notes = big))).message).toMatch(/too long \(invoices\.2\.notes\)/)
    // logos may be larger than ordinary strings…
    const logo = 'data:image/png;base64,' + 'A'.repeat(BACKUP_LIMITS.stringLength + 10)
    expect(() => validateBackup({ ...base(), profile: { ...makeProfile(), logoDataUrl: logo } })).not.toThrow()
    // …but not unlimited
    const hugeLogo = 'A'.repeat(BACKUP_LIMITS.logoDataUrlLength + 1)
    expect(errorOf({ ...base(), profile: { ...makeProfile(), logoDataUrl: hugeLogo } }).message).toMatch(/profile\.logoDataUrl/)

    const many = { ...base(), clients: new Array(BACKUP_LIMITS.records + 1).fill(null) }
    expect(errorOf(many).message).toMatch(/too many records/)
    expect(errorOf(withInvoice((i) => (i.lines = new Array(BACKUP_LIMITS.linesPerInvoice + 1).fill(null)))).message).toMatch(/too many entries/)
  })

  it('caps the JSON text size', () => {
    const text = { length: BACKUP_LIMITS.textLength + 1 } as unknown as string
    expect(() => parseBackup(text)).toThrow(/too large/)
  })
})

describe('validateBackup – values that reach URLs or CSS', () => {
  it('rejects remote logo URLs and non-hex colours (no beacons from a hostile backup)', () => {
    const profileLogo = base()
    ;(profileLogo.profile as Record<string, unknown>).logoDataUrl = 'https://attacker.invalid/logo.png'
    expect(errorOf(profileLogo).messages.en).toMatch(/logo/)

    expect(errorOf(withInvoice((i) => (i.accentColor = 'url(https://attacker.invalid/x.png)'))).messages.en).toMatch(/accent colour/)
    expect(errorOf(withInvoice((i) => ((i.seller as Record<string, unknown>).logoDataUrl = 'https://attacker.invalid/a.png'))).messages.en).toMatch(/seller logo/)
  })

  it('validates brand colours and colour mode on invoices and profile defaults', () => {
    const ok = withInvoice((i) => {
      i.secondaryColor = '#E0A100'
      i.colorMode = 'duo'
    })
    const defaults = (ok.profile as { defaults: Record<string, unknown> }).defaults
    defaults.secondaryColor = '#0f766e'
    defaults.colorMode = 'mono'
    expect(validateBackup(ok).invoices[2]).toMatchObject({ secondaryColor: '#E0A100', colorMode: 'duo' })

    expect(errorOf(withInvoice((i) => (i.secondaryColor = 'url(https://attacker.invalid/x.png)'))).messages.en).toMatch(/secondary colour/)
    expect(errorOf(withInvoice((i) => (i.secondaryColor = '#fff'))).messages.en).toMatch(/secondary colour/)
    expect(errorOf(withInvoice((i) => (i.colorMode = 'rainbow'))).messages.en).toMatch(/colour mode/)

    const badProfile = base()
    ;(badProfile.profile as { defaults: Record<string, unknown> }).defaults.secondaryColor = 'red;background:url(x)'
    expect(errorOf(badProfile).messages.en).toMatch(/invoice secondary colour/)
    const badMode = base()
    ;(badMode.profile as { defaults: Record<string, unknown> }).defaults.colorMode = 3
    expect(errorOf(badMode).messages.en).toMatch(/invoice colour mode/)
  })

  it('validates invoice defaults deeply and the Google client ID format', () => {
    const badDefaults = base()
    ;(badDefaults.profile as Record<string, unknown>).defaults = {}
    expect(() => validateBackup(badDefaults)).toThrow(BackupFormatError)

    const badWebsite = base()
    ;(badWebsite.profile as Record<string, unknown>).website = 12345
    expect(() => validateBackup(badWebsite)).toThrow(BackupFormatError)

    const settings = { uiLanguage: 'et', driveFolderName: 'Arved', registryLiveLookup: true, updatedAt: '' }
    expect(() => validateBackup({ ...base(), settings: { ...settings, googleClientId: 'evil' } })).toThrow(BackupFormatError)
    expect(validateBackup({ ...base(), settings: { ...settings, googleClientId: '123-abc.apps.googleusercontent.com' } }).settings).toBeTruthy()
  })
})

describe('validateBackup – version 2 data', () => {
  const v2 = () => ({
    ...base(),
    version: 2,
    products: [{ id: 'p1', description: 'Arendus', unit: 'h', unitPrice: 60, vatRate: 24, createdAt: '', updatedAt: '2026-01-01T00:00:00.000Z' }] as unknown[],
    recurringRules: [
      { id: 'r1', sourceInvoiceId: 'i2', interval: 'monthly', nextDate: '2026-11-01', active: true, createdAt: '', updatedAt: '2026-01-01T00:00:00.000Z' },
    ] as unknown[],
    events: [{ id: 'e1', invoiceId: 'i2', kind: 'reminder', at: '2026-10-20T10:00:00.000Z', note: '1' }] as unknown[],
  })

  it('accepts version 1 and 2 files', () => {
    expect(validateBackup(base()).products).toBeUndefined()
    const ok = validateBackup(v2())
    expect(ok.products).toHaveLength(1)
    expect(ok.recurringRules).toHaveLength(1)
    expect(ok.events).toHaveLength(1)
    expect(validateBackup({ ...v2(), products: null }).products).toBeUndefined()
  })

  it('validates products, rules and events field by field', () => {
    const cases: [(d: ReturnType<typeof v2>) => void, RegExp][] = [
      [(d) => (d.products = {} as never), /products/],
      [(d) => ((d.products[0] as Record<string, unknown>).unitPrice = '60'), /product #1 is invalid: invalid unit price/],
      [(d) => ((d.products[0] as Record<string, unknown>).vatRate = Infinity), /invalid VAT rate/],
      [(d) => delete (d.products[0] as Record<string, unknown>).updatedAt, /product #1 .* missing modification time/],
      [(d) => d.products.push({ ...(d.products[0] as object) }), /duplicate id p1/],
      [(d) => ((d.recurringRules[0] as Record<string, unknown>).interval = 'weekly'), /recurring rule #1 is invalid: invalid interval/],
      [(d) => ((d.recurringRules[0] as Record<string, unknown>).nextDate = '2026-02-30'), /invalid next date/],
      [(d) => ((d.recurringRules[0] as Record<string, unknown>).active = 'yes'), /invalid active flag/],
      [(d) => delete (d.recurringRules[0] as Record<string, unknown>).sourceInvoiceId, /missing source invoice/],
      [(d) => ((d.events[0] as Record<string, unknown>).kind = 'paid'), /event #1 is invalid: invalid event kind/],
      [(d) => delete (d.events[0] as Record<string, unknown>).at, /missing event time/],
      [(d) => ((d.events[0] as Record<string, unknown>).note = 5), /invalid note/],
    ]
    for (const [patch, re] of cases) {
      const d = v2()
      patch(d)
      expect(errorOf(d).message).toMatch(re)
    }
    expect(errorOf({ ...v2(), events: [{ invoiceId: 'x', kind: 'sent', at: '' }] }).messages.et).toMatch(/sündmus nr 1 on vigane: puudub ID/)
  })

  it('accepts quotes and the new invoice fields, and checks them', () => {
    const ok = withInvoice((inv) => Object.assign(inv, { type: 'quote', validUntil: '2026-10-29', quoteAcceptedAt: '2026-10-20T10:00:00.000Z', convertedToInvoiceId: 'x' }))
    expect(() => validateBackup(ok)).not.toThrow()
    expect(() => validateBackup(withInvoice((inv) => Object.assign(inv, { convertedFromQuoteId: 'q', recurringRuleId: 'r' })))).not.toThrow()
    expect(errorOf(withInvoice((inv) => (inv.validUntil = '29.10.2026'))).message).toMatch(/invalid quote validity date/)
    expect(errorOf(withInvoice((inv) => (inv.recurringRuleId = 3))).message).toMatch(/invalid recurring rule/)
  })

  it('validates numbering resets and period counters', () => {
    const withNumbering = (n: Record<string, unknown>, key = 'numbering') => {
      const d = base()
      d.profile = { ...makeProfile(), [key]: { prefix: '{YYYY}-', nextNumber: 1, padding: 4, ...n } }
      return d
    }
    expect(() => validateBackup(withNumbering({ reset: 'daily', counters: { '2026-10-15': 3, '2026-10': 2, '2026': 1 } }))).not.toThrow()
    expect(() => validateBackup(withNumbering({ reset: 'yearly' }, 'quoteNumbering'))).not.toThrow()
    expect(errorOf(withNumbering({ reset: 'weekly' })).message).toMatch(/invoice numbering: numbering reset/)
    expect(errorOf(withNumbering({ counters: { abc: 1 } })).message).toMatch(/counter of period abc/)
    expect(errorOf(withNumbering({ counters: { '2026': 0 } })).message).toMatch(/counter of period 2026/)
    expect(errorOf(withNumbering({ counters: { '2026': 1.5 } })).message).toMatch(/counter of period 2026/)
    expect(errorOf(withNumbering({ counters: [] })).message).toMatch(/period counters/)
    expect(errorOf(withNumbering({ nextNumber: 'x' }, 'quoteNumbering')).message).toMatch(/quote numbering: next number/)
    expect(errorOf({ ...base(), profile: { ...makeProfile(), quoteNumbering: 'HP' } }).message).toMatch(/quote numbering/)
    const many = Object.fromEntries(Array.from({ length: BACKUP_LIMITS.numberingCounters + 1 }, (_, i) => [String(1000 + i).padStart(4, '0'), 1]))
    expect(errorOf(withNumbering({ counters: many })).message).toMatch(/too many entries/)
    const polluted = JSON.stringify(withNumbering({ counters: { '2026': 1 } })).replace('"2026":1', '"2026":1,"__proto__":{"x":1}')
    expect(() => parseBackup(polluted)).toThrow(/__proto__/)
  })

  it('validates the automatic backup settings', () => {
    const settings = (autoBackup: unknown) => ({ ...base(), settings: { uiLanguage: 'et', driveFolderName: 'x', registryLiveLookup: true, updatedAt: '', autoBackup } })
    expect(() => validateBackup(settings({ enabled: true, encrypt: false, keepVersions: 10, lastBackupAt: '2026-10-15T10:00:00.000Z' }))).not.toThrow()
    expect(() => validateBackup(settings(undefined))).not.toThrow()
    expect(errorOf(settings({ enabled: 'yes', encrypt: false, keepVersions: 10 })).message).toMatch(/invalid automatic backup/)
    expect(errorOf(settings({ enabled: true, keepVersions: 10 })).message).toMatch(/missing backup encryption/)
    expect(errorOf(settings({ enabled: true, encrypt: true, keepVersions: 0 })).message).toMatch(/number of versions to keep/)
    expect(errorOf(settings({ enabled: true, encrypt: true, keepVersions: 2.5 })).message).toMatch(/number of versions to keep/)
    expect(errorOf(settings({ enabled: true, encrypt: true, keepVersions: 5, lastBackupAt: 1 })).message).toMatch(/last backup time/)
    expect(errorOf(settings('on')).message).toMatch(/automatic backup settings/)
  })
})
