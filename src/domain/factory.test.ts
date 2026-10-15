import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addDays,
  createDefaultProfile,
  createDefaultSettings,
  createEmptyInvoice,
  isValidISODate,
  newId,
  textRows,
  todayISO,
} from './factory'
import type { Client, CompanyProfile } from './types'

afterEach(() => {
  vi.useRealTimers()
})

describe('newId', () => {
  it('returns unique UUID v4 strings', () => {
    const ids = new Set(Array.from({ length: 100 }, newId))
    expect(ids.size).toBe(100)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('todayISO', () => {
  it('uses the local calendar date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 0, 30)) // local 00:30 on 1 Jan
    expect(todayISO()).toBe('2026-01-01')
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59))
    expect(todayISO()).toBe('2026-12-31')
  })
})

describe('addDays', () => {
  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-12', 14)).toBe('2026-10-26')
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30') // EU DST switch
    expect(addDays('2026-01-05', -10)).toBe('2025-12-26')
    expect(addDays('2026-01-05', 0)).toBe('2026-01-05')
  })
  it('throws on invalid dates', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow()
    expect(() => addDays('12.10.2026', 1)).toThrow()
  })
  it('isValidISODate rejects impossible dates', () => {
    expect(isValidISODate('2026-02-28')).toBe(true)
    expect(isValidISODate('2026-02-29')).toBe(false)
    expect(isValidISODate('2026-13-01')).toBe(false)
    expect(isValidISODate('')).toBe(false)
  })
})

describe('createDefaultProfile', () => {
  it('has Estonian defaults', () => {
    const p = createDefaultProfile()
    expect(p.address.country).toBe('EE')
    expect(p.vatRegistered).toBe(false)
    expect(p.bankAccounts).toEqual([])
    expect(p.defaults).toMatchObject({
      paymentTermDays: 14,
      templateId: 'standard',
      accentColor: '#1f4e79',
      language: 'et',
      currency: 'EUR',
      vatScheme: 'not-registered',
      defaultVatRate: 24,
      defaultUnit: 'tk',
    })
    expect(p.defaults.emailSubject).toContain('{number}')
    expect(p.defaults.emailBody).toContain('{dueDate}')
    expect(p.defaults.emailBody).toContain('{total}')
    expect(p.defaults.emailSubjectEn).toBe('Invoice {number} from {company}')
    expect(p.defaults.emailBodyEn).toContain('{dueDate}')
    expect(p.defaults.emailBodyEn).toContain('{total}')
    expect(p.numbering).toEqual({ prefix: '{YYYY}-', nextNumber: 1, padding: 4, reset: 'yearly', counters: {} })
    expect(p.quoteNumbering).toEqual({ prefix: 'HP-{YYYY}-', nextNumber: 1, padding: 3, reset: 'yearly', counters: {} })
    expect(Number.isNaN(Date.parse(p.updatedAt))).toBe(false)
  })
})

describe('createDefaultSettings', () => {
  it('has Estonian UI defaults', () => {
    expect(createDefaultSettings()).toMatchObject({ uiLanguage: 'et', driveFolderName: 'Arved', registryLiveLookup: true })
  })
})

