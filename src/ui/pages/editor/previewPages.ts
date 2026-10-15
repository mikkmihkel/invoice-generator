import type { Invoice } from '../../../domain'
import { renderInvoicePdf } from '../../../pdf'
import { renderPdfPageImage, type PageImage } from '../../components/brand/pdfRaster'

/** Rendered page width in CSS pixels; the images scale down to the panel. */
const PAGE_WIDTH = 560
/** Safety cap for the page count read from the PDF. */
const MAX_PAGES = 20

/**
 * Fallback page count from the raw bytes (pdfmake writes its page tree uncompressed). The real count comes from
 * pdf.js via PageImage.pageCount; this is only used when that is missing.
 */
export async function pdfPageCount(pdf: Blob): Promise<number> {
  const text = typeof pdf.text === 'function' ? await pdf.text() : ''
  const m = /\/Type\s*\/Pages\b[\s\S]{0,200}?\/Count\s+(\d+)/.exec(text)
  const n = m ? Number(m[1]) : 1
  return Math.min(MAX_PAGES, Math.max(1, n))
}

/** Let the browser handle input and paint between the heavy steps (pdfmake, then each page), so no single task is long. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export type Rendered = { version: string; pages: PageImage[] } | { version: string; url: string }

/** Each page of the invoice PDF as an image; when rasterising is unavailable, the PDF itself for the browser's viewer. */
export async function renderDocument(invoice: Invoice, version: string, stale: () => boolean): Promise<Rendered | null> {
  const pdf = await renderInvoicePdf(invoice, { embedEInvoice: false })
  if (stale()) return null
  try {
    await nextTask()
    if (stale()) return null
    const first = await renderPdfPageImage(pdf, PAGE_WIDTH, 1)
    if (stale()) return null
    const count = Math.min(MAX_PAGES, Math.max(1, first.pageCount ?? (await pdfPageCount(pdf))))
    const pages: PageImage[] = [first]
    for (let page = 2; page <= count; page++) {
      await nextTask()
      if (stale()) return null
      pages.push(await renderPdfPageImage(pdf, PAGE_WIDTH, page))
      if (stale()) return null
    }
    return { version, pages }
  } catch (e) {
    console.warn('Page images failed, showing the PDF instead', e)
    if (typeof URL.createObjectURL !== 'function') throw e
    return { version, url: URL.createObjectURL(pdf) }
  }
}
