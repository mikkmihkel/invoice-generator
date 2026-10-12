/**
 * Shared domain model. Every module (storage, pdf, e-invoice, integrations, UI)
 * codes against these types. Change with care — it is the team's contract.
 *
 * Money is stored as plain numbers in the invoice currency (e.g. 12.5 = 12.50 EUR)
 * for user input; all calculations go through `src/domain/calc.ts`, which works in
 * integer cents internally.
 */

/** Calendar date as `YYYY-MM-DD`. */
export type ISODate = string
/** Timestamp as ISO 8601 string. */
export type ISODateTime = string

/** UI language. */
export type UiLanguage = 'et' | 'en'
/** Language of the invoice document itself. `et-en` = bilingual labels. */
export type InvoiceLanguage = 'et' | 'en' | 'et-en'

/** Visual style of the generated PDF. */
export type TemplateId = 'classic' | 'modern' | 'minimal' | 'bold'

export interface Address {
  /** Street, house and apartment, e.g. "Narva mnt 5-12". */
  street: string
  city: string
  postalCode: string
  /** County / maakond, optional. */
  county?: string
  /** ISO 3166-1 alpha-2, default 'EE'. */
  country: string
}

export interface Party {
  name: string
  /** Estonian business registry code (registrikood, 8 digits) or foreign company ID. */
  registryCode?: string
  /** Personal ID code (isikukood) when the party is a private person. Optional. */
  personalCode?: string
  /** VAT number incl. country prefix, e.g. "EE101234567". */
  vatNumber?: string
  address: Address
  email?: string
  phone?: string
}

export interface BankAccount {
  id: string
  bankName?: string
  /** IBAN without spaces, e.g. "EE382200221020145685". */
  iban: string
  bic?: string
}

/**
 * How VAT applies to the whole invoice. Drives which rates are allowed,
 * which mandatory notes are printed and whether buyer VAT number is required.
 */
export type VatScheme =
  /** Seller is not VAT registered (below threshold) — no VAT is charged or shown. */
  | 'not-registered'
  /** Normal domestic sale with Estonian VAT rates. */
  | 'domestic'
  /** B2B service to an EU VAT payer — reverse charge, 0%, buyer VAT number required. */
  | 'eu-reverse-charge'
  /** Intra-Community supply of goods to an EU VAT payer — 0%, buyer VAT number required. */
  | 'eu-goods'
  /** Export of goods outside the EU — 0%. */
  | 'export'
  /** B2B service to a customer outside the EU — place of supply outside Estonia, not taxable here (KMS § 10). */
  | 'non-eu-services'
  /** VAT-exempt supply (KMS § 16) — legal basis must be stated. */
  | 'exempt'
  /** Domestic reverse charge (KMS § 41¹, e.g. scrap metal, real estate). */
  | 'domestic-reverse-charge'

export interface InvoiceDefaults {
  paymentTermDays: number
  templateId: TemplateId
  /** Hex colour used by templates, e.g. "#1f6feb". */
  accentColor: string
  language: InvoiceLanguage
  /** ISO 4217, default "EUR". */
  currency: string
  vatScheme: VatScheme
  /** Default VAT rate in percent for new lines when vatScheme = 'domestic'. */
  defaultVatRate: number
  /** Default unit for new lines, e.g. "h", "tk", "kuu". */
  defaultUnit: string
  /** Late payment interest in % per day; printed on the invoice if set. */
  lateInterestPercentPerDay?: number
  /** Free text printed in the footer of every invoice. */
  footerNote?: string
  /** Default email subject/body templates. Placeholders: {number} {company} {client} {total} {dueDate} */
  emailSubject: string
  emailBody: string
  /** English templates for invoices in English (and the English half of bilingual emails). Same placeholders. */
  emailSubjectEn?: string
  emailBodyEn?: string
}

export interface NumberingSettings {
  /** e.g. "2026-" or "ARVE-". May contain {YYYY} which is replaced with issue year. */
  prefix: string
  /** Next sequential number to allocate. */
  nextNumber: number
  /** Zero padding width, e.g. 4 → 0007. */
  padding: number
}

/** The user's own (seller) company. Singleton. */
export interface CompanyProfile extends Party {
  vatRegistered: boolean
  bankAccounts: BankAccount[]
  website?: string
  /** PNG/JPEG data URL, max ~200 KB. */
  logoDataUrl?: string
  defaults: InvoiceDefaults
  numbering: NumberingSettings
  updatedAt: ISODateTime
}

export type ClientKind = 'company' | 'person'

