import { describe, expect, it } from 'vitest'
import { computeTotals } from '../domain'
import type { Invoice } from '../domain/types'
import { creditNoteInvoice, line, notRegisteredInvoice, sampleInvoice } from '../pdf/testFixtures'
import { unitCode } from './codes'
import { buildUblXml, eInvoiceIssues, PEPPOL_CUSTOMIZATION_ID, PEPPOL_PROFILE_ID } from './ubl'
import { escapeXml } from './xml'

function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const err = doc.getElementsByTagName('parsererror')[0]
  if (err) throw new Error(`XML not well-formed: ${err.textContent}`)
  return doc
}

const all = (node: Document | Element, name: string) => Array.from(node.getElementsByTagName(name))
const one = (node: Document | Element, name: string) => {
  const found = all(node, name)[0]
  if (!found) throw new Error(`missing <${name}>`)
  return found
}
const txt = (node: Document | Element, name: string) => one(node, name).textContent ?? ''
/** Direct child by qualified name. */
const child = (node: Element, name: string) => Array.from(node.children).find((c) => c.tagName === name)
const num = (s: string | null | undefined) => Number(s)

const fiBuyer = (overrides: Partial<Invoice['buyer']> = {}): Invoice['buyer'] => ({
  kind: 'company',
  name: 'Suomi Oy',
  registryCode: '1234567-8',
  vatNumber: 'FI12345678',
  address: { street: 'Katu 1', city: 'Helsinki', postalCode: '00100', country: 'FI' },
  ...overrides,
})

