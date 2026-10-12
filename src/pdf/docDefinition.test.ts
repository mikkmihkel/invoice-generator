import { describe, expect, it } from 'vitest'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import { computeTotals } from '../domain'
import type { InvoiceLanguage, TemplateId } from '../domain/types'
import { buildDocDefinition } from './docDefinition'
import { formatMoney } from './format'
import { TEMPLATES } from './templates'
import { creditNoteInvoice, line, notRegisteredInvoice, sampleInvoice, TINY_PNG } from './testFixtures'

const PAGE = { width: 595.28, height: 841.89, orientation: 'portrait' as const }

/** Every text fragment in the definition, including footer (page 1 of 2) and background. */
function texts(def: TDocumentDefinitions): string[] {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node))
      return
    }
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node === 'object') {
      const o = node as Record<string, unknown>
      for (const key of ['text', 'stack', 'columns', 'table', 'body', 'ul', 'ol']) if (key in o) walk(o[key])
    }
  }
  walk(def.content)
  if (typeof def.footer === 'function') walk(def.footer(1, 2, PAGE))
  return out
}

const joined = (def: TDocumentDefinitions) => texts(def).join('\n')

function images(def: TDocumentDefinitions): string[] {
  const found: string[] = []
  JSON.stringify(def.content, (k, v) => {
    if (k === 'image' && typeof v === 'string') found.push(v)
    return v
  })
  return found
}

const templates: TemplateId[] = ['classic', 'modern', 'minimal', 'bold']
const languages: InvoiceLanguage[] = ['et', 'en', 'et-en']

describe('TEMPLATES', () => {
  it('describes all four templates in both languages', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(templates)
    for (const t of TEMPLATES) {
      expect(t.name.et && t.name.en && t.description.et && t.description.en).toBeTruthy()
    }
  })
})

describe('buildDocDefinition — legally required content', () => {
  for (const templateId of templates) {
    for (const language of languages) {
      it(`${templateId} / ${language}`, () => {
        const inv = sampleInvoice({ templateId, language })
        const def = buildDocDefinition(inv)
        const all = joined(def)
        const totals = computeTotals(inv)
        const fmtLang = language
        const has = (s: string) => expect(all, `missing "${s}"`).toContain(s)

        // Title (some templates uppercase it) + number + dates
        const upper = all.toUpperCase()
        expect(upper).toContain(language === 'en' ? 'INVOICE' : 'ARVE')
        if (language === 'et-en') expect(upper).toContain('ARVE / INVOICE')
        has('2026-0007')
        if (language === 'en') {
          has('12 Oct 2026')
          has('26 Oct 2026')
          has('10 Oct 2026')
          has('1 Sep 2026 – 30 Sep 2026')
        } else {
          has('12.10.2026')
          has('26.10.2026')
          has('10.10.2026')
          has('01.09.2026 – 30.09.2026')
        }
        // Seller
        has('Õunapuu & Šokolaad OÜ')
        has('12345678')
        has('EE123456789')
        has('Pärnu mnt 15-3')
        has('10141 Tallinn, Harju maakond')
        has('arved@ounapuu.ee')
        has('+372 5555 1234')
        // Bank (only the selected account)
        has('EE71 7700 7710 0123 4567')
        has('LHVBEE22')
        expect(all).not.toContain('EE38 2200')
        // Buyer
        has('Klient Žürii OÜ')
        has('87654321')
        has('EE987654321')
        has('Tähe 4')
        has('Mari Mänd')
        // Lines
        has('Veebilehe arendus – õõtsuv ülesanne')
        has('Raamat "Šifrid & <koodid>"')
        has(language === 'en' ? '12.5' : '12,5')
        has(language === 'en' ? '1,234.567' : '1 234,567')
        has('10%')
        // VAT breakdown (three rates → table with taxable amounts) + totals
        for (const r of totals.vatBreakdown) {
          has(`${r.rate}%`)
          has(formatMoney(r.taxable, 'EUR', fmtLang).replace(/ €|€/g, '').trim())
        }
        has(formatMoney(totals.net, 'EUR', fmtLang))
        has(formatMoney(totals.vat, 'EUR', fmtLang))
        has(formatMoney(totals.gross, 'EUR', fmtLang))
        expect(upper).toContain(language === 'en' ? 'TAXABLE AMOUNT' : 'MAKSUSTATAV SUMMA')
        // References, notes, late interest, footer, page numbers
        has('20260007')
        has('PO-77/2026')
        has('Täname koostöö eest!')
        has(language === 'en' ? '0.05%' : '0,05%')
        has('parim šokolaad Eestis')
        has('1/2')
      })
    }
  }
})

