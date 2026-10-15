// Rasterise a page of a PDF (our own pdfmake output) to an image with pdf.js, loaded lazily on first use.
// pdf.js runs on the main thread: the app's CSP forbids workers (worker-src 'none') and one page renders quickly.
type PdfJs = typeof import('pdfjs-dist')

let loading: Promise<PdfJs> | null = null

function loadPdfJs(): Promise<PdfJs> {
  loading ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs')])
    .then(([pdfjs, worker]) => {
      ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker
      return pdfjs
    })
    .catch((e) => {
      loading = null
      throw e
    })
  return loading
}

export interface PageImage {
  /** PNG data URL. */
  src: string
  /** CSS pixel size the image was rendered for. */
  width: number
  height: number
  /** Number of pages in the whole document, as reported by pdf.js. */
  pageCount?: number
}

/** Render `page` (1-based) of `pdf` at `width` CSS pixels (times the device pixel ratio, capped at 2). */
export async function renderPdfPageImage(pdf: Blob | ArrayBuffer, width: number, page = 1): Promise<PageImage> {
  const pdfjs = await loadPdfJs()
  const data = new Uint8Array(pdf instanceof Blob ? await pdf.arrayBuffer() : pdf)
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, verbosity: pdfjs.VerbosityLevel.ERRORS })
  try {
    const doc = await task.promise
    const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages))
    const base = p.getViewport({ scale: 1 })
    const ratio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1))
    const viewport = p.getViewport({ scale: (width / base.width) * ratio })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await p.render({ canvas, canvasContext: ctx, viewport }).promise
    return { src: canvas.toDataURL('image/png'), width, height: Math.round((base.height / base.width) * width), pageCount: doc.numPages }
  } finally {
    void task.destroy()
  }
}
