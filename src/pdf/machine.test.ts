import { beforeAll, describe, expect, it, vi } from 'vitest'
import { computeTotals, createDefaultProfile, createEmptyInvoice, isValidIban } from '../domain'
import type { Invoice, InvoiceLanguage } from '../domain/types'
import { validateBackup } from '../storage/backup'
import { makeInvoice, makeProfile } from '../storage/testFixtures'
import { formatAmount, formatDate } from './format'
import { translator, type LabelKey } from './labels'
import {
  embeddedXmlFileName,
  epcPayload,
  epcQrPayload,
  EPC_LIMITS,
  isRfCreditorReference,
  paymentQrEnabled,
  paymentQrPayload,
  pdfLanguage,
  pdfMetadata,
  withMachineLayer,
} from './machine'
import { buildRenderDefinition, renderInvoicePdf } from './render'
import { TEMPLATES } from './templates'
import { blobBytes, extractPdf, normalizeSpaces, type ExtractedPdf } from './testing/extract'
import { creditNoteInvoice, line, sampleInvoice } from './testFixtures'

const utf8 = (s: string) => new TextEncoder().encode(s).length

/** Sample invoice whose bank accounts have valid IBANs (the shared fixture's first IBAN fails mod-97). */
function payable(overrides: Partial<Invoice> = {}): Invoice {
  const base = sampleInvoice()
  return sampleInvoice({
    seller: {
      ...base.seller,
      bankAccounts: [
        { id: 'b1', bankName: 'SEB Pank', iban: 'EE471000001020145685', bic: 'EEUHEE2X' },
        { id: 'b2', bankName: 'Swedbank', iban: 'EE382200221020145685', bic: 'HABAEE2X' },
      ],
    },
    ...overrides,
  })
}
const IBAN = 'EE471000001020145685'
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Regex source matching `s` with any whitespace (incl. line breaks) where `s` has spaces. */
const loose = (s: string) => esc(normalizeSpaces(s).trim()).replace(/ /g, '\\s+')

// ---------------------------------------------------------------------------------------------------------
// EPC069-12 payload
// ---------------------------------------------------------------------------------------------------------

describe('epcPayload (EPC069-12 v002)', () => {
  it('reproduces the published UTF-8 example (Wikimedia donation, as decoded in the segno docs)', () => {
    expect(epcPayload({ name: 'Wikimedia Foerdergesellschaft', iban: 'DE33100205000001194700', amount: 13.05, text: 'Spende fuer Wikipedia' })).toBe(
      ['BCD', '002', '1', 'SCT', '', 'Wikimedia Foerdergesellschaft', 'DE33100205000001194700', 'EUR13.05', '', '', 'Spende fuer Wikipedia'].join('\n'),
    )
  })

  it('has the EPC field order with BIC, purpose and LF separators and no trailing separator', () => {
    const p = epcPayload({ bic: 'bpot beb1', name: 'Red Cross of Belgium', iban: 'BE72 0000 0000 1616', amount: 1, purpose: 'char', text: 'Urgency fundraising Haiti' })
    expect(p).toBe('BCD\n002\n1\nSCT\nBPOTBEB1\nRed Cross of Belgium\nBE72000000001616\nEUR1.00\nCHAR\n\nUrgency fundraising Haiti')
    expect(p).not.toMatch(/\r|\n$/)
  })

  it('uses the structured element only for ISO 11649 RF references and then omits the text', () => {
    expect(isRfCreditorReference('RF18 5390 0754 7034')).toBe(true)
    expect(isRfCreditorReference('RF19 5390 0754 7034')).toBe(false)
    expect(isRfCreditorReference('20260007')).toBe(false)
    const p = epcPayload({ name: 'A', iban: 'EE382200221020145685', amount: 5, reference: 'RF18 5390 0754 7034', text: 'ignored' })!
    expect(p.split('\n')).toEqual(['BCD', '002', '1', 'SCT', '', 'A', 'EE382200221020145685', 'EUR5.00', '', 'RF18539007547034'])
  })

  it('enforces length and size limits', () => {
    const p = epcPayload({ name: 'Õ'.repeat(100), iban: 'EE382200221020145685', amount: EPC_LIMITS.maxAmount, text: 'š'.repeat(300) })!
    const parts = p.split('\n')
    expect(Array.from(parts[5])).toHaveLength(70)
    expect(parts[7]).toBe('EUR999999999.99')
    expect(Array.from(parts[10]).length).toBeLessThanOrEqual(140)
    expect(utf8(p)).toBeLessThanOrEqual(331)
    // ASCII text keeps the full 140 characters.
    const ascii = epcPayload({ name: 'A', iban: 'EE382200221020145685', amount: 1, text: 'x'.repeat(300) })!
    expect(ascii.split('\n')[10]).toHaveLength(140)
  })

  it('rejects amounts outside 0.01–999 999 999.99 and missing name/IBAN; strips line breaks from text', () => {
    const base = { name: 'A', iban: 'EE382200221020145685', text: 't' }
    expect(epcPayload({ ...base, amount: 0 })).toBeNull()
    expect(epcPayload({ ...base, amount: 0.004 })).toBeNull()
    expect(epcPayload({ ...base, amount: -5 })).toBeNull()
    expect(epcPayload({ ...base, amount: 1_000_000_000 })).toBeNull()
    expect(epcPayload({ ...base, amount: Number.NaN })).toBeNull()
    expect(epcPayload({ ...base, amount: 0.01 })).toContain('\nEUR0.01\n')
    expect(epcPayload({ ...base, name: '  ', amount: 1 })).toBeNull()
    expect(epcPayload({ ...base, iban: '', amount: 1 })).toBeNull()
    expect(epcPayload({ ...base, amount: 1, text: 'a\nb\r\nc' })!.split('\n')[10]).toBe('a b c')
    expect(epcPayload({ ...base, amount: 1, bic: 'NOT-A-BIC' })!.split('\n')[4]).toBe('')
  })
})

