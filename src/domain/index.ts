// Public API of the domain layer (calculations, law, validation, numbering).
export * from './types'
export { computeTotals, roundMoney, toCents, fromCents, lineNetCents, formatMoney, vatInEur } from './calc'
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
  vatNoteMode,
  vatNoteRelevant,
  NOTE_REPLACEABLE,
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
  DEFAULT_EMAIL_SUBJECT_ET,
  DEFAULT_EMAIL_BODY_ET,
  DEFAULT_EMAIL_SUBJECT_EN,
  DEFAULT_EMAIL_BODY_EN,
  createDefaultSettings,
  newId,
  todayISO,
  addDays,
  toISODate,
  isValidISODate,
  createEmptyLine,
  effectiveVatScheme,
  sellerSnapshot,
  draftSellerSnapshot,
  buyerSnapshot,
  textRows,
} from './factory'
export { withVatScheme } from './scheme'
export { selectedBankAccounts } from './accounts'
export { COLOR_MODES, HEX_COLOR_PATTERN, MIN_TEXT_CONTRAST, colorModeOf, contrastRatio, hexOr, isColorMode, isHexColor, relativeLuminance } from './brand'
export { creditNotesFor, creditedAmount, outstandingAmount } from './settlement'
