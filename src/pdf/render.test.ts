import { describe, expect, it, vi } from 'vitest'
import type { TemplateId } from '../domain/types'
import { renderInvoicePdf, renderInvoicePdfBase64, renderInvoicePdfDataUrl } from './render'
import { creditNoteInvoice, line, notRegisteredInvoice, sampleInvoice } from './testFixtures'

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Uint8Array(await new Response(blob).arrayBuffer())
}

const latin1 = (bytes: Uint8Array) => Array.from(bytes.subarray(0, 2048), (b) => String.fromCharCode(b)).join('')

describe('renderInvoicePdf (real pdfmake)', () => {
  // pdfmake warns about missing access policies when it detects Node; irrelevant here.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  it.each<TemplateId>(['classic', 'modern', 'minimal', 'bold'])('renders %s with Estonian characters to a PDF blob', async (templateId) => {
    const blob = await renderInvoicePdf(sampleInvoice({ templateId, language: 'et-en' }))
    expect(blob.type).toBe('application/pdf')
    const bytes = await blobBytes(blob)
    expect(bytes.length).toBeGreaterThan(5000)
    const head = latin1(bytes)
    expect(head.startsWith('%PDF-')).toBe(true)
  }, 30_000)

  it('renders a long multi-page invoice, credit note and non-VAT invoice', async () => {
    const many = Array.from({ length: 70 }, (_, i) => line({ id: `m${i}`, description: `Rida ${i + 1}: õõ ää öö üü šš žž €`, unitPrice: 10 + i }))
    for (const inv of [sampleInvoice({ lines: many, templateId: 'bold' }), creditNoteInvoice({ templateId: 'modern' }), notRegisteredInvoice({ templateId: 'minimal', language: 'en' })]) {
      const bytes = await blobBytes(await renderInvoicePdf(inv))
      expect(latin1(bytes).startsWith('%PDF-')).toBe(true)
    }
  }, 60_000)

  it('provides base64 and data URL variants', async () => {
    const b64 = await renderInvoicePdfBase64(sampleInvoice({ status: 'draft', number: '' }))
    expect(atob(b64.slice(0, 8)).startsWith('%PDF')).toBe(true)
    const url = await renderInvoicePdfDataUrl(sampleInvoice({ templateId: 'minimal', seller: { ...sampleInvoice().seller, logoDataUrl: undefined } }))
    expect(url.startsWith('data:application/pdf;base64,')).toBe(true)
  }, 30_000)
})
