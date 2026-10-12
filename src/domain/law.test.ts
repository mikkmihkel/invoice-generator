import { describe, expect, it } from 'vitest'
import {
  ESTONIAN_VAT_RATES,
  formatIban,
  isEuCountry,
  isValidEstonianPersonalCode,
  isValidEstonianRegistryCode,
  isValidIban,
  isValidVatNumber,
  vatSchemeAllowsRates,
  vatSchemeNote,
  vatNoteMode,
  vatNoteRelevant,
  NOTE_REPLACEABLE,
  vatSchemeRequiresBuyerVat,
  vatSchemeRequiresSellerVat,
} from './law'
import type { VatScheme } from './types'

const ALL_SCHEMES: VatScheme[] = [
  'not-registered',
  'domestic',
  'eu-reverse-charge',
  'eu-goods',
  'export',
  'exempt',
  'domestic-reverse-charge',
]

describe('VAT rates', () => {
  it('lists the 2026 Estonian rates with the 24% standard rate first', () => {
    expect(ESTONIAN_VAT_RATES).toEqual([24, 13, 9, 0])
  })
})

describe('scheme helpers', () => {
  it('only domestic sales carry VAT rates', () => {
    expect(ALL_SCHEMES.filter(vatSchemeAllowsRates)).toEqual(['domestic'])
  })
  it('requires buyer VAT number when the buyer accounts for VAT or for intra-Community supply', () => {
    expect(ALL_SCHEMES.filter(vatSchemeRequiresBuyerVat)).toEqual([
      'eu-reverse-charge',
      'eu-goods',
      'domestic-reverse-charge',
    ])
  })
  it('requires seller VAT registration for every scheme except not-registered', () => {
    expect(ALL_SCHEMES.filter((s) => !vatSchemeRequiresSellerVat(s))).toEqual(['not-registered'])
  })
})

describe('vatSchemeNote', () => {
  it('returns null for domestic sales', () => {
    expect(vatSchemeNote('domestic', 'et')).toBeNull()
    expect(vatSchemeNote('domestic', 'et-en')).toBeNull()
  })
  it('uses the statutory "pöördmaksustamine" wording for reverse charge', () => {
    expect(vatSchemeNote('eu-reverse-charge', 'et')).toMatch(/^Pöördmaksustamine\./)
    expect(vatSchemeNote('eu-reverse-charge', 'et')).toContain('art 44 ja 196')
    expect(vatSchemeNote('eu-reverse-charge', 'en')).toMatch(/^Reverse charge\./)
    expect(vatSchemeNote('domestic-reverse-charge', 'et')).toBe('Pöördmaksustamine (KMS § 41¹).')
    expect(vatSchemeNote('domestic-reverse-charge', 'en')).toContain('§ 41¹')
  })
  it('cites the legal basis for zero-rated and exempt supplies', () => {
    expect(vatSchemeNote('eu-goods', 'et')).toContain('KMS § 15 lg 3 p 2')
    expect(vatSchemeNote('eu-goods', 'en')).toContain('Art. 138')
    expect(vatSchemeNote('export', 'et')).toContain('KMS § 15 lg 3 p 1')
    expect(vatSchemeNote('export', 'en')).toContain('Art. 146')
    expect(vatSchemeNote('non-eu-services', 'et')).toContain('ei ole Eestis maksustatav')
    expect(vatSchemeNote('non-eu-services', 'en')).toContain('§ 10')
    expect(vatSchemeAllowsRates('non-eu-services')).toBe(false)
    expect(vatSchemeRequiresBuyerVat('non-eu-services')).toBe(false)
    expect(vatSchemeNote('exempt', 'et')).toContain('KMS § 16')
  })
  it('combines both languages for bilingual invoices', () => {
    const et = vatSchemeNote('eu-goods', 'et')
    const en = vatSchemeNote('eu-goods', 'en')
    expect(vatSchemeNote('eu-goods', 'et-en')).toBe(`${et} / ${en}`)
  })
  it('informs that a non-registered seller charges no VAT', () => {
    expect(vatSchemeNote('not-registered', 'et')).toContain('ei ole käibemaksukohustuslasena registreeritud')
  })
  it('lets a custom note replace the default for exempt/export but keeps reverse-charge wording', () => {
    expect(vatSchemeNote('exempt', 'et', 'Maksuvaba (KMS § 16 lg 2 p 1)')).toBe('Maksuvaba (KMS § 16 lg 2 p 1)')
    expect(vatSchemeNote('export', 'en', 'Outside the scope of Estonian VAT')).toBe('Outside the scope of Estonian VAT')
    expect(vatSchemeNote('domestic', 'et', 'KMS § 15 lg 4 p 1')).toBe('KMS § 15 lg 4 p 1')
    const rc = vatSchemeNote('eu-reverse-charge', 'et', 'Lisainfo')
    expect(rc).toMatch(/^Pöördmaksustamine\./)
    expect(rc).toMatch(/Lisainfo$/)
    expect(vatSchemeNote('exempt', 'et', '   ')).toBe('Maksuvaba käive (KMS § 16).')
  })
})