describe('buildUblXml — invoice', () => {
  const inv = sampleInvoice()
  const xml = buildUblXml(inv)
  const doc = parse(xml)
  const root = doc.documentElement
  const totals = computeTotals(inv)

  it('is a Peppol BIS 3 UBL Invoice', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(root.localName).toBe('Invoice')
    expect(root.namespaceURI).toBe('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2')
    expect(child(root, 'cbc:CustomizationID')?.textContent).toBe(PEPPOL_CUSTOMIZATION_ID)
    expect(child(root, 'cbc:ProfileID')?.textContent).toBe(PEPPOL_PROFILE_ID)
    expect(child(root, 'cbc:ID')?.textContent).toBe('2026-0007')
    expect(child(root, 'cbc:IssueDate')?.textContent).toBe('2026-10-12')
    expect(child(root, 'cbc:DueDate')?.textContent).toBe('2026-10-26')
    expect(child(root, 'cbc:InvoiceTypeCode')?.textContent).toBe('380')
    expect(child(root, 'cbc:DocumentCurrencyCode')?.textContent).toBe('EUR')
    // PEPPOL-EN16931-R003 (buyer reference or order reference) + R002 (max one note)
    expect(child(root, 'cbc:BuyerReference')?.textContent).toBe('Mari Mänd')
    expect(txt(child(root, 'cac:OrderReference')!, 'cbc:ID')).toBe('PO-77/2026')
    expect(all(doc, 'cbc:Note').filter((n) => n.parentElement === root)).toHaveLength(1)
    expect(txt(child(root, 'cac:InvoicePeriod')!, 'cbc:StartDate')).toBe('2026-09-01')
    expect(txt(child(root, 'cac:Delivery')!, 'cbc:ActualDeliveryDate')).toBe('2026-10-10')
  })

  it('identifies seller and buyer (EndpointID 0191, VAT, legal entity)', () => {
    const seller = one(doc, 'cac:AccountingSupplierParty')
    const ep = one(seller, 'cbc:EndpointID')
    expect(ep.getAttribute('schemeID')).toBe('0191')
    expect(ep.textContent).toBe('12345678')
    expect(txt(one(seller, 'cac:PartyTaxScheme'), 'cbc:CompanyID')).toBe('EE123456789')
    expect(txt(one(seller, 'cac:PartyTaxScheme'), 'cbc:ID')).toBe('VAT')
    expect(txt(seller, 'cbc:RegistrationName')).toBe('Õunapuu & Šokolaad OÜ')
    expect(one(one(seller, 'cac:PartyLegalEntity'), 'cbc:CompanyID').getAttribute('schemeID')).toBe('0191')
    expect(txt(seller, 'cbc:IdentificationCode')).toBe('EE')
    const buyer = one(doc, 'cac:AccountingCustomerParty')
    expect(txt(buyer, 'cbc:EndpointID')).toBe('87654321')
    expect(txt(one(buyer, 'cac:PartyTaxScheme'), 'cbc:CompanyID')).toBe('EE987654321')
    expect(txt(one(buyer, 'cac:Contact'), 'cbc:Name')).toBe('Mari Mänd')
  })

  it('has SEPA credit transfer payment means with IBAN and reference number', () => {
    const pm = all(doc, 'cac:PaymentMeans')
    expect(pm).toHaveLength(1) // only the selected bank account
    expect(txt(pm[0], 'cbc:PaymentMeansCode')).toBe('58')
    expect(txt(pm[0], 'cbc:PaymentID')).toBe('20260007')
    expect(txt(one(pm[0], 'cac:PayeeFinancialAccount'), 'cbc:ID')).toBe('EE717700771001234567')
    expect(txt(one(pm[0], 'cac:FinancialInstitutionBranch'), 'cbc:ID')).toBe('LHVBEE22')
    expect(txt(one(doc, 'cac:PaymentTerms'), 'cbc:Note')).toContain('26.10.2026')
  })

  it('has VAT breakdown and totals equal to computeTotals', () => {
    const taxTotals = all(doc, 'cac:TaxTotal')
    expect(taxTotals).toHaveLength(1)
    expect(num(child(taxTotals[0], 'cbc:TaxAmount')?.textContent)).toBe(totals.vat)
    const subs = all(doc, 'cac:TaxSubtotal')
    expect(subs.map((s) => [num(txt(s, 'cbc:Percent')), num(txt(s, 'cbc:TaxableAmount')), num(txt(s, 'cbc:TaxAmount')), txt(s, 'cbc:ID')])).toEqual(
      totals.vatBreakdown.map((r) => [r.rate, r.taxable, r.vat, 'S']),
    )
    const lmt = one(doc, 'cac:LegalMonetaryTotal')
    expect(num(txt(lmt, 'cbc:LineExtensionAmount'))).toBe(totals.net)
    expect(num(txt(lmt, 'cbc:TaxExclusiveAmount'))).toBe(totals.net)
    expect(num(txt(lmt, 'cbc:TaxInclusiveAmount'))).toBe(totals.gross)
    expect(num(txt(lmt, 'cbc:PayableAmount'))).toBe(totals.gross)
    for (const a of all(doc, '*').filter((e) => e.hasAttribute('currencyID'))) expect(a.getAttribute('currencyID')).toBe('EUR')
    for (const a of ['cbc:TaxAmount', 'cbc:TaxableAmount', 'cbc:LineExtensionAmount', 'cbc:PayableAmount', 'cbc:Amount', 'cbc:BaseAmount']) {
      for (const e of all(doc, a)) expect(e.textContent).toMatch(/^-?\d+\.\d{2}$/)
    }
  })

  it('has lines consistent with PEPPOL-EN16931-R120 (qty × price − allowance = net)', () => {
    const lines = all(doc, 'cac:InvoiceLine')
    expect(lines).toHaveLength(3)
    let sum = 0
    lines.forEach((l, i) => {
      const net = num(child(l, 'cbc:LineExtensionAmount')?.textContent)
      sum += net
      expect(net).toBe(totals.lines[i].net)
      const qty = num(txt(l, 'cbc:InvoicedQuantity'))
      const price = num(txt(one(l, 'cac:Price'), 'cbc:PriceAmount'))
      const ac = child(l, 'cac:AllowanceCharge')
      const allowance = ac ? num(txt(ac, 'cbc:Amount')) : 0
      expect(Math.abs(qty * price - allowance - net)).toBeLessThanOrEqual(0.02)
      if (ac) {
        expect(txt(ac, 'cbc:ChargeIndicator')).toBe('false')
        expect(txt(ac, 'cbc:AllowanceChargeReasonCode')).toBe('95')
        expect(Math.abs((num(txt(ac, 'cbc:BaseAmount')) * num(txt(ac, 'cbc:MultiplierFactorNumeric'))) / 100 - allowance)).toBeLessThanOrEqual(0.02)
      }
    })
    expect(Math.round(sum * 100) / 100).toBe(totals.net)
    expect(one(lines[0], 'cbc:InvoicedQuantity').getAttribute('unitCode')).toBe('HUR')
    expect(txt(one(lines[1], 'cac:ClassifiedTaxCategory'), 'cbc:Percent')).toBe('13')
  })

  it('escapes special characters and round-trips text', () => {
    expect(xml).toContain('Raamat &quot;Šifrid &amp; &lt;koodid&gt;&quot;')
    expect(txt(all(doc, 'cac:InvoiceLine')[2], 'cbc:Name')).toBe('Raamat "Šifrid & <koodid>"')
    expect(txt(doc, 'cbc:RegistrationName')).toBe('Õunapuu & Šokolaad OÜ')
  })

  it('never contains empty elements (PEPPOL-EN16931-R008)', () => {
    for (const e of all(doc, '*')) expect(e.children.length > 0 || (e.textContent ?? '').trim() !== '', e.tagName).toBe(true)
  })
})

