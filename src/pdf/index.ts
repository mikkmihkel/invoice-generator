// OWNER: documents agent. PDF rendering with pdfmake (vector text, embedded fonts supporting õ ä ö ü š ž).
import type { Invoice, TemplateId } from '../domain/types'

export interface TemplateInfo {
  id: TemplateId
  name: { et: string; en: string }
  description: { et: string; en: string }
}

export const TEMPLATES: TemplateInfo[] = []

/** Render the invoice to a PDF Blob (application/pdf). Must lazy-load pdfmake to keep the initial bundle small. */
export async function renderInvoicePdf(_invoice: Invoice): Promise<Blob> {
  throw new Error('not implemented')
}

/** e.g. "Arve_2026-0007_Klient-OU.pdf" (ASCII-safe). */
export function invoiceFileName(_invoice: Invoice, _ext?: 'pdf' | 'xml'): string {
  throw new Error('not implemented')
}