describe('buildDocDefinition — variants', () => {
  it('formats amounts the Estonian way', () => {
    const all = joined(buildDocDefinition(sampleInvoice()))
    expect(all).toContain('2 516,92 €')
  })

  it('hides VAT for sellers that are not VAT registered and prints the mandatory note', () => {
    for (const templateId of templates) {
      const inv = notRegisteredInvoice({ templateId })
      const all = joined(buildDocDefinition(inv))
      expect(all).not.toContain('KM %')
      expect(all).not.toContain('Käibemaks')
      expect(all).not.toContain('Summa käibemaksuta')
      expect(all).not.toMatch(/\b24%/)
      expect(all).toMatch(/ei ole käibemaksukohustuslas/)
      expect(all).toContain(formatMoney(computeTotals(inv).gross, 'EUR', 'et'))
    }
  })

  it('prints the reverse-charge note', () => {
    const inv = sampleInvoice({ vatScheme: 'eu-reverse-charge', language: 'en', lines: [line({ id: 'x', vatRate: 0 })] })
    const all = joined(buildDocDefinition(inv))
    expect(all).toContain('Reverse charge')
    expect(all).toContain('VAT 0%')
  })

  it('renders credit notes with a reference to the credited invoice', () => {
    for (const language of languages) {
      const all = joined(buildDocDefinition(creditNoteInvoice({ language })))
      expect(all.toUpperCase()).toContain(language === 'en' ? 'CREDIT NOTE' : 'KREEDITARVE')
      expect(all).toContain('2026-0008')
      expect(all).toContain(language === 'en' ? 'Credit note for invoice no. 2026-0007' : 'Kreeditarve arvele nr 2026-0007')
      expect(all).toContain(language === 'en' ? '-€161.20' : '-161,20 €')
    }
  })

  it('renders prepayment invoices', () => {
    const all = joined(buildDocDefinition(sampleInvoice({ type: 'prepayment', language: 'et-en' })))
    expect(all.toUpperCase()).toContain('ETTEMAKSUARVE / PREPAYMENT INVOICE')
  })

  it('shows a single VAT rate in the totals without a separate breakdown table', () => {
    const inv = sampleInvoice({ lines: [line({ id: 'a', unitPrice: 100 }), line({ id: 'b', unitPrice: 50 })] })
    const all = joined(buildDocDefinition(inv))
    expect(all).toContain('Käibemaks 24%')
    expect(all).toContain('36,00 €')
    expect(all).not.toContain('Maksustatav summa')
  })

  it('only shows the discount column when a line has a discount', () => {
    const noDiscount = sampleInvoice({ lines: [line({ id: 'a' })] })
    expect(joined(buildDocDefinition(noDiscount))).not.toContain('Allahindlus')
    expect(joined(buildDocDefinition(sampleInvoice()))).toContain('Allahindlus')
  })

  it('watermarks drafts and cancelled invoices only', () => {
    expect(buildDocDefinition(sampleInvoice()).watermark).toBeUndefined()
    expect(buildDocDefinition(sampleInvoice({ status: 'draft', number: '' })).watermark).toMatchObject({ text: 'MUSTAND' })
    expect(buildDocDefinition(sampleInvoice({ status: 'cancelled', language: 'en' })).watermark).toMatchObject({ text: 'CANCELLED' })
    expect(buildDocDefinition(sampleInvoice({ status: 'draft' }), { watermark: false }).watermark).toBeUndefined()
  })

  it('embeds only data-URL PNG/JPEG logos', () => {
    expect(images(buildDocDefinition(sampleInvoice()))).toEqual([TINY_PNG])
    const remote = sampleInvoice()
    remote.seller = { ...remote.seller, logoDataUrl: 'https://example.com/logo.png' }
    expect(images(buildDocDefinition(remote))).toEqual([])
  })

  it('uses the accent colour and falls back on invalid input', () => {
    const json = (accentColor: string, templateId: TemplateId) => JSON.stringify(buildDocDefinition(sampleInvoice({ accentColor, templateId })))
    expect(json('#AA3300', 'modern')).toContain('#aa3300')
    expect(json('#a30', 'bold')).toContain('#aa3300')
    expect(json('not-a-colour', 'modern')).toContain('#1f6feb')
  })

  it('draws the accent band / header block in the background', () => {
    for (const templateId of ['modern', 'bold'] as TemplateId[]) {
      const def = buildDocDefinition(sampleInvoice({ templateId, accentColor: '#7c3aed' }))
      expect(typeof def.background).toBe('function')
      const bg = (def.background as (p: number, s: typeof PAGE) => unknown)(1, PAGE)
      expect(JSON.stringify(bg)).toContain('#7c3aed')
    }
  })

  it('sets document metadata', () => {
    const def = buildDocDefinition(sampleInvoice({ language: 'en' }))
    expect(def.info).toMatchObject({ title: 'Invoice 2026-0007', author: 'Õunapuu & Šokolaad OÜ' })
    expect(def.pageSize).toBe('A4')
    expect(def.defaultStyle).toMatchObject({ font: 'Roboto' })
  })

  it('prints the country for cross-border invoices and personal code for private buyers', () => {
    const inv = sampleInvoice({
      language: 'en',
      buyer: { kind: 'person', name: 'Jaan Tamm', personalCode: '38001010000', address: { street: 'Main St 1', city: 'Helsinki', postalCode: '00100', country: 'FI' } },
    })
    const all = joined(buildDocDefinition(inv))
    expect(all).toContain('Finland')
    expect(all).toContain('Estonia')
    expect(all).toContain('38001010000')
  })
})