describe('buildUblXml — text rows', () => {
  it('puts the text rows and notes into the one document-level cbc:Note, escaped, in reading order', () => {
    const inv = sampleInvoice({ textBefore: ['Leping <12/2026> & lisa', ' '], textAfter: ['Täname!\nTeine rida'], notes: 'Märkus' })
    const xml = buildUblXml(inv)
    expect(xml).toContain('Leping &lt;12/2026&gt; &amp; lisa')
    const root = parse(xml).documentElement
    const notes = all(root, 'cbc:Note').filter((n) => n.parentElement === root)
    expect(notes).toHaveLength(1)
    expect(notes[0].textContent).toBe('Leping <12/2026> & lisa\n\nTäname!\nTeine rida\n\nMärkus')
    const only = parse(buildUblXml(sampleInvoice({ notes: undefined, textAfter: ['Ainult see'] }))).documentElement
    expect(all(only, 'cbc:Note').filter((n) => n.parentElement === only).map((n) => n.textContent)).toEqual(['Ainult see'])
    const none = parse(buildUblXml(sampleInvoice({ notes: undefined, textBefore: [''] }))).documentElement
    expect(all(none, 'cbc:Note').filter((n) => n.parentElement === none)).toHaveLength(0)
  })
})

describe('buildUblXml — credit note', () => {
  const inv = creditNoteInvoice()
  const doc = parse(buildUblXml(inv))
  const root = doc.documentElement

  it('is a UBL CreditNote with positive amounts and a billing reference', () => {
    expect(root.localName).toBe('CreditNote')
    expect(root.namespaceURI).toBe('urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2')
    expect(child(root, 'cbc:CreditNoteTypeCode')?.textContent).toBe('381')
    expect(child(root, 'cbc:DueDate')).toBeUndefined()
    expect(txt(one(doc, 'cac:PaymentMeans'), 'cbc:PaymentDueDate')).toBe('2026-10-26')
    expect(txt(one(doc, 'cac:InvoiceDocumentReference'), 'cbc:ID')).toBe('2026-0007')
    const totals = computeTotals(inv)
    expect(totals.gross).toBeLessThan(0)
    expect(num(txt(one(doc, 'cac:LegalMonetaryTotal'), 'cbc:PayableAmount'))).toBe(-totals.gross)
    const l = one(doc, 'cac:CreditNoteLine')
    expect(num(txt(l, 'cbc:CreditedQuantity'))).toBe(2)
    expect(num(txt(l, 'cbc:LineExtensionAmount'))).toBe(130)
    expect(num(txt(one(doc, 'cac:TaxSubtotal'), 'cbc:TaxAmount'))).toBe(31.2)
  })
})

