// PDF rendering with pdfmake (vector text, embedded fonts supporting õ ä ö ü š ž).
// pdfmake itself is lazy-loaded inside render.ts; everything else here is light and synchronous.
export { TEMPLATES, type TemplateInfo } from './templates'
export { buildDocDefinition, type DocDefinitionOptions } from './docDefinition'
export {
  renderInvoicePdf,
  renderInvoicePdfDataUrl,
  renderInvoicePdfBase64,
  preloadPdfMake,
  loadPdfMake,
  buildRenderDefinition,
  type RenderOptions,
} from './render'
export {
  epcQrPayload,
  paymentQrEnabled,
  paymentQrPayload,
  pdfMetadata,
  pdfLanguage,
  withMachineLayer,
  embeddedXmlFileName,
  invoiceFacts,
  isRfCreditorReference,
} from './machine'
export { invoiceFileName } from './fileName'
export { formatMoney as formatDocumentMoney, formatDate as formatDocumentDate, toAscii } from './format'
