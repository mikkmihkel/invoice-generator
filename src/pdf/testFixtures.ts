// Test fixtures for documents (PDF + e-invoice). Not imported by app code.
import type { Invoice, InvoiceLine } from '../domain/types'

/** 1×1 transparent PNG. */
export const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export function line(partial: Partial<InvoiceLine> & Pick<InvoiceLine, 'id'>): InvoiceLine {
  return { description: 'Teenus', quantity: 1, unit: 'tk', unitPrice: 100, vatRate: 24, ...partial }
}

export function sampleInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    number: '2026-0007',
    type: 'invoice',
    status: 'issued',
    issueDate: '2026-10-12',
    dueDate: '2026-10-26',
    supplyDate: '2026-10-10',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    seller: {
      name: 'Õunapuu & Šokolaad OÜ',
      registryCode: '12345678',
      vatNumber: 'EE123456789',
      vatRegistered: true,
      address: { street: 'Pärnu mnt 15-3', city: 'Tallinn', postalCode: '10141', county: 'Harju maakond', country: 'EE' },
      email: 'arved@ounapuu.ee',
      phone: '+372 5555 1234',
      website: 'https://ounapuu.ee',
      bankAccounts: [
        { id: 'b1', bankName: 'LHV Pank', iban: 'EE717700771001234567', bic: 'LHVBEE22' },
        { id: 'b2', bankName: 'Swedbank', iban: 'EE382200221020145685', bic: 'HABAEE2X' },
      ],
      logoDataUrl: TINY_PNG,
    },
    buyer: {
      kind: 'company',
      name: 'Klient Žürii OÜ',
      registryCode: '87654321',
      vatNumber: 'EE987654321',
      address: { street: 'Tähe 4', city: 'Tartu', postalCode: '50103', country: 'EE' },
      email: 'raamatupidamine@klient.ee',
      contactPerson: 'Mari Mänd',
    },
    bankAccountIds: ['b1'],
    lines: [
      line({ id: 'l1', description: 'Veebilehe arendus – õõtsuv ülesanne', quantity: 12.5, unit: 'h', unitPrice: 65, vatRate: 24 }),
      line({ id: 'l2', description: 'Majutus (hotell)', quantity: 2, unit: 'öö', unitPrice: 80.5, vatRate: 13, discountPercent: 10 }),
      line({ id: 'l3', description: 'Raamat "Šifrid & <koodid>"', quantity: 1, unit: 'tk', unitPrice: 1234.567, vatRate: 9 }),
    ],
    currency: 'EUR',
    vatScheme: 'domestic',
    referenceNumber: '20260007',
    orderReference: 'PO-77/2026',
    notes: 'Täname koostöö eest! Ärge unustage: ÕÄÖÜ šž €.',
    lateInterestPercentPerDay: 0.05,
    footerNote: 'Õunapuu & Šokolaad OÜ — parim šokolaad Eestis',
    language: 'et',
    templateId: 'classic',
    accentColor: '#1f6feb',
    issuedAt: '2026-10-12T10:00:00.000Z',
    createdAt: '2026-10-12T09:00:00.000Z',
    updatedAt: '2026-10-12T10:00:00.000Z',
    ...overrides,
  }
}

export function notRegisteredInvoice(overrides: Partial<Invoice> = {}): Invoice {
  const base = sampleInvoice()
  return sampleInvoice({
    seller: { ...base.seller, vatRegistered: false, vatNumber: undefined },
    vatScheme: 'not-registered',
    lines: base.lines.map((l) => ({ ...l, vatRate: 0 })),
    ...overrides,
  })
}

export function creditNoteInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return sampleInvoice({
    id: 'inv-2',
    number: '2026-0008',
    type: 'credit-note',
    creditedInvoiceNumber: '2026-0007',
    lines: [line({ id: 'c1', description: 'Veebilehe arendus (krediteerimine)', quantity: -2, unit: 'h', unitPrice: 65, vatRate: 24 })],
    ...overrides,
  })
}