describe('buildUblXml — VAT schemes', () => {
  const category = (inv: Invoice) => {
    const doc = parse(buildUblXml(inv))
    const sub = one(doc, 'cac:TaxSubtotal')
    return { doc, id: txt(sub, 'cbc:ID'), percent: all(sub, 'cbc:Percent')[0]?.textContent ?? null, code: all(sub, 'cbc:TaxExemptionReasonCode')[0]?.textContent ?? null, reason: all(sub, 'cbc:TaxExemptionReason')[0]?.textContent ?? null }
  }

  it('not registered → O without percent and without any VAT identifiers', () => {
    const c = category(notRegisteredInvoice())
    expect(c).toMatchObject({ id: 'O', percent: null, code: 'VATEX-EU-O' })
    expect(c.reason).toMatch(/käibemaksukohustuslas/)
    expect(all(c.doc, 'cac:PartyTaxScheme')).toHaveLength(0)
    expect(all(c.doc, 'cac:ClassifiedTaxCategory').every((e) => !child(e, 'cbc:Percent'))).toBe(true)
    expect(num(txt(c.doc, 'cbc:TaxAmount'))).toBe(0)
  })

  it('EU reverse charge → AE 0% with VATEX-EU-AE; buyer VAT endpoint', () => {
    const c = category(sampleInvoice({ vatScheme: 'eu-reverse-charge', buyer: fiBuyer(), lines: [line({ id: 'a', vatRate: 0 })] }))
    expect(c).toMatchObject({ id: 'AE', percent: '0', code: 'VATEX-EU-AE' })
    const ep = one(one(c.doc, 'cac:AccountingCustomerParty'), 'cbc:EndpointID')
    expect([ep.getAttribute('schemeID'), ep.textContent]).toEqual(['0213', 'FI12345678'])
  })

  it('domestic reverse charge → AE', () => {
    expect(category(sampleInvoice({ vatScheme: 'domestic-reverse-charge' })).id).toBe('AE')
  })

  it('intra-Community goods → K with delivery date and country (BR-IC-11/12)', () => {
    const c = category(sampleInvoice({ vatScheme: 'eu-goods', buyer: fiBuyer(), supplyDate: undefined, periodStart: undefined, periodEnd: undefined }))
    expect(c).toMatchObject({ id: 'K', percent: '0', code: 'VATEX-EU-IC' })
    const delivery = one(c.doc, 'cac:Delivery')
    expect(txt(delivery, 'cbc:ActualDeliveryDate')).toBe('2026-10-12')
    expect(txt(one(delivery, 'cac:DeliveryLocation'), 'cbc:IdentificationCode')).toBe('FI')
  })

  it('export → G, exempt → E with the custom legal basis, domestic 0% → Z', () => {
    expect(category(sampleInvoice({ vatScheme: 'non-eu-services', buyer: fiBuyer({ address: { street: 'X', city: 'NYC', postalCode: '1', country: 'US' } }) }))).toMatchObject({ id: 'G', code: 'VATEX-EU-G' })
    expect(category(sampleInvoice({ vatScheme: 'export', buyer: fiBuyer({ address: { street: 'X', city: 'NYC', postalCode: '1', country: 'US' } }) }))).toMatchObject({ id: 'G', code: 'VATEX-EU-G' })
    expect(category(sampleInvoice({ vatScheme: 'exempt', vatExemptionNote: 'KMS § 16 lg 2 p 1' }))).toMatchObject({ id: 'E', percent: '0', reason: 'KMS § 16 lg 2 p 1' })
    const z = category(sampleInvoice({ lines: [line({ id: 'z', vatRate: 0 })] }))
    expect(z).toMatchObject({ id: 'Z', percent: '0', code: null, reason: null })
  })

  it('prepayment invoice → type code 386', () => {
    const doc = parse(buildUblXml(sampleInvoice({ type: 'prepayment' })))
    expect(txt(doc, 'cbc:InvoiceTypeCode')).toBe('386')
  })
})

describe('buildUblXml — options and edge cases', () => {
  it('embeds the PDF as an attachment', () => {
    const doc = parse(buildUblXml(sampleInvoice(), { pdf: { base64: 'JVBERi0xLjQK', fileName: 'Arve_2026-0007_Klient.pdf' } }))
    const obj = one(one(doc, 'cac:AdditionalDocumentReference'), 'cbc:EmbeddedDocumentBinaryObject')
    expect(obj.getAttribute('mimeCode')).toBe('application/pdf')
    expect(obj.getAttribute('filename')).toBe('Arve_2026-0007_Klient.pdf')
    expect(obj.textContent).toBe('JVBERi0xLjQK')
  })

  it('falls back to a buyer reference when neither contact person nor order reference exist', () => {
    const base = sampleInvoice()
    const doc = parse(buildUblXml({ ...base, orderReference: undefined, buyer: { ...base.buyer, contactPerson: undefined } }))
    expect(txt(doc, 'cbc:BuyerReference')).toBe('2026-0007')
    expect(all(doc, 'cac:OrderReference')).toHaveLength(0)
  })

  it('moves a negative unit price into the quantity (BR-27)', () => {
    const doc = parse(buildUblXml(sampleInvoice({ lines: [line({ id: 'a', unitPrice: 100 }), line({ id: 'b', quantity: 1, unitPrice: -20 })] })))
    const l = all(doc, 'cac:InvoiceLine')[1]
    expect(txt(l, 'cbc:InvoicedQuantity')).toBe('-1')
    expect(txt(l, 'cbc:PriceAmount')).toBe('20')
    expect(txt(l, 'cbc:LineExtensionAmount')).toBe('-20.00')
  })

  it('removes characters that are invalid in XML', () => {
    expect(escapeXml('a\u0000b\u0007c & d\n')).toBe('abc &amp; d\n')
    const doc = parse(buildUblXml(sampleInvoice({ notes: 'Rida\u0001 <b>' })))
    expect(txt(doc, 'cbc:Note')).toBe('Rida <b>')
  })

  it('maps units to UN/ECE Rec 20 codes', () => {
    expect(['h', 'tk', 'kuu', 'päev', 'km', 'kg', 'l', 'm²', 'midagi'].map(unitCode)).toEqual(['HUR', 'H87', 'MON', 'DAY', 'KMT', 'KGM', 'LTR', 'MTK', 'C62'])
  })
})

