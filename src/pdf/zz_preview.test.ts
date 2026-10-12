import { it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { renderInvoicePdf } from './render'
import { creditNoteInvoice, line, notRegisteredInvoice, sampleInvoice } from './testFixtures'
import type { TemplateId } from '../domain/types'

it('preview', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const out = '/tmp/claude-0/-home-user-invoice-generator/cf206b96-b2bd-579a-af0b-e143ccf29ea0/scratchpad/pdf'
  const colors: Record<TemplateId, string> = { classic: '#1f6feb', modern: '#0f766e', minimal: '#c2410c', bold: '#7c3aed' }
  for (const t of ['classic', 'modern', 'minimal', 'bold'] as TemplateId[]) {
    const inv = sampleInvoice({ templateId: t, accentColor: colors[t], language: t === 'modern' ? 'et-en' : t === 'minimal' ? 'en' : 'et' })
    writeFileSync(out + '/' + t + '.pdf', new Uint8Array(await (await renderInvoicePdf(inv)).arrayBuffer()))
  }
  const many = Array.from({ length: 45 }, (_, i) => line({ id: 'm' + i, description: 'Rida ' + (i + 1) + ': õõ ää öö üü šš žž €', unitPrice: 10 + i }))
  writeFileSync(out + '/long.pdf', new Uint8Array(await (await renderInvoicePdf(sampleInvoice({ lines: many, templateId: 'bold', language: 'et-en', accentColor: '#fde047' }))).arrayBuffer()))
  writeFileSync(out + '/credit.pdf', new Uint8Array(await (await renderInvoicePdf(creditNoteInvoice({ templateId: 'classic', language: 'et-en' }))).arrayBuffer()))
  writeFileSync(out + '/novat.pdf', new Uint8Array(await (await renderInvoicePdf(notRegisteredInvoice({ templateId: 'modern', status: 'draft', number: '' }))).arrayBuffer()))
}, 60000)
