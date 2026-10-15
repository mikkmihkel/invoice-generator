import { describe, expect, it } from 'vitest'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import type { Invoice, InvoiceLanguage, TemplateId } from '../domain/types'
import { buildUblXml, eInvoiceIssues, supportsEInvoice } from '../einvoice'
import { buildDocDefinition } from './docDefinition'
import { invoiceFileName } from './fileName'
import { embedsEInvoice, epcQrPayload, invoiceFacts, pdfMetadata, withMachineLayer } from './machine'
import { sampleInvoice } from './testFixtures'

const PAGE = { width: 595.28, height: 841.89, orientation: 'portrait' as const }

function joined(def: TDocumentDefinitions): string {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return
    if (typeof node === 'string' || typeof node === 'number') return void out.push(String(node))
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node === 'object') {
      const o = node as Record<string, unknown>
      for (const key of ['text', 'stack', 'columns', 'table', 'body']) if (key in o) walk(o[key])
    }
  }
  walk(def.content)
  if (typeof def.footer === 'function') walk(def.footer(1, 1, PAGE))
  return out.join('\n').toLowerCase()
}

function quote(overrides: Partial<Invoice> = {}): Invoice {
  return sampleInvoice({
    type: 'quote',
    number: 'HP-2026-004',
    validUntil: '2026-10-26',
    dueDate: '2026-10-26',
    paymentQr: true,
    supplyDate: undefined,
    ...overrides,
  })
}

const templates: TemplateId[] = ['standard', 'classic', 'modern', 'minimal', 'bold', 'compact']
const languages: InvoiceLanguage[] = ['et', 'en', 'et-en']

describe('quote PDF', () => {
  for (const templateId of templates) {
    for (const language of languages) {
      it(`${templateId} / ${language}: title, validity, no payment details`, () => {
        const text = joined(buildDocDefinition(quote({ templateId, language })))
        if (language !== 'en') {
          expect(text).toContain('hinnapakkumine')
          expect(text).toContain('kehtib kuni')
          expect(text).toContain('pakkumise nr')
          expect(text).toContain('26.10.2026')
        } else {
          expect(text).toContain('quote')
          expect(text).toContain('valid until')
        }
        expect(text).toContain('hp-2026-004')
        for (const absent of ['Maksetähtaeg', 'Due date', 'Viitenumber', 'Reference no', 'IBAN', 'Makseandmed', 'Payment details', 'Viivis', 'viivist', 'Late payment', 'Tasumisele kuulub', 'Amount due', 'Arve nr', 'Arve kuupäev', '20260007']) {
          expect(text, absent).not.toContain(absent.toLowerCase())
        }
        const def = buildDocDefinition(quote({ templateId, language }))
        expect(JSON.stringify(def.content)).not.toContain('"qr"')
      })
    }
  }

  it('an invoice still shows its payment details', () => {
    const text = joined(buildDocDefinition(sampleInvoice({ templateId: 'bold' })))
    expect(text).toContain('maksetähtaeg')
    expect(text).toContain('tasumisele kuulub')
  })
})

describe('quote machine layer', () => {
  it('has no payment QR and no embedded e-invoice', () => {
    expect(epcQrPayload(quote())).toBeNull()
    expect(embedsEInvoice(quote())).toBe(false)
    const def = withMachineLayer({ content: [] }, quote())
    expect(def.files).toBeUndefined()
  })
  it('metadata names the quote and its validity', () => {
    const meta = pdfMetadata(quote())
    expect(meta.title).toBe('Hinnapakkumine HP-2026-004')
    expect(meta.subject).toContain('kehtib kuni 26.10.2026')
    expect(meta.subject).not.toContain('tasuda')
    expect(meta.keywords).toContain('validUntil:2026-10-26')
    expect(meta.keywords).not.toContain('due:')
    expect(invoiceFacts(quote()).DueDate).toBeUndefined()
    expect(pdfMetadata(quote({ language: 'en' })).title).toBe('Quote HP-2026-004')
  })
  it('file names', () => {
    expect(invoiceFileName(quote())).toBe('Hinnapakkumine_HP-2026-004_Klient-Zurii-OU.pdf')
    expect(invoiceFileName(quote({ language: 'en', number: '', status: 'draft', issueDate: '2026-10-15' }))).toBe('Quote_draft_2026-10-15_Klient-Zurii-OU.pdf')
  })
  it('has no e-invoice XML', () => {
    expect(supportsEInvoice(quote())).toBe(false)
    expect(supportsEInvoice(sampleInvoice())).toBe(true)
    expect(() => buildUblXml(quote())).toThrow()
    expect(eInvoiceIssues(quote()).map((i) => i.field)).toEqual(['type'])
  })
})