describe('epcQrPayload (invoice)', () => {
  it('builds the payload from the first selected account, seller name, total and remittance text', () => {
    const inv = payable()
    const total = computeTotals(inv).gross
    expect(epcQrPayload(inv)).toBe(
      ['BCD', '002', '1', 'SCT', 'EEUHEE2X', 'Õunapuu & Šokolaad OÜ', IBAN, `EUR${total.toFixed(2)}`, '', '', 'Arve 2026-0007, viitenumber 20260007'].join('\n'),
    )
    expect(epcQrPayload(payable({ language: 'en' }))!.split('\n')[10]).toBe('Invoice 2026-0007, reference 20260007')
    expect(epcQrPayload(payable({ referenceNumber: undefined }))!.split('\n')[10]).toBe('Arve 2026-0007')
  })

  it('puts an RF creditor reference into the structured element', () => {
    const lines = epcQrPayload(payable({ referenceNumber: 'RF18 5390 0754 7034' }))!.split('\n')
    expect(lines).toHaveLength(10)
    expect(lines[9]).toBe('RF18539007547034')
  })

  it('skips accounts with an invalid IBAN and uses all accounts when none is selected', () => {
    const base = payable()
    const bad = { id: 'bad', iban: 'EE717700771001234567' }
    expect(isValidIban(bad.iban)).toBe(false)
    const inv = payable({ bankAccountIds: [], seller: { ...base.seller, bankAccounts: [bad, ...base.seller.bankAccounts] } })
    expect(epcQrPayload(inv)!.split('\n')[6]).toBe(IBAN)
    expect(epcQrPayload(payable({ bankAccountIds: ['b2'] }))!.split('\n')[6]).toBe('EE382200221020145685')
    // Only an invalid account selected → no QR rather than a QR for an account the invoice does not print.
    expect(epcQrPayload(sampleInvoice())).toBeNull()
  })

  it('returns null where a SEPA transfer QR is wrong', () => {
    const base = payable()
    expect(epcQrPayload(payable({ currency: 'USD' }))).toBeNull()
    expect(epcQrPayload(payable({ type: 'credit-note', creditedInvoiceNumber: '2026-0001' }))).toBeNull()
    expect(epcQrPayload(payable({ status: 'cancelled' }))).toBeNull()
    expect(epcQrPayload(payable({ status: 'paid', paidAt: '2026-10-20' }))).toBeNull()
    expect(epcQrPayload(payable({ lines: [line({ id: 'z', unitPrice: 0 })] }))).toBeNull()
    expect(epcQrPayload(payable({ lines: [line({ id: 'n', unitPrice: -10 })] }))).toBeNull()
    expect(epcQrPayload(payable({ lines: [line({ id: 'big', quantity: 1, unitPrice: 2_000_000_000 })] }))).toBeNull()
    expect(epcQrPayload(payable({ seller: { ...base.seller, bankAccounts: [] } }))).toBeNull()
    expect(epcQrPayload(payable({ seller: { ...base.seller, bankAccounts: [{ id: 'b1', iban: 'EE12 3' }] } }))).toBeNull()
  })

  it('is opt-in per invoice', () => {
    expect(paymentQrEnabled(payable())).toBe(false)
    expect(paymentQrPayload(payable())).toBeNull()
    expect(paymentQrPayload(payable({ paymentQr: true }))).toBe(epcQrPayload(payable()))
    expect(paymentQrPayload(payable({ paymentQr: true, currency: 'SEK' }))).toBeNull()
  })
})