export interface Client extends Party {
  id: string
  kind: ClientKind
  contactPerson?: string
  /** Overrides profile default when creating invoices for this client. */
  defaultLanguage?: InvoiceLanguage
  defaultVatScheme?: VatScheme
  notes?: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface InvoiceLine {
  id: string
  description: string
  quantity: number
  /** Unit of measure, e.g. "h", "tk", "kuu". */
  unit: string
  /** Unit price excluding VAT. */
  unitPrice: number
  /** Optional discount in percent (0–100). */
  discountPercent?: number
  /** VAT rate in percent. Ignored (treated as 0 / no VAT) unless vatScheme = 'domestic'. */
  vatRate: number
}

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled'
export type InvoiceType = 'invoice' | 'credit-note' | 'prepayment'

/** Frozen copy of the seller at the time of issuing (later profile edits must not alter issued invoices). */
export type SellerSnapshot = Omit<CompanyProfile, 'defaults' | 'numbering' | 'updatedAt'>

export interface BuyerSnapshot extends Party {
  clientId?: string
  kind: ClientKind
  contactPerson?: string
}

export interface Invoice {
  id: string
  /** Unique sequential number. Empty string while draft has none allocated. */
  number: string
  type: InvoiceType
  status: InvoiceStatus
  /** For credit notes: number of the invoice being credited. */
  creditedInvoiceNumber?: string

  issueDate: ISODate
  dueDate: ISODate
  /** Date of supply (käibe tekkimise kuupäev) if different from issue date. */
  supplyDate?: ISODate
  /** Optional service period. */
  periodStart?: ISODate
  periodEnd?: ISODate

  seller: SellerSnapshot
  buyer: BuyerSnapshot
  /** IBAN ids from seller.bankAccounts to print. Empty = all. */
  bankAccountIds: string[]

  lines: InvoiceLine[]
  currency: string
  vatScheme: VatScheme
  /** Required for vatScheme 'exempt' if the default text is not suitable. */
  vatExemptionNote?: string

  /**
   * Units of the invoice currency per 1 EUR (e.g. 1.0832 for USD). Required when a foreign-currency
   * invoice charges VAT: the VAT amount must also be shown in euros (KMS § 37).
   */
  eurExchangeRate?: number

  /** Estonian payment reference number (viitenumber, 7-3-1 checksum). */
  referenceNumber?: string
  /** Buyer's order / PO number. */
  orderReference?: string
  notes?: string
  lateInterestPercentPerDay?: number
  /** Footer text printed on every page (copied from profile defaults.footerNote when the invoice is created). */
  footerNote?: string

  language: InvoiceLanguage
  templateId: TemplateId
  accentColor: string

  issuedAt?: ISODateTime
  paidAt?: ISODate
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface LineTotals {
  lineId: string
  net: number
  vat: number
  gross: number
}

export interface VatBreakdownRow {
  /** Rate in percent. */
  rate: number
  taxable: number
  vat: number
}

export interface InvoiceTotals {
  lines: LineTotals[]
  vatBreakdown: VatBreakdownRow[]
  net: number
  vat: number
  gross: number
  /** Whether VAT columns should be shown at all. */
  showVat: boolean
}

export interface ValidationIssue {
  /** Dot path, e.g. "buyer.vatNumber" or "lines.2.description". */
  field: string
  severity: 'error' | 'warning'
  /** Already-translated messages. */
  message: { et: string; en: string }
  /** Legal source, e.g. "KMS § 37 lg 5 p 4". */
  legalBasis?: string
}

export interface AppSettings {
  uiLanguage: UiLanguage
  /** Google OAuth 2.0 Web client ID; enables Drive + Gmail features. */
  googleClientId?: string
  /** Drive folder name for exported PDFs. */
  driveFolderName: string
  /** Try the live e-Business Register autocomplete API in addition to the bundled index. */
  registryLiveLookup: boolean
  updatedAt: ISODateTime
}

/** A company as found in the Estonian e-Business Register (Äriregister). */
export interface RegistryCompany {
  registryCode: string
  name: string
  vatNumber?: string
  /** e.g. "OÜ", "AS", "FIE", "MTÜ". */
  legalForm?: string
  /** e.g. "Registrisse kantud", "Likvideerimisel", "Kustutatud". */
  status?: string
  address?: Address
  /** Free-text full address as given by the register. */
  addressText?: string
}

export interface BackupFile {
  app: 'invoice-generator'
  version: 1
  exportedAt: ISODateTime
  profile: CompanyProfile | null
  clients: Client[]
  invoices: Invoice[]
  settings: AppSettings | null
}
