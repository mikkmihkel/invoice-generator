// Lazy pdfmake loading: pdfmake and the IBM Plex fonts (src/pdf/fonts.ts) are only fetched when a PDF is first rendered.
import type { TCreatedPdf, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { Invoice } from '../domain/types'
import { buildDocDefinition, type DocDefinitionOptions } from './docDefinition'
import { withMachineLayer } from './machine'

interface PdfMakeApi {
  createPdf(def: TDocumentDefinitions): TCreatedPdf
  addVirtualFileSystem(vfs: Record<string, string>): void
  setFonts(fonts: Record<string, { normal: string; bold: string; italics: string; bolditalics: string }>): void
  setUrlAccessPolicy?(cb: (url: string) => boolean): void
}

let loading: Promise<PdfMakeApi> | null = null

function unwrap<T>(mod: unknown): T {
  const m = mod as { default?: unknown }
  return (m && typeof m === 'object' && 'default' in m && m.default ? m.default : mod) as T
}

/** Load pdfmake (browser build) and the IBM Plex fonts, which cover Estonian letters and €. */
export function loadPdfMake(): Promise<PdfMakeApi> {
  if (!loading) {
    loading = Promise.all([import('pdfmake/build/pdfmake'), import('./fonts').then(async (f) => ({ vfs: await f.loadFontVfs(), families: f.FONT_FAMILIES }))])
      .then(([pdfMakeModule, fonts]) => {
        const pdfMake = unwrap<PdfMakeApi>(pdfMakeModule)
        pdfMake.addVirtualFileSystem(fonts.vfs)
        pdfMake.setFonts(fonts.families)
        // Only embedded data-URL images are used; never fetch remote resources.
        pdfMake.setUrlAccessPolicy?.(() => false)
        return pdfMake
      })
      .catch((err) => {
        loading = null
        throw err
      })
  }
  return loading
}

/** Start downloading pdfmake in the background (e.g. when the invoice editor opens). */
export function preloadPdfMake(): void {
  void loadPdfMake().catch(() => undefined)
}

export interface RenderOptions extends DocDefinitionOptions {
  /**
   * Embed the UBL e-invoice XML as a PDF attachment (issued documents only). Default `true`; pass `false` for
   * the PDF that itself goes inside a UBL file, where the XML would only be a redundant copy.
   */
  embedEInvoice?: boolean
}

/** Final document definition: template layout + machine layer (metadata, /Lang, embedded UBL). */
export function buildRenderDefinition(invoice: Invoice, opts: RenderOptions = {}): TDocumentDefinitions {
  return withMachineLayer(buildDocDefinition(invoice, opts), invoice, { embedEInvoice: opts.embedEInvoice !== false })
}

async function createPdf(invoice: Invoice, opts?: RenderOptions): Promise<TCreatedPdf> {
  const pdfMake = await loadPdfMake()
  return pdfMake.createPdf(buildRenderDefinition(invoice, opts))
}

/** Render the invoice to a PDF Blob (application/pdf). */
export async function renderInvoicePdf(invoice: Invoice, opts?: RenderOptions): Promise<Blob> {
  const pdf = await createPdf(invoice, opts)
  const blob = await pdf.getBlob()
  return blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
}

/** `data:application/pdf;base64,...` — handy for <iframe>/<embed> previews. */
export async function renderInvoicePdfDataUrl(invoice: Invoice, opts?: RenderOptions): Promise<string> {
  return (await createPdf(invoice, opts)).getDataUrl()
}

/** Raw base64 (no data-URL prefix) — for e-mail attachments and the UBL embedded PDF. */
export async function renderInvoicePdfBase64(invoice: Invoice, opts?: RenderOptions): Promise<string> {
  return (await createPdf(invoice, opts)).getBase64()
}
