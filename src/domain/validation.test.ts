import { describe, expect, it } from 'vitest'
import { canIssue, validateInvoice } from './validation'
import type { Invoice, ValidationIssue } from './types'

const TODAY = '2026-10-12'

function baseInvoice(): Invoice {
  return {
    id: 'i1',
    number: '2026-0001',
    type: 'invoice',
    status: 'draft',
    issueDate: '2026-10-12',
    dueDate: '2026-10-26',
    seller: {
      name: 'Näide OÜ',
      registryCode: '12417834',
      vatNumber: 'EE100931558',
      vatRegistered: true,
      address: { street: 'Narva mnt 5', city: 'Tallinn', postalCode: '10117', country: 'EE' },
      bankAccounts: [{ id: 'a1', iban: 'EE382200221020145685', bankName: 'Swedbank' }],
    },
    buyer: {
      kind: 'company',
      name: 'Klient AS',
      registryCode: '10234957',
      address: { street: 'Pärnu mnt 1', city: 'Tallinn', postalCode: '10141', country: 'EE' },
    },
    bankAccountIds: ['a1'],
    lines: [{ id: 'l1', description: 'Konsultatsioon', quantity: 10, unit: 'h', unitPrice: 50, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic',
    language: 'et',
    templateId: 'classic',
    accentColor: '#1f4e79',
    createdAt: '2026-10-12T10:00:00.000Z',
    updatedAt: '2026-10-12T10:00:00.000Z',
  }
}

function notRegisteredInvoice(): Invoice {
  const inv = baseInvoice()
  inv.seller.vatRegistered = false
  delete inv.seller.vatNumber
  inv.vatScheme = 'not-registered'
  inv.lines[0].vatRate = 0
  return inv
}

function euInvoice(scheme: Invoice['vatScheme']): Invoice {
  const inv = baseInvoice()
  inv.vatScheme = scheme
  inv.lines[0].vatRate = 0
  inv.buyer = {
    kind: 'company',
    name: 'Kunde GmbH',
    vatNumber: 'DE136308783',
    address: { street: 'Hauptstr. 1', city: 'Berlin', postalCode: '10115', country: 'DE' },
  }
  return inv
}

function run(inv: Invoice, opts = {}) {
  return validateInvoice(inv, { today: TODAY, ...opts })
}

function find(issues: ValidationIssue[], field: string, severity?: 'error' | 'warning') {
  return issues.find((i) => i.field === field && (!severity || i.severity === severity))
}

function expectIssue(inv: Invoice, field: string, severity: 'error' | 'warning', legal?: RegExp) {
  const issues = run(inv)
  const issue = find(issues, field, severity)
  expect(issue, `${severity} on ${field}; got ${JSON.stringify(issues.map((i) => [i.field, i.severity]))}`).toBeDefined()
  expect(issue!.message.et.length).toBeGreaterThan(0)
  expect(issue!.message.en.length).toBeGreaterThan(0)
  if (legal) expect(issue!.legalBasis).toMatch(legal)
  return issue!
}

function expectNoIssue(inv: Invoice, field: string) {
  expect(run(inv).filter((i) => i.field === field)).toEqual([])
}

describe('validateInvoice – valid invoices', () => {
  it('accepts a complete domestic invoice without any issues', () => {
    expect(run(baseInvoice())).toEqual([])
    expect(canIssue(baseInvoice(), { today: TODAY })).toBe(true)
  })
  it('accepts a complete invoice from a non-registered seller', () => {
    expect(run(notRegisteredInvoice())).toEqual([])
  })
  it.each(['eu-reverse-charge', 'eu-goods'] as const)('accepts a complete %s invoice', (scheme) => {
    expect(run(euInvoice(scheme))).toEqual([])
  })
  it('accepts a complete export invoice to a non-EU buyer', () => {
    const inv = euInvoice('export')
    inv.buyer = { kind: 'company', name: 'US Inc', address: { street: '1 Main St', city: 'Austin', postalCode: '78701', country: 'US' } }
    expect(run(inv)).toEqual([])
  })
  it('accepts domestic reverse charge to an Estonian VAT payer', () => {
    const inv = baseInvoice()
    inv.vatScheme = 'domestic-reverse-charge'
    inv.lines[0].vatRate = 0
    inv.buyer.vatNumber = 'EE100523487'
    expect(run(inv)).toEqual([])
  })
  it('accepts a complete credit note with negative quantities', () => {
    const inv = baseInvoice()
    inv.type = 'credit-note'
    inv.number = '2026-0002'
    inv.creditedInvoiceNumber = '2026-0001'
    inv.lines[0].quantity = -10
    expect(run(inv)).toEqual([])
  })
})

describe('validateInvoice – invoice data', () => {
  it('requires a number unless disabled for drafts', () => {
    const inv = baseInvoice()
    inv.number = ' '
    expectIssue(inv, 'number', 'error', /KMS § 37 lg 7 p 1/)
    expect(find(run(inv, { requireNumber: false }), 'number')).toBeUndefined()
    expect(canIssue(inv, { today: TODAY })).toBe(false)
    expect(canIssue(inv, { today: TODAY, requireNumber: false })).toBe(true)
  })
  it('requires a valid issue date', () => {
    const inv = baseInvoice()
    inv.issueDate = '2026-02-30'
    expectIssue(inv, 'issueDate', 'error', /KMS § 37/)
  })
  it('warns about issue dates far in the future', () => {
    const inv = baseInvoice()
    inv.issueDate = '2027-01-01'
    inv.dueDate = '2027-01-15'
    expectIssue(inv, 'issueDate', 'warning')
  })
  it('requires due date ≥ issue date', () => {
    const inv = baseInvoice()
    inv.dueDate = '2026-10-11'
    expectIssue(inv, 'dueDate', 'error')
    inv.dueDate = '2026-10-12'
    expectNoIssue(inv, 'dueDate')
    inv.dueDate = ''
    expectIssue(inv, 'dueDate', 'error')
  })
  it('validates supply date and warns when invoice is issued late', () => {
    const inv = baseInvoice()
    inv.supplyDate = 'x'
    expectIssue(inv, 'supplyDate', 'error', /p 6/)
    inv.supplyDate = '2026-10-01'
    expectIssue(inv, 'supplyDate', 'warning')
    inv.supplyDate = '2026-10-05'
    expectNoIssue(inv, 'supplyDate')
  })
  it('validates the service period', () => {
    const inv = baseInvoice()
    inv.periodStart = '2026-10-01'
    inv.periodEnd = '2026-09-30'
    expectIssue(inv, 'periodEnd', 'error')
    inv.periodEnd = undefined
    expectIssue(inv, 'periodEnd', 'warning')
    inv.periodEnd = '2026-10-31'
    expectNoIssue(inv, 'periodEnd')
    expectNoIssue(inv, 'periodStart')
  })
})

describe('validateInvoice – seller', () => {
  it('requires seller name', () => {
    const inv = baseInvoice()
    inv.seller.name = ''
    expectIssue(inv, 'seller.name', 'error', /ÄS § 15/)
  })
  it('requires a valid Estonian registry code', () => {
    const inv = baseInvoice()
    inv.seller.registryCode = ''
    expectIssue(inv, 'seller.registryCode', 'error', /ÄS § 15/)
    inv.seller.registryCode = '12417835'
    expectIssue(inv, 'seller.registryCode', 'error')
  })
  it('does not require an Estonian registry code from a foreign seller', () => {
    const inv = notRegisteredInvoice()
    inv.seller.registryCode = undefined
    inv.seller.address.country = 'FI'
    expectNoIssue(inv, 'seller.registryCode')
  })
  it('requires the seller address', () => {
    const inv = baseInvoice()
    inv.seller.address = { street: '', city: '', postalCode: '', country: 'EE' }
    expectIssue(inv, 'seller.address', 'error', /KMS § 37 lg 7 p 2/)
    inv.seller.address = { street: 'Narva mnt 5', city: '', postalCode: '', country: 'EE' }
    expectIssue(inv, 'seller.address.city', 'error')
    expectIssue(inv, 'seller.address.postalCode', 'warning')
  })
  it('requires a valid seller VAT number for VAT-registered schemes', () => {
    const inv = baseInvoice()
    inv.seller.vatNumber = ''
    expectIssue(inv, 'seller.vatNumber', 'error', /KMS § 37 lg 7 p 2/)
    inv.seller.vatNumber = 'EE100931559'
    expectIssue(inv, 'seller.vatNumber', 'error')
  })
  it('does not require a VAT number from a non-registered seller', () => {
    expectNoIssue(notRegisteredInvoice(), 'seller.vatNumber')
  })
  it('forbids a non-registered seller from charging VAT', () => {
    const inv = notRegisteredInvoice()
    inv.vatScheme = 'domestic'
    inv.lines[0].vatRate = 24
    expectIssue(inv, 'vatScheme', 'error', /art 203/)
    expect(canIssue(inv, { today: TODAY })).toBe(false)
  })
  it('forbids a VAT-registered seller from omitting VAT', () => {
    const inv = baseInvoice()
    inv.vatScheme = 'not-registered'
    expectIssue(inv, 'vatScheme', 'error')
  })
})

describe('validateInvoice – bank accounts', () => {
  it('warns when no bank account is printed', () => {
    const inv = baseInvoice()
    inv.seller.bankAccounts = []
    inv.bankAccountIds = []
    expectIssue(inv, 'bankAccountIds', 'warning')
  })
  it('treats empty bankAccountIds as all accounts', () => {
    const inv = baseInvoice()
    inv.bankAccountIds = []
    expectNoIssue(inv, 'bankAccountIds')
  })
  it('warns about selected accounts that no longer exist', () => {
    const inv = baseInvoice()
    inv.bankAccountIds = ['a1', 'gone']
    expectIssue(inv, 'bankAccountIds', 'warning')
  })
  it('rejects an invalid IBAN', () => {
    const inv = baseInvoice()
    inv.seller.bankAccounts[0].iban = 'EE382200221020145686'
    expectIssue(inv, 'seller.bankAccounts.0.iban', 'error')
  })
})

describe('validateInvoice – buyer', () => {
  it('requires buyer name', () => {
    const inv = baseInvoice()
    inv.buyer.name = ''
    expectIssue(inv, 'buyer.name', 'error', /KMS § 37 lg 7 p 3/)
  })
  it('requires buyer address for VAT-registered sellers, warns otherwise', () => {
    const inv = baseInvoice()
    inv.buyer.address = { street: '', city: '', postalCode: '', country: 'EE' }
    expectIssue(inv, 'buyer.address', 'error', /KMS § 37 lg 7 p 3/)
    const nr = notRegisteredInvoice()
    nr.buyer.address = { street: '', city: '', postalCode: '', country: 'EE' }
    expectIssue(nr, 'buyer.address', 'warning', /RPS § 7/)
    expect(canIssue(nr, { today: TODAY })).toBe(true)
  })
  it('warns about a missing or invalid registry code of an Estonian company buyer', () => {
    const inv = baseInvoice()
    inv.buyer.registryCode = undefined
    expectIssue(inv, 'buyer.registryCode', 'warning', /RPS § 7/)
    inv.buyer.registryCode = '10234958'
    expectIssue(inv, 'buyer.registryCode', 'warning')
  })
  it('does not ask a private person for a registry code but checks the personal code', () => {
    const inv = baseInvoice()
    inv.buyer = { kind: 'person', name: 'Mari Maasikas', personalCode: '36805280108', address: inv.buyer.address }
    expectNoIssue(inv, 'buyer.registryCode')
    expectIssue(inv, 'buyer.personalCode', 'warning')
  })
  it('warns about an invalid optional buyer VAT number', () => {
    const inv = baseInvoice()
    inv.buyer.vatNumber = 'EE123'
    expectIssue(inv, 'buyer.vatNumber', 'warning')
  })
})

describe('validateInvoice – VAT schemes', () => {
  it.each(['eu-reverse-charge', 'eu-goods', 'domestic-reverse-charge'] as const)('%s requires a valid buyer VAT number', (scheme) => {
    const inv = euInvoice(scheme)
    inv.buyer.vatNumber = undefined
    expectIssue(inv, 'buyer.vatNumber', 'error', /KMS § 37 lg 7 p 4/)
    inv.buyer.vatNumber = 'DE12345'
    expectIssue(inv, 'buyer.vatNumber', 'error')
  })
  it.each(['eu-reverse-charge', 'eu-goods'] as const)('%s rejects an Estonian or non-EU buyer VAT number', (scheme) => {
    const inv = euInvoice(scheme)
    inv.buyer.vatNumber = 'EE100523487'
    expectIssue(inv, 'buyer.vatNumber', 'error')
    inv.buyer.vatNumber = 'NO123456789MVA'
    expectIssue(inv, 'buyer.vatNumber', 'error')
  })
  it('warns when buyer country and VAT prefix differ', () => {
    const inv = euInvoice('eu-goods')
    inv.buyer.address.country = 'FI'
    expectIssue(inv, 'buyer.address.country', 'warning')
    inv.buyer.address.country = 'GR'
    inv.buyer.vatNumber = 'EL094259216'
    expectNoIssue(inv, 'buyer.address.country')
  })
  it('domestic reverse charge needs an Estonian buyer VAT number', () => {
    const inv = euInvoice('domestic-reverse-charge')
    expectIssue(inv, 'buyer.vatNumber', 'error', /41¹/)
  })
  it('warns when export is used for an EU buyer', () => {
    expectIssue(euInvoice('export'), 'vatScheme', 'warning')
    expectIssue(euInvoice('non-eu-services'), 'vatScheme', 'warning')
  })
  it('warns when domestic VAT is charged to a foreign EU business', () => {
    const inv = euInvoice('domestic')
    inv.lines[0].vatRate = 24
    expectIssue(inv, 'vatScheme', 'warning')
  })
  it('asks for the exact exemption basis on exempt supplies', () => {
    const inv = baseInvoice()
    inv.vatScheme = 'exempt'
    inv.lines[0].vatRate = 0
    expectIssue(inv, 'vatExemptionNote', 'warning', /KMS § 16/)
    inv.vatExemptionNote = 'Maksuvaba käive KMS § 16 lg 2 p 1 alusel'
    expectNoIssue(inv, 'vatExemptionNote')
  })
  it('warns when a domestic 0% line has no legal reference', () => {
    const inv = baseInvoice()
    inv.lines[0].vatRate = 0
    expectIssue(inv, 'vatExemptionNote', 'warning', /KMS § 37 lg 8/)
  })
  it('rejects rates that do not exist and warns about historical rates', () => {
    const inv = baseInvoice()
    inv.lines[0].vatRate = 20.5
    expectIssue(inv, 'lines.0.vatRate', 'error')
    inv.lines[0].vatRate = 22
    expectIssue(inv, 'lines.0.vatRate', 'warning')
    for (const rate of [24, 13, 9]) {
      inv.lines[0].vatRate = rate
      expectNoIssue(inv, 'lines.0.vatRate')
    }
  })
  it('warns that a line VAT rate is ignored under a non-domestic scheme', () => {
    const inv = euInvoice('eu-goods')
    inv.lines[0].vatRate = 24
    expectIssue(inv, 'lines.0.vatRate', 'warning')
  })
  it('requires a euro exchange rate on foreign currency VAT invoices', () => {
    const inv = baseInvoice()
    inv.currency = 'USD'
    expectIssue(inv, 'eurExchangeRate', 'error', /eurodes/)
    inv.eurExchangeRate = 1.08
    expect(validateInvoice(inv).some((i) => i.field === 'eurExchangeRate')).toBe(false)
    inv.currency = ''
    expectIssue(inv, 'currency', 'error')
  })
})

describe('validateInvoice – lines', () => {
  it('requires at least one line', () => {
    const inv = baseInvoice()
    inv.lines = []
    expectIssue(inv, 'lines', 'error', /KMS § 37 lg 7 p 5/)
  })
  it('requires description, quantity and unit price', () => {
    const inv = baseInvoice()
    inv.lines.push({ id: 'l2', description: ' ', quantity: 0, unit: '', unitPrice: Number.NaN, vatRate: 24 })
    expectIssue(inv, 'lines.1.description', 'error', /KMS § 37 lg 7 p 5/)
    expectIssue(inv, 'lines.1.quantity', 'error')
    expectIssue(inv, 'lines.1.unitPrice', 'error', /p 7/)
    expectIssue(inv, 'lines.1.unit', 'warning')
  })
  it('warns about zero unit price', () => {
    const inv = baseInvoice()
    inv.lines[0].unitPrice = 0
    expectIssue(inv, 'lines.0.unitPrice', 'warning')
  })
  it('validates discount range', () => {
    const inv = baseInvoice()
    inv.lines[0].discountPercent = 120
    expectIssue(inv, 'lines.0.discountPercent', 'error')
    inv.lines[0].discountPercent = 100
    expectNoIssue(inv, 'lines.0.discountPercent')
  })
  it('warns about a negative invoice total', () => {
    const inv = baseInvoice()
    inv.lines[0].quantity = -1
    expectIssue(inv, 'lines', 'warning')
  })
})

describe('validateInvoice – credit notes', () => {
  it('requires a reference to the original invoice', () => {
    const inv = baseInvoice()
    inv.type = 'credit-note'
    inv.lines[0].quantity = -1
    expectIssue(inv, 'creditedInvoiceNumber', 'error', /KMS § 37 lg 4/)
    inv.creditedInvoiceNumber = inv.number
    expectIssue(inv, 'creditedInvoiceNumber', 'error')
  })
  it('warns when a credit note total is positive', () => {
    const inv = baseInvoice()
    inv.type = 'credit-note'
    inv.creditedInvoiceNumber = '2025-0099'
    expectIssue(inv, 'lines', 'warning')
  })
})

describe('validateInvoice – payment details', () => {
  it('validates the reference number', () => {
    const inv = baseInvoice()
    inv.referenceNumber = '121312953'
    expectIssue(inv, 'referenceNumber', 'error')
    inv.referenceNumber = '121312952'
    expectNoIssue(inv, 'referenceNumber')
  })
  it('validates late interest', () => {
    const inv = baseInvoice()
    inv.lateInterestPercentPerDay = -1
    expectIssue(inv, 'lateInterestPercentPerDay', 'error')
    inv.lateInterestPercentPerDay = 2
    expectIssue(inv, 'lateInterestPercentPerDay', 'warning')
    inv.lateInterestPercentPerDay = 0.05
    expectNoIssue(inv, 'lateInterestPercentPerDay')
  })
})

describe('validateInvoice – messages', () => {
  it('returns bilingual messages for every issue', () => {
    const inv = baseInvoice()
    inv.number = ''
    inv.seller.name = ''
    inv.buyer.name = ''
    inv.lines = []
    const issues = run(inv)
    expect(issues.length).toBeGreaterThanOrEqual(4)
    for (const i of issues) {
      expect(i.message.et).toBeTruthy()
      expect(i.message.en).toBeTruthy()
      expect(i.message.et).not.toBe(i.message.en)
    }
  })
})
