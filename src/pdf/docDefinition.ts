import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import type { Invoice } from '../domain/types'
import { createContext, type DocContext } from './context'
import { TEMPLATE_BUILDERS } from './templates'

export interface DocDefinitionOptions {
  /**
   * Diagonal watermark: `true` = automatic ("MUSTAND" for drafts, "TÜHISTATUD" for cancelled invoices),
   * `false` = never. Default `true`.
   */
  watermark?: boolean
}

function watermarkText(ctx: DocContext): string | null {
  const { status } = ctx.invoice
  if (status === 'draft') return ctx.t('draft')
  if (status === 'cancelled') return ctx.t('cancelled')
  return null
}

/** Pure pdfmake document definition for the invoice (template and language taken from the invoice). */
export function buildDocDefinition(invoice: Invoice, opts: DocDefinitionOptions = {}): TDocumentDefinitions {
  const ctx = createContext(invoice)
  const build = TEMPLATE_BUILDERS[invoice.templateId] ?? TEMPLATE_BUILDERS.classic
  const tpl = build(ctx)
  const wm = opts.watermark === false ? null : watermarkText(ctx)
  const docTitle = [ctx.title, invoice.number].filter(Boolean).join(' ')
  const def: TDocumentDefinitions & { language?: string } = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    ...tpl,
    defaultStyle: { font: 'Roboto', lineHeight: 1.2, ...tpl.defaultStyle },
    info: {
      title: docTitle,
      author: invoice.seller.name,
      subject: `${docTitle} — ${invoice.buyer.name}`,
      creator: 'Invoice generator',
      producer: 'Invoice generator (pdfmake)',
    },
    language: ctx.lang === 'en' ? 'en' : 'et',
  }
  if (wm) def.watermark = { text: wm, color: '#9ca3af', opacity: 0.12, bold: true, fontSize: 72 }
  return def
}
