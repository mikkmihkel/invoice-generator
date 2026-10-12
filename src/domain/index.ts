// OWNER: domain agent. Public API of the domain layer (calculations, law, validation, numbering).
// Stubs below define the contract; implementations live in sibling files and are re-exported here.
export * from './types'
export { computeTotals, roundMoney, toCents, fromCents, lineNetCents, formatMoney } from './calc'
export { validateInvoice, canIssue } from './validation'
export type { ValidateOptions } from './validation'
export {
  formatInvoiceNumber,
  generateReferenceNumber,
  isValidReferenceNumber,
  referenceCheckDigit,
} from './numbering'
export {
  ESTONIAN_VAT_RATES,
  STANDARD_VAT_RATE,
  HISTORICAL_VAT_RATES,
  EU_COUNTRIES,
  EU_VAT_PREFIXES,
  vatSchemeNote,
  vatSchemeAllowsRates,
  vatSchemeRequiresBuyerVat,
  vatSchemeRequiresSellerVat,
  isValidEstonianRegistryCode,
  isValidEstonianPersonalCode,
  isValidVatNumber,
  isValidIban,
  isEuCountry,
  isEuVatNumber,
  normalizeVatNumber,
  normalizeIban,
  formatIban,
} from './law'
export {
  createEmptyInvoice,
  createDefaultProfile,
  createDefaultSettings,
  newId,
  todayISO,
  addDays,
  toISODate,
  isValidISODate,
  createEmptyLine,
  effectiveVatScheme,
  sellerSnapshot,
  buyerSnapshot,
} from './factory'
export { withVatScheme } from './scheme'
