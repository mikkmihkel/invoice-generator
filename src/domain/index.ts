// OWNER: domain agent. Public API of the domain layer (calculations, law, validation, numbering).
// Stubs below define the contract; implementations live in sibling files and are re-exported here.
export * from './types'
export { computeTotals, roundMoney } from './calc'
export { validateInvoice, canIssue } from './validation'
export { formatInvoiceNumber, generateReferenceNumber, isValidReferenceNumber } from './numbering'
export {
  ESTONIAN_VAT_RATES,
  vatSchemeNote,
  vatSchemeAllowsRates,
  vatSchemeRequiresBuyerVat,
  isValidEstonianRegistryCode,
  isValidVatNumber,
  isValidIban,
} from './law'
export { createEmptyInvoice, createDefaultProfile, createDefaultSettings, newId, todayISO, addDays } from './factory'
