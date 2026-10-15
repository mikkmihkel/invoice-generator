// Test helper: extract text, metadata and attachments from a real PDF with pdf.js (as many extraction tools,
// browsers and AI document parsers do). Node only; not imported by app code.
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

export interface ExtractedItem {
  str: string
  page: number
  /** Baseline position in PDF points, origin bottom-left. */
  x: number
  y: number
  width: number
  fontSize: number
  /** Text that is not upright (any rotation/skew in the text matrix). */
  rotated: boolean
}

export interface ExtractedAttachment {
  filename: string
  description?: string
  content: Uint8Array
}

export interface ExtractedPdf {
  pages: number
  /** Text items in content-stream order (what pdf.js-based and most streaming extractors see). */
  items: ExtractedItem[]
  /** Items joined in stream order: same-line items with a space, line ends with "\n". */
  streamText: string
  /** Visual lines, top-to-bottom then left-to-right per page (like `pdftotext` without `-layout`). */
  lines: string[]
  /** `lines` joined with "\n". */
  text: string
  info: Record<string, unknown>
  /** Custom Info dictionary entries. */
  custom: Record<string, string>
  language: string | null
  attachments: ExtractedAttachment[]
  /** Raster images drawn per page. */
  imagesPerPage: number[]
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjsPromise: Promise<PdfJs> | null = null

async function pdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // In Node pdf.js runs its worker in-process ("fake worker"); it must be able to import the worker module.
    // The bare specifier resolves through the package exports both in Node and in Vitest.
    if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs'
    return lib
  })()
  return pdfjsPromise
}

/** Normalise extracted text for matching: NBSP/thin spaces → space, collapse runs of spaces. */
export function normalizeSpaces(s: string): string {
  return s.replace(/[   ]/g, ' ').replace(/[ \t]+/g, ' ')
}

/** True when `next` continues `prev` on the same baseline without a visible gap (pdfmake splits words at "-", "/"). */
function touches(prev: ExtractedItem | undefined, next: ExtractedItem): boolean {
  if (!prev || prev.page !== next.page || prev.rotated || next.rotated) return false
  if (Math.abs(prev.y - next.y) > 0.5) return false
  const gap = next.x - (prev.x + prev.width)
  return gap > -0.5 && gap < Math.min(prev.fontSize, next.fontSize) * 0.12
}

function joinRow(row: ExtractedItem[]): string {
  let out = ''
  row.forEach((it, i) => {
    out += (i > 0 && !touches(row[i - 1], it) ? ' ' : '') + it.str
  })
  return out
}

function groupLines(items: ExtractedItem[]): string[] {
  const out: string[] = []
  const pages = new Map<number, ExtractedItem[]>()
  for (const it of items) {
    if (it.rotated || !it.str.trim()) continue
    pages.set(it.page, [...(pages.get(it.page) ?? []), it])
  }
  for (const page of [...pages.keys()].sort((a, b) => a - b)) {
    const sorted = [...pages.get(page)!].sort((a, b) => b.y - a.y || a.x - b.x)
    const rows: ExtractedItem[][] = []
    for (const it of sorted) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= Math.max(2, Math.min(r[0].fontSize, it.fontSize) * 0.35))
      if (row) row.push(it)
      else rows.push([it])
    }
    rows.sort((a, b) => b[0].y - a[0].y)
    for (const row of rows) out.push(normalizeSpaces(joinRow(row.sort((a, b) => a.x - b.x))).trim())
  }
  return out
}

/** Parse a PDF (bytes) with pdf.js and collect everything a machine reader would see. */
export async function extractPdf(data: Uint8Array): Promise<ExtractedPdf> {
  const lib = await pdfjs()
  // pdf.js may transfer/detach the buffer: hand it a copy.
  const doc = await lib.getDocument({ data: data.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise
  try {
    const items: ExtractedItem[] = []
    const imagesPerPage: number[] = []
    let streamText = ''
    const imageOps = new Set([lib.OPS.paintImageXObject, lib.OPS.paintInlineImageXObject, lib.OPS.paintImageMaskXObject])
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      for (const raw of content.items) {
        if (!('str' in raw)) continue
        const it = raw as TextItem
        const [a, b, c, d, e, f] = it.transform as number[]
        const item: ExtractedItem = {
          str: it.str,
          page: p,
          x: e,
          y: f,
          width: it.width,
          fontSize: Math.hypot(c, d) || Math.abs(d),
          rotated: Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6 || a <= 0,
        }
        const prev = items[items.length - 1]
        if (prev && prev.page === p && !streamText.endsWith('\n')) streamText += touches(prev, item) ? '' : ' '
        items.push(item)
        streamText += it.str + (it.hasEOL ? '\n' : '')
      }
      streamText += '\n'
      const ops = await page.getOperatorList()
      imagesPerPage.push(ops.fnArray.filter((fn) => imageOps.has(fn)).length)
      page.cleanup()
    }
    const meta = await doc.getMetadata()
    const info = { ...(meta.info as Record<string, unknown>) }
    const custom = (info.Custom ?? {}) as Record<string, string>
    const rawAttachments = ((await doc.getAttachments()) ?? {}) as Record<string, { filename: string; content: Uint8Array; description?: string }>
    const attachments = Object.values(rawAttachments).map((a) => ({ filename: a.filename, description: a.description, content: a.content }))
    const language = (info.Language as string | undefined) ?? null
    const lines = groupLines(items)
    return {
      pages: doc.numPages,
      items,
      streamText: normalizeSpaces(streamText),
      lines,
      text: lines.join('\n'),
      info,
      custom,
      language,
      attachments,
      imagesPerPage,
    }
  } finally {
    await doc.destroy()
  }
}

/** Blob → bytes (jsdom Blobs lack arrayBuffer in some versions). */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Uint8Array(await new Response(blob).arrayBuffer())
}