describe('isValidEstonianRegistryCode', () => {
  // Real codes: python-stdnum test data (found online) + well-known companies.
  const valid = [
    '10000024', '10254782', '10491045', '11104323', '12073932', '12493640', '70000823', '75000561',
    '75033069', '80026261', '80336642', '90004740', '90010887',
    '10234957', // Telia Eesti AS
    '10060701', // Swedbank AS
    '10539549', // AS LHV Pank
    '10004252', // AS SEB Pank
    '10421629', // Eesti Energia AS
    '12417834', // Bolt Technology OÜ
  ]
  it.each(valid)('accepts %s', (code) => expect(isValidEstonianRegistryCode(code)).toBe(true))
  it('accepts spaces as separators', () => expect(isValidEstonianRegistryCode(' 1023 4957 ')).toBe(true))
  it.each([
    ['12345679', 'wrong check digit'],
    ['10234958', 'wrong check digit'],
    ['32345674', 'invalid first digit'],
    ['1234567', 'too short'],
    ['123456789', 'too long'],
    ['1234567A', 'non-digit'],
    ['', 'empty'],
  ])('rejects %s (%s)', (code) => expect(isValidEstonianRegistryCode(code)).toBe(false))
  it('handles the second-round weights (first sum ≡ 10 mod 11)', () => {
    for (const code of ['75002884', '75006820', '75012952', '80314929', '90010671']) {
      expect(isValidEstonianRegistryCode(code)).toBe(true)
    }
    expect(isValidEstonianRegistryCode('75002880')).toBe(false)
  })
})

describe('isValidEstonianPersonalCode', () => {
  it('validates the isikukood check digit', () => {
    expect(isValidEstonianPersonalCode('36805280109')).toBe(true)
    expect(isValidEstonianPersonalCode('49403136526')).toBe(true)
    expect(isValidEstonianPersonalCode('36805280108')).toBe(false)
    expect(isValidEstonianPersonalCode('96805280109')).toBe(false)
  })
})

describe('isValidVatNumber', () => {
  it.each(['EE100931558', 'EE 100 931 558', 'ee100523487', 'EE101256753', 'EE101286639'])('accepts Estonian %s', (v) =>
    expect(isValidVatNumber(v)).toBe(true),
  )
  it.each(['EE100931559', 'EE10093155', 'EE1009315580', '100931558', 'EEABCDEFGHI'])('rejects Estonian %s', (v) =>
    expect(isValidVatNumber(v)).toBe(false),
  )
  it.each([
    'ATU13585627', 'BE0428759497', 'DE136308783', 'FI18261444', 'FR40303265045', 'LT100001354118', 'LV40003521600',
    'NL004495445B01', 'PL5260250995', 'SE556188840401', 'IE6388047V', 'EL094259216', 'CY10259033P', 'XI123456789',
    'DE 811 363 057', 'LT119511515',
  ])('accepts EU format %s', (v) => expect(isValidVatNumber(v)).toBe(true))
  it.each(['DE12345678', 'ATU1234567', 'GR094259216', 'XX123456789', 'FI1826144', 'SE556188840402', ''])(
    'rejects %s',
    (v) => expect(isValidVatNumber(v)).toBe(false),
  )
  it('accepts common non-EU formats', () => {
    expect(isValidVatNumber('GB123456789')).toBe(true)
    expect(isValidVatNumber('NO123456789MVA')).toBe(true)
    expect(isValidVatNumber('CHE123456789MWST')).toBe(true)
  })
})

describe('isValidIban', () => {
  it.each([
    'EE382200221020145685',
    'EE38 2200 2210 2014 5685',
    'ee382200221020145685',
    'GB82WEST12345698765432',
    'DE89370400440532013000',
    'FI2112345600000785',
    'LT121000011101001000',
    'LV80BANK0000435195001',
  ])('accepts %s', (iban) => expect(isValidIban(iban)).toBe(true))
  it.each([
    ['EE382200221020145686', 'checksum'],
    ['EE392200221020145685', 'check digits'],
    ['EE38220022102014568', 'length for EE'],
    ['GB82WEST1234569876543', 'length for GB'],
    ['EE38-2200-2210-2014-5685', 'illegal chars'],
    ['', 'empty'],
  ])('rejects %s (%s)', (iban) => expect(isValidIban(iban)).toBe(false))
  it('formats in groups of four', () => {
    expect(formatIban('EE382200221020145685')).toBe('EE38 2200 2210 2014 5685')
  })
})

describe('isEuCountry', () => {
  it('recognises member states by ISO code', () => {
    expect(isEuCountry('ee')).toBe(true)
    expect(isEuCountry('GR')).toBe(true)
    expect(isEuCountry('GB')).toBe(false)
    expect(isEuCountry('NO')).toBe(false)
    expect(isEuCountry(undefined)).toBe(false)
  })
})

describe('vatNoteMode / vatNoteRelevant', () => {
  it('replaces the default where the legal basis depends on the supply, appends to statutory wording', () => {
    for (const s of NOTE_REPLACEABLE) expect(vatNoteMode(s)).toBe('replace')
    expect(vatNoteMode('eu-reverse-charge')).toBe('append')
    expect(vatNoteMode('eu-goods')).toBe('append')
    expect(vatNoteMode('non-eu-services')).toBe('append')
    expect(vatNoteMode('domestic-reverse-charge')).toBe('append')
    // vatSchemeNote follows the same rule.
    expect(vatSchemeNote('export', 'et', 'X')).toBe('X')
    expect(vatSchemeNote('eu-goods', 'et', 'X')).toMatch(/^Kauba ühendusesisene käive.* X$/)
  })

  it('is relevant for 0% / exempt / foreign supplies, not for normal domestic VAT', () => {
    const line = (vatRate: number) => ({ vatRate })
    expect(vatNoteRelevant({ vatScheme: 'domestic', lines: [line(24)] })).toBe(false)
    expect(vatNoteRelevant({ vatScheme: 'domestic', lines: [line(24), line(0)] })).toBe(true)
    expect(vatNoteRelevant({ vatScheme: 'not-registered', lines: [line(0)] })).toBe(false)
    for (const s of ['exempt', 'export', 'non-eu-services', 'eu-goods', 'eu-reverse-charge', 'domestic-reverse-charge'] as const) {
      expect(vatNoteRelevant({ vatScheme: s, lines: [] })).toBe(true)
    }
  })
})