describe('eInvoiceIssues', () => {
  it('is empty for a complete domestic invoice', () => {
    expect(eInvoiceIssues(sampleInvoice())).toEqual([])
  })

  it('flags drafts and buyers without an electronic address', () => {
    const fields = eInvoiceIssues(
      sampleInvoice({ number: '', buyer: { kind: 'person', name: 'Jaan Tamm', personalCode: '38001010000', address: { street: 'A', city: 'B', postalCode: '1', country: 'EE' } } }),
    ).map((i) => i.field)
    expect(fields).toEqual(['number', 'buyer.registryCode'])
  })

  it('explains the missing address differently for private persons and foreign companies', () => {
    const person = eInvoiceIssues(
      sampleInvoice({ buyer: { kind: 'person', name: 'Jaan Tamm', address: { street: 'A', city: 'B', postalCode: '1', country: 'EE' } } }),
    )
    expect(person[0].message.en).toContain('Private persons')
    const us = eInvoiceIssues(sampleInvoice({ buyer: { kind: 'company', name: 'Acme Inc.', address: { street: '1 Main St', city: 'Austin', postalCode: '78701', country: 'US' } } }))
    expect(us.map((i) => i.field)).toEqual(['buyer.registryCode'])
    expect(us[0].message.en).not.toContain('Private persons')
    expect(us[0].message.en).toContain('no Peppol electronic address')
    expect(us[0].message.et).toContain('Ostjal puudub e-arve aadress')
  })

  it('asks for the buyer VAT number by VAT treatment, without calling every one of them reverse charge', () => {
    const noIds = { kind: 'company' as const, name: 'Käufer GmbH', address: { street: 'A 1', city: 'Berlin', postalCode: '10115', country: 'DE' } }
    for (const vatScheme of ['eu-goods', 'eu-reverse-charge', 'domestic-reverse-charge'] as const) {
      const issue = eInvoiceIssues(sampleInvoice({ vatScheme, buyer: noIds })).find((i) => i.field === 'buyer.vatNumber')
      expect(issue?.message, vatScheme).toEqual({ et: 'Selle käibemaksurežiimi puhul on vaja ostja KMKR numbrit.', en: 'This VAT treatment requires the buyer VAT number.' })
    }
  })

  it('asks for the EUR VAT only when the exchange rate is missing, since the XML adds it otherwise', () => {
    const fields = (inv: Invoice) => eInvoiceIssues(inv).map((i) => i.field)
    const missing = eInvoiceIssues(sampleInvoice({ currency: 'USD' })).find((i) => i.field === 'currency')
    expect(missing?.message.et).toContain('E-arvele lisatakse see ainult siis, kui euro vahetuskurss on sisestatud.')
    expect(fields(sampleInvoice({ currency: 'USD', eurExchangeRate: 1.25 }))).not.toContain('currency')
    expect(fields(sampleInvoice({ currency: 'USD', eurExchangeRate: 0 }))).toContain('currency')
    expect(fields(sampleInvoice({ currency: 'USD', vatScheme: 'export' }))).not.toContain('currency')
    expect(fields(sampleInvoice())).not.toContain('currency')
  })
})

describe('buildUblXml — foreign currency', () => {
  it('adds the EUR VAT total (BR-53) when an exchange rate is given', () => {
    const inv = sampleInvoice({ currency: 'USD', eurExchangeRate: 1.25 })
    const xml = buildUblXml(inv)
    const vat = computeTotals(inv).vat
    expect(xml).toContain('<cbc:TaxCurrencyCode>EUR</cbc:TaxCurrencyCode>')
    expect(xml).toContain(`<cbc:TaxAmount currencyID="EUR">${(Math.round((vat / 1.25) * 100) / 100).toFixed(2)}</cbc:TaxAmount>`)
  })
  it('omits it for EUR invoices', () => {
    expect(buildUblXml(sampleInvoice())).not.toContain('TaxCurrencyCode')
  })
})