describe('paymentQr setting', () => {
  it('is copied from profile defaults by createEmptyInvoice (default off)', () => {
    const profile = createDefaultProfile()
    expect(createEmptyInvoice(profile).paymentQr).toBeUndefined()
    expect(createEmptyInvoice({ ...profile, defaults: { ...profile.defaults, paymentQr: true } }).paymentQr).toBe(true)
  })

  it('is accepted by backup validation as an optional boolean', () => {
    const backup = (invoice: Partial<Invoice>, defaults: Record<string, unknown> = {}) => {
      const profile = makeProfile()
      return {
        app: 'invoice-generator',
        version: 1,
        exportedAt: '2026-10-15T00:00:00.000Z',
        profile: { ...profile, defaults: { ...profile.defaults, ...defaults } },
        clients: [],
        invoices: [makeInvoice('i1', invoice)],
        settings: null,
      }
    }
    expect(() => validateBackup(backup({ paymentQr: true }, { paymentQr: false }))).not.toThrow()
    expect(() => validateBackup(backup({}))).not.toThrow()
    expect(() => validateBackup(backup({ paymentQr: 'yes' as unknown as boolean }))).toThrow()
    expect(() => validateBackup(backup({}, { paymentQr: 1 }))).toThrow()
  })
})

// ---------------------------------------------------------------------------------------------------------
// Metadata and doc-definition layer (no rendering)
// ---------------------------------------------------------------------------------------------------------

describe('pdfMetadata', () => {
  it('describes the invoice for document managers and search', () => {
    const inv = sampleInvoice()
    const gross = computeTotals(inv).gross
    const info = pdfMetadata(inv)
    expect(info.title).toBe('Arve 2026-0007')
    expect(info.author).toBe('Õunapuu & Šokolaad OÜ')
    expect(info.creator).toBe('Arvegeneraator')
    expect(info.subject).toBe(`Arve 2026-0007, Õunapuu & Šokolaad OÜ, ${formatAmount(gross, 'et').replace(/ /g, ' ')} EUR, tasuda 26.10.2026`)
    expect(info.keywords).toBe(
      `invoice:2026-0007; issued:2026-10-12; due:2026-10-26; seller:12345678; sellerVat:EE123456789; buyer:87654321; buyerVat:EE987654321; total:${gross.toFixed(2)}; currency:EUR; reference:20260007`,
    )
    expect(info.TotalAmount).toBe(gross.toFixed(2))
    expect(info.Iban).toBe('EE717700771001234567')
  })

  it('follows the invoice language and type', () => {
    expect(pdfMetadata(sampleInvoice({ language: 'en' })).title).toBe('Invoice 2026-0007')
    expect(pdfMetadata(sampleInvoice({ language: 'en' })).subject).toMatch(/^Invoice 2026-0007, .*, [\d,]+\.\d\d EUR, due 26 Oct 2026$/)
    expect(pdfMetadata(sampleInvoice({ language: 'et-en' })).title).toBe('Arve / Invoice 2026-0007')
    expect(pdfMetadata(creditNoteInvoice()).title).toBe('Kreeditarve 2026-0008')
    expect(pdfMetadata(creditNoteInvoice()).subject).not.toMatch(/tasuda/)
    expect(pdfMetadata(sampleInvoice({ status: 'draft', number: '' })).title).toBe('Arve (mustand)')
    expect(pdfLanguage('et')).toBe('et-EE')
    expect(pdfLanguage('et-en')).toBe('et-EE')
    expect(pdfLanguage('en')).toBe('en-GB')
  })
})