function registeredProfile(): CompanyProfile {
  const p = createDefaultProfile()
  p.name = 'Näide OÜ'
  p.registryCode = '12417834'
  p.vatRegistered = true
  p.vatNumber = 'EE100931558'
  p.address = { street: 'Narva mnt 5', city: 'Tallinn', postalCode: '10117', country: 'EE' }
  p.bankAccounts = [
    { id: 'a1', iban: 'EE382200221020145685' },
    { id: 'a2', iban: 'EE471000001020145685' },
  ]
  p.defaults.vatScheme = 'domestic'
  p.defaults.lateInterestPercentPerDay = 0.05
  p.defaults.footerNote = 'Täname koostöö eest!'
  return p
}

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 'c1',
    kind: 'company',
    name: 'Klient AS',
    registryCode: '10234957',
    vatNumber: 'EE100523487',
    contactPerson: 'Mari Maasikas',
    address: { street: 'Pärnu mnt 1', city: 'Tallinn', postalCode: '10141', country: 'EE' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('createEmptyInvoice', () => {
  it('pre-fills a draft from profile defaults', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 12, 10, 0))
    const p = registeredProfile()
    const inv = createEmptyInvoice(p)
    expect(inv).toMatchObject({
      number: '',
      type: 'invoice',
      status: 'draft',
      issueDate: '2026-10-12',
      dueDate: '2026-10-26',
      currency: 'EUR',
      vatScheme: 'domestic',
      language: 'et',
      templateId: 'standard',
      accentColor: '#1f4e79',
      bankAccountIds: ['a1', 'a2'],
      lateInterestPercentPerDay: 0.05,
      footerNote: 'Täname koostöö eest!',
    })
    expect(inv.lines).toHaveLength(1)
    expect(inv.lines[0]).toMatchObject({ description: '', quantity: 1, unit: 'tk', unitPrice: 0, vatRate: 24 })
    expect(inv.buyer).toMatchObject({ name: '', kind: 'company', address: { country: 'EE' } })
  })

  it('snapshots the seller without defaults/numbering and as a deep copy', () => {
    const p = registeredProfile()
    const inv = createEmptyInvoice(p)
    expect(inv.seller).not.toHaveProperty('defaults')
    expect(inv.seller).not.toHaveProperty('numbering')
    expect(inv.seller).not.toHaveProperty('quoteNumbering')
    expect(inv.seller).not.toHaveProperty('updatedAt')
    expect(inv.seller).toMatchObject({ name: 'Näide OÜ', vatNumber: 'EE100931558', vatRegistered: true })
    p.address.street = 'Changed'
    p.bankAccounts[0].iban = 'X'
    expect(inv.seller.address.street).toBe('Narva mnt 5')
    expect(inv.seller.bankAccounts[0].iban).toBe('EE382200221020145685')
  })

  it('does not copy the logo into a draft (issueInvoice snapshots it)', () => {
    const p = { ...registeredProfile(), logoDataUrl: 'data:image/png;base64,AAAA' }
    expect(createEmptyInvoice(p).seller).not.toHaveProperty('logoDataUrl')
  })

  it('applies client overrides and buyer snapshot', () => {
    const inv = createEmptyInvoice(registeredProfile(), client({ defaultLanguage: 'en', defaultVatScheme: 'eu-reverse-charge' }))
    expect(inv.language).toBe('en')
    expect(inv.vatScheme).toBe('eu-reverse-charge')
    expect(inv.lines[0].vatRate).toBe(0)
    expect(inv.buyer).toMatchObject({
      clientId: 'c1',
      kind: 'company',
      name: 'Klient AS',
      registryCode: '10234957',
      vatNumber: 'EE100523487',
      contactPerson: 'Mari Maasikas',
    })
    expect(inv.buyer).not.toHaveProperty('createdAt')
    expect(inv.buyer).not.toHaveProperty('notes')
  })

  it('forces not-registered for sellers without VAT registration', () => {
    const p = createDefaultProfile()
    const inv = createEmptyInvoice(p, client({ defaultVatScheme: 'domestic' }))
    expect(inv.vatScheme).toBe('not-registered')
    expect(inv.lines[0].vatRate).toBe(0)
    expect(inv.bankAccountIds).toEqual([])
    expect(inv).not.toHaveProperty('lateInterestPercentPerDay')
    expect(inv).not.toHaveProperty('footerNote')
  })

  it('copies the default text rows (non-blank, as a copy)', () => {
    const p = registeredProfile()
    p.defaults.textBefore = ['Vastavalt lepingule nr 12/2026', '  ']
    p.defaults.textAfter = ['Täname koostöö eest!\nTeine rida  ']
    const inv = createEmptyInvoice(p)
    expect(inv.textBefore).toEqual(['Vastavalt lepingule nr 12/2026'])
    expect(inv.textAfter).toEqual(['Täname koostöö eest!\nTeine rida'])
    inv.textBefore!.push('x')
    expect(p.defaults.textBefore).toHaveLength(2)
    expect(createEmptyInvoice(registeredProfile())).not.toHaveProperty('textBefore')
  })

  it('uses domestic for a registered seller whose default is still not-registered', () => {
    const p = registeredProfile()
    p.defaults.vatScheme = 'not-registered'
    expect(createEmptyInvoice(p).vatScheme).toBe('domestic')
  })

  it('snapshots the brand colours and colour mode', () => {
    const p = registeredProfile()
    expect(createEmptyInvoice(p)).not.toHaveProperty('secondaryColor')
    expect(createEmptyInvoice(p)).not.toHaveProperty('colorMode')
    p.defaults.secondaryColor = '#E0A100'
    p.defaults.colorMode = 'duo'
    const inv = createEmptyInvoice(p)
    expect(inv).toMatchObject({ accentColor: '#1f4e79', secondaryColor: '#E0A100', colorMode: 'duo' })
    p.defaults.colorMode = 'mono'
    expect(inv.colorMode).toBe('duo')
  })

  it('drops an invalid secondary colour or colour mode', () => {
    const p = registeredProfile()
    p.defaults.secondaryColor = 'url(https://evil.example/x)'
    p.defaults.colorMode = 'rainbow' as never
    const inv = createEmptyInvoice(p)
    expect(inv).not.toHaveProperty('secondaryColor')
    expect(inv).not.toHaveProperty('colorMode')
  })

  it('uses the configured payment term', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 11, 20, 12, 0))
    const p = registeredProfile()
    p.defaults.paymentTermDays = 30
    expect(createEmptyInvoice(p).dueDate).toBe('2027-01-19')
  })
})

describe('textRows', () => {
  it('drops blank and non-string rows and trims trailing whitespace', () => {
    expect(textRows(undefined)).toEqual([])
    expect(textRows(['a ', '', ' \n ', 3, 'b\nc'])).toEqual(['a', 'b\nc'])
  })
})
