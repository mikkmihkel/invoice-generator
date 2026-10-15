import { it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { renderInvoicePdf } from '../render'
import { sampleInvoice } from '../testFixtures'
import { blobBytes, extractPdf } from './extract'

it('probe', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const bytes = await blobBytes(await renderInvoicePdf(sampleInvoice({ templateId: 'modern', language: 'et', paymentQr: true })))
  writeFileSync('/tmp/claude-0/-home-user-invoice-generator/cf206b96-b2bd-579a-af0b-e143ccf29ea0/scratchpad/probe/modern.pdf', bytes)
  const x = await extractPdf(bytes)
  console.log(JSON.stringify({ info: x.info, custom: x.custom, language: x.language, att: x.attachments.map(a => [a.filename, a.description, a.content.length]), images: x.imagesPerPage }, null, 1))
  console.log(x.text)
  console.log('----STREAM----')
  console.log(x.streamText)
}, 60000)
