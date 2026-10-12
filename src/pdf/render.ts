// Lazy pdfmake loading: the ~2 MB pdfmake + Roboto VFS bundle is only fetched when a PDF is first rendered.
import type { TCreatedPdf, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { Invoice } from '../domain/types'
import { buildDocDefinition, type DocDefinitionOptions } from './docDefinition'

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

/** Load pdfmake (browser build) and the bundled Roboto fonts, which cover Estonian letters and €. */
export function loadPdfMake(): Promise<PdfMakeApi> {
  if (!loading) {
    loading = Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
      .then(([pdfMakeModule, vfsModule]) => {
        const pdfMake = unwrap<PdfMakeApi>(pdfMakeModule)
        pdfMake.addVirtualFileSystem(unwrap<Record<string, string>>(vfsModule))
        pdfMake.setFonts({
          Roboto: {
            normal: 'Roboto-Regular.ttf',
            bold: 'Roboto-Medium.ttf',
            italics: 'Roboto-Italic.ttf',
            bolditalics: 'Roboto-MediumItalic.ttf',
          },
        })
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

async function createPdf(invoice: Invoice, opts?: DocDefinitionOptions): Promise<TCreatedPdf> {
  const pdfMake = await loadPdfMake()
  return pdfMake.createPdf(buildDocDefinition(invoice, opts))
}

/** Render the invoice to a PDF Blob (application/pdf). */
export async function renderInvoicePdf(invoice: Invoice, opts?: DocDefinitionOptions): Promise<Blob> {
  const pdf = await createPdf(invoice, opts)
  const blob = await pdf.getBlob()
  return blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
}

/** `data:application/pdf;base64,...` — handy for <iframe>/<embed> previews. */
export async function renderInvoicePdfDataUrl(invoice: Invoice, opts?: DocDefinitionOptions): Promise<string> {
  return (await createPdf(invoice, opts)).getDataUrl()
}

/** Raw base64 (no data-URL prefix) — for e-mail attachments and the UBL embedded PDF. */
export async function renderInvoicePdfBase64(invoice: Invoice, opts?: DocDefinitionOptions): Promise<string> {
  return (await createPdf(invoice, opts)).getBase64()
}
