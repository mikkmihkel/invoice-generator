import { describe, expect, it } from 'vitest'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import { computeTotals } from '../domain'
import type { Invoice, InvoiceLanguage, TemplateId } from '../domain/types'
import { buildDocDefinition } from './docDefinition'
import { FONT, FONT_FAMILIES } from './fonts'
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

const templates: TemplateId[] = ['standard', 'classic', 'modern', 'minimal', 'bold', 'compact']
const languages: InvoiceLanguage[] = ['et', 'en', 'et-en']

describe('TEMPLATES', () => {
  it('describes all six templates in both languages, standard first', () => {
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

  it('credit notes carry no payment instructions in any template', () => {
    for (const templateId of templates) {
      for (const language of languages) {
        const def = buildDocDefinition(creditNoteInvoice({ templateId, language, paymentQr: true }))
        const all = joined(def).toUpperCase()
        expect(all, `${templateId} ${language}`).not.toContain('MAKSEANDMED')
        expect(all, `${templateId} ${language}`).not.toContain('PAYMENT DETAILS')
        expect(all, `${templateId} ${language}`).not.toContain('VIITENUMBER')
        expect(all, `${templateId} ${language}`).not.toContain('REFERENCE NO.')
        expect(all, `${templateId} ${language}`).not.toContain('20260007')
        expect(all, `${templateId} ${language}`).not.toContain('EE71 7700')
      }
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
    expect(def.defaultStyle).toMatchObject({ font: 'PlexSans' })
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
  it('uses each language\'s decimal separator in the bilingual late-interest text', () => {
    const all = joined(buildDocDefinition(sampleInvoice({ language: 'et-en', lateInterestPercentPerDay: 0.05 })))
    expect(all).toContain('viivist 0,05% päevas')
    expect(all).toContain('interest of 0.05% per day')
  })

  it('keeps the bilingual VAT-rate column header on one line per language', () => {
    const def = buildDocDefinition(sampleInvoice({ language: 'et-en' }))
    const found: Record<string, unknown>[] = []
    JSON.stringify(def.content, (_k, v) => {
      if (v && typeof v === 'object' && (v.text === 'KM %' || v.text === 'VAT %')) found.push(v)
      return v
    })
    expect(found.length).toBeGreaterThan(0)
    for (const f of found) expect(f.noWrap).toBe(true)
  })
})

/** Every object node in the definition (content, header/footer of pages 1 and 2, background). */
function nodes(def: TDocumentDefinitions): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (n && typeof n === 'object') {
      out.push(n as Record<string, unknown>)
      Object.values(n).forEach(walk)
    }
  }
  walk(def.content)
  for (const page of [1, 2]) {
    if (typeof def.footer === 'function') walk(def.footer(page, 2, PAGE))
    if (typeof def.header === 'function') walk(def.header(page, 2, PAGE))
  }
  return out
}

/** Sample whose printed account has a valid IBAN, so a payment QR can be produced. */
const payable = (o: Partial<Invoice> = {}) => sampleInvoice({ bankAccountIds: ['b2'], paymentQr: true, ...o })

describe('templates — design system', () => {
  it('only uses registered fonts (IBM Plex) and defaults to Plex Sans', () => {
    for (const templateId of templates) {
      for (const language of languages) {
        const def = buildDocDefinition(sampleInvoice({ templateId, language }))
        expect(def.defaultStyle).toMatchObject({ font: FONT.sans })
        const used = new Set(nodes(def).map((n) => n.font).filter((f): f is string => typeof f === 'string'))
        for (const f of used) expect(Object.keys(FONT_FAMILIES), `${templateId}: unknown font ${f}`).toContain(f)
      }
    }
  })

  it('sets identifiers (number, codes, IBAN, reference) as single runs styled like the other values of their block', () => {
    const style = (n: Record<string, unknown>) => JSON.stringify([n.font ?? null, n.fontSize ?? null, n.color ?? null, !!n.bold])
    for (const templateId of templates) {
      for (const language of languages) {
        const all = nodes(buildDocDefinition(sampleInvoice({ templateId, language })))
        // Plain values next to the identifiers: dates in the facts, the bank in the payment details, e-mail in the parties.
        const plain = new Set(all.filter((n) => ['12.10.2026', '12 Oct 2026', 'LHV Pank', 'arved@ounapuu.ee', 'raamatupidamine@klient.ee'].includes(n.text as string)).map(style))
        expect(plain.size, `${templateId}/${language}: reference values`).toBeGreaterThan(0)
        for (const id of ['2026-0007', '12345678', 'EE123456789', '87654321', 'EE987654321', 'EE71 7700 7710 0123 4567', 'LHVBEE22', '20260007']) {
          const runs = all.filter((n) => n.text === id)
          expect(runs.length, `${templateId}/${language}: ${id} as one run`).toBeGreaterThan(0)
          for (const run of runs) {
            expect(run.font, `${templateId}/${language}: ${id} in the body font`).toBeUndefined()
            expect(plain, `${templateId}/${language}: ${id} styled like its neighbours`).toContain(style(run))
          }
        }
        // An IBAN split over two lines is unreadable for people and parsers.
        for (const run of all.filter((n) => n.text === 'EE71 7700 7710 0123 4567')) expect(run.noWrap).toBe(true)
      }
    }
  })

  it('keeps every template to one family, a four-step type scale and two weights (plus a display weight for headlines)', () => {
    const title = { et: 'Arve', en: 'Invoice', 'et-en': 'Arve / Invoice' }
    for (const templateId of templates) {
      for (const language of languages) {
        const d = buildDocDefinition(payable({ templateId, language }))
        const all = nodes(d)
        const sizes = new Set(all.map((n) => n.fontSize).filter((v): v is number => typeof v === 'number'))
        sizes.add((d.defaultStyle as { fontSize: number }).fontSize)
        // Bold adds one headline size for the amount due.
        expect(sizes.size, `${templateId}/${language}: ${[...sizes].sort((a, b) => a - b).join(', ')}`).toBeLessThanOrEqual(templateId === 'bold' && language !== 'et-en' ? 5 : 4)
        // Display weight only for the title and the headline amount.
        const display = all.filter((n) => n.font === FONT.display).map((n) => n.text)
        for (const text of display) expect([title[language], formatMoney(computeTotals(payable()).gross, 'EUR', language)], `${templateId}/${language}`).toContain(text)
        expect(all.filter((n) => n.font !== undefined && n.font !== FONT.display).map((n) => n.font), `${templateId}/${language}`).toEqual([])
      }
    }
  })

  it('prints amounts as one text run with the currency', () => {
    for (const templateId of templates) {
      const runs = nodes(buildDocDefinition(sampleInvoice({ templateId }))).map((n) => n.text)
      expect(runs, templateId).toContain(formatMoney(2516.92, 'EUR', 'et'))
      expect(runs, templateId).toContain(formatMoney(2191.97, 'EUR', 'et'))
    }
  })

  it('uses a real, repeating header row and keeps rows and the totals block together', () => {
    for (const templateId of templates) {
      const all = nodes(buildDocDefinition(sampleInvoice({ templateId, lines: Array.from({ length: 40 }, (_, i) => line({ id: `x${i}` })) })))
      const lines = all.find((n) => (n.table as { body?: unknown[] } | undefined)?.body?.length === 41)!.table as { headerRows: number; dontBreakRows: boolean }
      expect(lines.headerRows, templateId).toBe(1)
      expect(lines.dontBreakRows, templateId).toBe(true)
      const totalsBlock = all.find((n) => n.unbreakable && JSON.stringify(n).toUpperCase().includes('TASUMISELE KUULUB'))
      expect(totalsBlock, templateId).toBeTruthy()
    }
  })

  it('shows the EPC payment QR in the payment section only when enabled and possible', () => {
    const qrs = (inv: Invoice) => nodes(buildDocDefinition(inv)).filter((n) => typeof n.qr === 'string')
    for (const templateId of templates) {
      const [qr] = qrs(payable({ templateId }))
      expect(qr, templateId).toBeTruthy()
      expect(String(qr.qr).startsWith('BCD\n002\n')).toBe(true)
      expect(qrs(payable({ templateId, paymentQr: false })), templateId).toEqual([])
      expect(qrs(sampleInvoice({ templateId, paymentQr: true })), `${templateId}: invalid IBAN`).toEqual([])
      expect(qrs(payable({ templateId, type: 'credit-note', creditedInvoiceNumber: '2026-0006' })), `${templateId}: credit note`).toEqual([])
    }
    expect(joined(buildDocDefinition(payable({ language: 'et-en' })))).toContain('Skanni ja maksa')
  })

  it('labels the document number by type and prints it with the page count in the footer', () => {
    for (const templateId of templates) {
      const inv = joined(buildDocDefinition(sampleInvoice({ templateId })))
      expect(inv).toContain('Arve nr')
      expect(inv).toContain('Arve nr 2026-0007  ·  ')
      const credit = joined(buildDocDefinition(creditNoteInvoice({ templateId, language: 'en' }))).toUpperCase()
      expect(credit).toContain('CREDIT NOTE NO.')
      expect(credit).toContain('CREDITED INVOICE')
      expect(credit, `${templateId}: credit notes have no due date`).not.toContain('DUE DATE')
    }
  })

  it('standard: no amount/due-date headline; the accent colour marks only the amount due in the totals', () => {
    const def = buildDocDefinition(sampleInvoice({ templateId: 'standard', accentColor: '#aa3300' }))
    const amount = formatMoney(2516.92, 'EUR', 'et')
    expect(joined(def)).not.toMatch(/tasuda/)
    expect(joined(buildDocDefinition(sampleInvoice({ templateId: 'standard', language: 'et-en' })))).not.toMatch(/tasuda|\bdue \d/)
    const accented = nodes(def).filter((n) => n.color === '#aa3300')
    expect(accented.map((n) => n.text)).toEqual([amount])
    expect(JSON.stringify(def.content).match(/#aa3300/g)).toHaveLength(1)
    // The due date stays in the facts list.
    expect(joined(def)).toContain('26.10.2026')
  })

  it('prints the text rows before the line table and after the totals, in every template', () => {
    const before = ['Vastavalt lepingule nr 12/2026', 'Teine rida\nreavahetusega']
    const after = ['Täname koostöö eest!']
    for (const templateId of templates) {
      const def = buildDocDefinition(sampleInvoice({ templateId, textBefore: [...before, '  '], textAfter: after }))
      const all = joined(def)
      const at = (s: string) => all.indexOf(s)
      for (const row of [...before, ...after]) expect(at(row), `${templateId}: ${row}`).toBeGreaterThan(-1)
      expect(at(before[0]), templateId).toBeGreaterThan(at('Klient Žürii OÜ'))
      expect(at(before[1]), templateId).toBeGreaterThan(at(before[0]))
      expect(at(before[1]), templateId).toBeLessThan(at('Veebilehe arendus'))
      expect(at(after[0]), templateId).toBeGreaterThan(all.toUpperCase().lastIndexOf('TASUMISELE KUULUB'))
      expect(at(after[0]), templateId).toBeLessThan(at('EE71 7700 7710 0123 4567'))
      // Blank rows are not printed (no empty paragraph nodes).
      expect(nodes(def).filter((n) => typeof n.text === 'string' && !n.text.trim() && n.margin), templateId).toEqual([])
      // Without rows the layout is unchanged.
      expect(JSON.stringify(buildDocDefinition(sampleInvoice({ templateId, textBefore: [' '], textAfter: [] })).content)).toEqual(
        JSON.stringify(buildDocDefinition(sampleInvoice({ templateId })).content),
      )
    }
  })

  it('classic prints the seller letterhead in the footer; others keep the footer light', () => {
    const footerText = (templateId: TemplateId) => JSON.stringify((buildDocDefinition(sampleInvoice({ templateId })).footer as (p: number, c: number, s: typeof PAGE) => unknown)(1, 1, PAGE))
    expect(footerText('classic')).toContain('Registrikood 12345678')
    expect(footerText('standard')).not.toContain('12345678')
  })

  it('falls back to classic for unknown template ids', () => {
    const inv = sampleInvoice({ templateId: 'nope' as TemplateId })
    expect(JSON.stringify(buildDocDefinition(inv).content)).toEqual(JSON.stringify(buildDocDefinition(sampleInvoice({ templateId: 'classic' })).content))
  })
})

describe('buildDocDefinition – unknown template ids', () => {
  it('falls back to classic for ids that are not templates, including Object.prototype names', () => {
    for (const id of ['constructor', '__proto__', 'toString', 'no-such-template']) {
      const def = buildDocDefinition(sampleInvoice({ templateId: id as TemplateId }))
      expect(Array.isArray(def.content) ? def.content.length : 0).toBeGreaterThan(0)
    }
  })
})
