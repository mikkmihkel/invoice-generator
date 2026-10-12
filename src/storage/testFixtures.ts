// Test-only fixtures (imported from *.test.ts files only).
import type { Client, CompanyProfile, Invoice } from '../domain/types'

export function makeProfile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    name: 'Mänguasjad OÜ',
    registryCode: '16123450',
    vatNumber: 'EE102345676',
    vatRegistered: true,
    address: { street: 'Narva mnt 5-12', city: 'Tallinn', postalCode: '10117', country: 'EE' },
    email: 'arved@example.ee',
    bankAccounts: [{ id: 'acc1', bankName: 'LHV', iban: 'EE382200221020145685' }],
    defaults: {
      paymentTermDays: 14,
      templateId: 'classic',
      accentColor: '#1f6feb',
      language: 'et',
      currency: 'EUR',
      vatScheme: 'domestic',
      defaultVatRate: 24,
      defaultUnit: 'h',
      emailSubject: 'Arve {number}',
      emailBody: 'Tere!',
    },
    numbering: { prefix: '{YYYY}-', nextNumber: 1, padding: 4 },
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export function makeClient(id: string, overrides: Partial<Client> = {}): Client {
  return {
    id,
    kind: 'company',
    name: `Klient ${id} AS`,
    registryCode: '10987651',
    vatNumber: 'EE101987653',
    address: { street: 'Pikk 1', city: 'Tartu', postalCode: '51004', country: 'EE' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export function makeInvoice(id: string, overrides: Partial<Invoice> = {}): Invoice {
  const profile = makeProfile()
  return {
    id,
    number: '',
    type: 'invoice',
    status: 'draft',
    issueDate: '2026-03-10',
    dueDate: '2026-03-24',
    seller: {
      name: profile.name,
      registryCode: profile.registryCode,
      vatNumber: profile.vatNumber,
      vatRegistered: true,
      address: profile.address,
      bankAccounts: profile.bankAccounts,
    },
    buyer: {
      clientId: 'c1',
      kind: 'company',
      name: 'Klient c1 AS',
      registryCode: '10987651',
      vatNumber: 'EE101987653',
      address: { street: 'Pikk 1', city: 'Tartu', postalCode: '51004', country: 'EE' },
    },
    bankAccountIds: [],
    lines: [{ id: 'l1', description: 'Konsultatsioon', quantity: 2, unit: 'h', unitPrice: 50, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic',
    language: 'et',
    templateId: 'classic',
    accentColor: '#1f6feb',
    createdAt: '2026-03-10T08:00:00.000Z',
    updatedAt: '2026-03-10T08:00:00.000Z',
    ...overrides,
  }
}