describe('withMachineLayer', () => {
  it('is pure and adds the UBL attachment only for issued documents', () => {
    const def = { content: ['x'] }
    const issued = withMachineLayer(def, sampleInvoice())
    expect(def).toEqual({ content: ['x'] })
    expect(issued.files?.einvoice?.name).toBe('Arve_2026-0007.xml')
    expect(issued.files?.einvoice?.src).toMatch(/^data:application\/xml;base64,/)
    expect(issued.language).toBe('et-EE')
    expect(withMachineLayer(def, sampleInvoice({ status: 'draft', number: '' })).files).toBeUndefined()
    expect(withMachineLayer(def, sampleInvoice({ status: 'draft' })).files).toBeUndefined()
    expect(withMachineLayer(def, sampleInvoice(), { embedEInvoice: false }).files).toBeUndefined()
    expect(embeddedXmlFileName(sampleInvoice({ language: 'en' }))).toBe('Invoice_2026-0007.xml')
    expect(embeddedXmlFileName(creditNoteInvoice())).toBe('Kreeditarve_2026-0008.xml')
  })

  it('keeps the draft watermark from the template layer', () => {
    expect(buildRenderDefinition(sampleInvoice({ status: 'draft', number: '' })).watermark).toBeTruthy()
    expect(buildRenderDefinition(sampleInvoice()).watermark).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------------------
// Real PDFs: extraction rules for every template × language
// ---------------------------------------------------------------------------------------------------------

async function render(inv: Invoice, opts?: Parameters<typeof renderInvoicePdf>[1]): Promise<ExtractedPdf> {
  return extractPdf(await blobBytes(await renderInvoicePdf(inv, opts)))
}

function labelSource(lang: InvoiceLanguage, key: LabelKey): string {
  const t = translator(lang)
  const variants = new Set([t(key), ...t.parts(key).filter((p): p is string => !!p)])
  // Longest first so "Käibemaks kokku" wins over "Käibemaks".
  return `(?:${[...variants].sort((a, b) => b.length - a.length).map(loose).join('|')})`
}

const CURRENCY = '(?:€|EUR|\\$|£)?\\s*'

/** Regex: label (or a stacked bilingual label pair), optional ":", optional currency sign, then the value. */
function labelRe(lang: InvoiceLanguage, key: LabelKey, value: string): RegExp {
  const l = labelSource(lang, key)
  return new RegExp(`${l}\\s*:?\\s*(?:${l}\\s*:?\\s*)?${CURRENCY}(${value})`, 'gi')
}

/** Occurrences of `value` printed right after its label. */
function labelled(text: string, lang: InvoiceLanguage, key: LabelKey, value: string): RegExpMatchArray[] {
  return [...text.matchAll(labelRe(lang, key, `${loose(value)}(?![\\d.,]\\d)`))]
}

/** Every value printed after the label (to catch conflicting values). */
function valuesAfter(text: string, lang: InvoiceLanguage, key: LabelKey, valuePattern: string): string[] {
  return [...text.matchAll(labelRe(lang, key, valuePattern))].map((m) => normalizeSpaces(m[1]).trim())
}

const DATE = '\\d{1,2}(?:\\.\\d{2}\\.| [A-Z][a-z]{2} )\\d{4}'
const AMOUNT = '-?\\d{1,3}(?:[ ,]\\d{3})*[.,]\\d{2}'

const languages: InvoiceLanguage[] = ['et', 'en', 'et-en']
const matrix = TEMPLATES.flatMap((t) => languages.map((language) => [t.id, language] as const))

describe('PDF text extraction (pdf.js)', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const results = new Map<string, { inv: Invoice; pdf: ExtractedPdf }>()

  beforeAll(async () => {
    for (const [templateId, language] of matrix) {
      const inv = payable({ templateId, language, paymentQr: true })
      results.set(`${templateId}/${language}`, { inv, pdf: await render(inv) })
    }
  }, 180_000)

  it.each(matrix)('%s / %s: key facts are real text in their label context', (templateId, language) => {
    const { inv, pdf } = results.get(`${templateId}/${language}`)!
    const flat = normalizeSpaces(pdf.streamText.replace(/\n/g, ' '))
    const totals = computeTotals(inv)
    const amt = (v: number) => normalizeSpaces(formatAmount(v, language))
    const date = (d: string) => formatDate(d, language)

    // Identifiers: at least once right after their label, and never a conflicting value after the same label.
    const numberRe = new RegExp(`(?:${labelSource(language, 'number')}|${labelSource(language, 'invoice')}(?:\\s*(?:nr\\.?|no\\.?))?)\\s*:?\\s*${esc(inv.number)}`, 'gi')
    expect(flat.match(numberRe)?.length ?? 0, 'invoice number right after "Number"/"Arve nr" label').toBeGreaterThanOrEqual(1)
    expect(labelled(flat, language, 'issueDate', date(inv.issueDate)), `issueDate label directly followed by ${date(inv.issueDate)}`).not.toHaveLength(0)
    expect(labelled(flat, language, 'dueDate', date(inv.dueDate)), `dueDate label directly followed by ${date(inv.dueDate)}`).not.toHaveLength(0)
    expect(new Set(valuesAfter(flat, language, 'dueDate', DATE))).toEqual(new Set([date(inv.dueDate)]))
    expect(labelled(flat, language, 'referenceNumber', inv.referenceNumber!), `referenceNumber label directly followed by ${inv.referenceNumber!}`).not.toHaveLength(0)
    expect(new Set(valuesAfter(flat, language, 'referenceNumber', '(?:RF\\d\\d[A-Z0-9]+|\\d+)'))).toEqual(new Set([inv.referenceNumber]))
    expect(labelled(flat, language, 'registryCode', inv.seller.registryCode!), `registryCode label directly followed by ${inv.seller.registryCode!}`).not.toHaveLength(0)
    expect(labelled(flat, language, 'registryCode', inv.buyer.registryCode!), `registryCode label directly followed by ${inv.buyer.registryCode!}`).not.toHaveLength(0)
    expect(labelled(flat, language, 'vatNumber', inv.seller.vatNumber!), `vatNumber label directly followed by ${inv.seller.vatNumber!}`).not.toHaveLength(0)
    expect(labelled(flat, language, 'vatNumber', inv.buyer.vatNumber!), `vatNumber label directly followed by ${inv.buyer.vatNumber!}`).not.toHaveLength(0)
    expect(flat).toContain(inv.seller.name)
    expect(flat).toContain(inv.buyer.name)
    expect(flat).toMatch(new RegExp(Array.from(IBAN).join('\\s?')))

    // Totals: net and VAT exactly once; amount due at least once and every occurrence identical
    // (a highlighted summary in the header is fine as long as it never disagrees with the totals block).
    expect(labelled(flat, language, 'netTotal', amt(totals.net)), `netTotal label directly followed by ${amt(totals.net)}, exactly once`).toHaveLength(1)
    expect(labelled(flat, language, 'vatTotal', amt(totals.vat)), `vatTotal label directly followed by ${amt(totals.vat)}, exactly once`).toHaveLength(1)
    expect(labelled(flat, language, 'amountDue', amt(totals.gross)).length, 'amount-due label directly followed by the amount').toBeGreaterThanOrEqual(1)
    expect(new Set(valuesAfter(flat, language, 'amountDue', AMOUNT))).toEqual(new Set([amt(totals.gross)]))
  })

  it.each(matrix)('%s / %s: Estonian letters survive, nothing garbled, rotated or rasterised', (templateId, language) => {
    const { inv, pdf } = results.get(`${templateId}/${language}`)!
    const all = pdf.items.map((i) => i.str).join(' ')
    expect(all).not.toMatch(/[�-]/)
    for (const ch of 'õäöüšžÕÄÖÜŠŽ€') expect(all).toContain(ch)
    expect(normalizeSpaces(pdf.streamText)).toContain(inv.lines[0].description)
    expect(pdf.items.filter((i) => i.rotated)).toEqual([])
    // Only the logo may be a raster image (the QR code is vector).
    expect(pdf.imagesPerPage.every((n) => n <= 1)).toBe(true)
  })

  it.each(matrix)('%s / %s: totals come after the line items in reading order', (templateId, language) => {
    const { inv, pdf } = results.get(`${templateId}/${language}`)!
    const totals = computeTotals(inv)
    const lastDescription = inv.lines[inv.lines.length - 1].description
    const after = (text: string) => {
      const lastLine = text.lastIndexOf(lastDescription)
      const dues = [...text.matchAll(labelRe(language, 'amountDue', loose(normalizeSpaces(formatAmount(totals.gross, language)))))]
      const nets = [...text.matchAll(labelRe(language, 'netTotal', loose(normalizeSpaces(formatAmount(totals.net, language)))))]
      expect(lastLine).toBeGreaterThan(-1)
      expect(nets.at(-1)?.index ?? -1, 'net total (label + amount) after the last line item').toBeGreaterThan(lastLine)
      expect(dues.at(-1)?.index ?? -1, 'amount due (label + amount) after the last line item').toBeGreaterThan(lastLine)
    }
    // Content-stream order (pdf.js, most extractors and LLM pipelines) …
    after(normalizeSpaces(pdf.streamText.replace(/\n/g, ' ')))
    // … and visual order (top-to-bottom lines, like pdftotext): side-by-side blocks may interleave label and
    // value with other text, so only require the label and the amount to be below the last line item.
    const visual = pdf.lines.join('\n')
    const lastLine = visual.lastIndexOf(lastDescription)
    const dueLabel = [...visual.matchAll(new RegExp(labelSource(language, 'amountDue'), 'gi'))].at(-1)
    expect(dueLabel?.index).toBeGreaterThan(lastLine)
    expect(visual.lastIndexOf(normalizeSpaces(formatAmount(totals.gross, language)))).toBeGreaterThan(lastLine)
  })

  it.each(matrix)('%s / %s: metadata and embedded e-invoice', (templateId, language) => {
    const { inv, pdf } = results.get(`${templateId}/${language}`)!
    const totals = computeTotals(inv)
    expect(pdf.info.Title).toBe(pdfMetadata(inv).title)
    expect(pdf.info.Subject).toBe(pdfMetadata(inv).subject)
    expect(pdf.info.Keywords).toContain('invoice:2026-0007')
    expect(pdf.info.Author).toBe(inv.seller.name)
    expect(pdf.info.Creator).toBe('Arvegeneraator')
    expect(pdf.custom.TotalAmount).toBe(totals.gross.toFixed(2))
    expect(pdf.language).toBe(language === 'en' ? 'en-GB' : 'et-EE')
    expect(pdf.attachments).toHaveLength(1)
    const [att] = pdf.attachments
    expect(att.filename).toBe(embeddedXmlFileName(inv))
    const xml = new TextDecoder().decode(att.content)
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    const text = (name: string) => doc.getElementsByTagName(name)[0]?.textContent
    expect(doc.documentElement.localName).toBe('Invoice')
    expect(text('cbc:ID')).toBe(inv.number)
    expect(text('cbc:TaxExclusiveAmount')).toBe(totals.net.toFixed(2))
    expect(text('cbc:TaxInclusiveAmount')).toBe(totals.gross.toFixed(2))
    expect(text('cbc:PayableAmount')).toBe(totals.gross.toFixed(2))
    // The embedded XML must not itself contain a PDF (no recursion).
    expect(doc.getElementsByTagName('cbc:EmbeddedDocumentBinaryObject')).toHaveLength(0)
  })
})

describe('PDF machine layer edge cases (real PDFs)', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  it('drafts: no attachment, metadata says draft, watermark is the only rotated text', async () => {
    const pdf = await render(sampleInvoice({ status: 'draft', number: '' }))
    expect(pdf.attachments).toHaveLength(0)
    expect(pdf.info.Title).toBe('Arve (mustand)')
    const rotated = pdf.items.filter((i) => i.rotated)
    expect(rotated.map((i) => i.str).join('')).toMatch(/MUSTAND/)
  }, 30_000)

  it('credit note embeds a UBL CreditNote; embedEInvoice:false leaves it out', async () => {
    const pdf = await render(creditNoteInvoice())
    expect(pdf.attachments.map((a) => a.filename)).toEqual(['Kreeditarve_2026-0008.xml'])
    expect(new TextDecoder().decode(pdf.attachments[0].content)).toContain('<CreditNote')
    const none = await render(sampleInvoice(), { embedEInvoice: false })
    expect(none.attachments).toHaveLength(0)
  }, 30_000)

  it('no logo → no raster images at all', async () => {
    const base = payable()
    const pdf = await render(payable({ seller: { ...base.seller, logoDataUrl: undefined }, paymentQr: true }))
    expect(pdf.imagesPerPage.every((n) => n === 0)).toBe(true)
  }, 30_000)
})
