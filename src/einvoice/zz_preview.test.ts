import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { buildUblXml } from './ubl'
import { creditNoteInvoice, line, notRegisteredInvoice, sampleInvoice } from '../pdf/testFixtures'

it('xml preview', () => {
  const out = '/tmp/claude-0/-home-user-invoice-generator/cf206b96-b2bd-579a-af0b-e143ccf29ea0/scratchpad/xml/'
  const s = sampleInvoice()
  const fiBuyer = { ...s.buyer, name: 'Suomi Oy', registryCode: '1234567-8', vatNumber: 'FI12345678', address: { street: 'Katu 1', city: 'Helsinki', postalCode: '00100', country: 'FI' } }
  const cases: Record<string, ReturnType<typeof sampleInvoice>> = {
    domestic: s,
    credit: creditNoteInvoice(),
    creditDiscount: creditNoteInvoice({ lines: [line({ id: 'c1', quantity: -3, unitPrice: 33.33, discountPercent: 15, vatRate: 24 })] }),
    notreg: notRegisteredInvoice(),
    rc: sampleInvoice({ vatScheme: 'eu-reverse-charge', buyer: fiBuyer, lines: s.lines.map((l) => ({ ...l, vatRate: 0 })) }),
    goods: sampleInvoice({ vatScheme: 'eu-goods', supplyDate: undefined, periodStart: undefined, periodEnd: undefined, buyer: fiBuyer }),
    export: sampleInvoice({ vatScheme: 'export', buyer: { ...fiBuyer, vatNumber: undefined, address: { ...fiBuyer.address, country: 'US' } } }),
    exempt: sampleInvoice({ vatScheme: 'exempt', vatExemptionNote: 'KMS § 16 lg 2 p 1' }),
    drc: sampleInvoice({ vatScheme: 'domestic-reverse-charge' }),
    prepay: sampleInvoice({ type: 'prepayment', lines: [line({ id: 'p', unitPrice: -50 }), line({ id: 'q', unitPrice: 200, vatRate: 0 })] }),
    pdf: sampleInvoice({ notes: undefined, orderReference: undefined, buyer: { ...s.buyer, contactPerson: undefined } }),
  }
  for (const [k, inv] of Object.entries(cases)) writeFileSync(out + k + '.xml', buildUblXml(inv, k === 'pdf' ? { pdf: { base64: 'JVBERi0xLjQK', fileName: 'Arve_2026-0007_Klient.pdf' } } : {}))
})
