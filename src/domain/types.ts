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

/** Visual style of the generated PDF. `standard` is the default for new profiles; `compact` suits long invoices. */
export type TemplateId = 'standard' | 'classic' | 'modern' | 'minimal' | 'bold' | 'compact'

/**
 * How the brand colours are used on the PDF: `mono` = ink and greys only (colour only in the logo),
 * `accent` = the primary colour as accent (default), `duo` = primary + secondary colour.
 */
export type ColorMode = 'mono' | 'accent' | 'duo'

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
  /** Optional second brand colour (`#rrggbb`), used when `colorMode` is 'duo'. */
  secondaryColor?: string
  /** How the colours are applied; absent = 'accent'. */
  colorMode?: ColorMode
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
  /** Default for `Invoice.paymentQr` on new invoices. Optional; absent = off. */
  paymentQr?: boolean
  /** Default free-text rows copied into `Invoice.textBefore` on new invoices. */
  textBefore?: string[]
  /** Default free-text rows copied into `Invoice.textAfter` on new invoices. */
  textAfter?: string[]
}

/** When the running number starts again from 1. */
export type NumberingReset = 'never' | 'yearly' | 'monthly' | 'daily'

export interface NumberingSettings {
  /**
   * e.g. "2026-", "ARVE-" or "{YYYYMMDD}". Date tokens are replaced from the document's issue date:
   * {YYYY} {YY} {MM} {DD} {YYYYMMDD}.
   */
  prefix: string
  /** Next sequential number to allocate when `reset` is 'never' (or missing). */
  nextNumber: number
  /** Zero padding width, e.g. 4 → 0007, 3 → 001. */
  padding: number
  /** Missing means 'never' (one running sequence). */
  reset?: NumberingReset
  /** Next number per reset period, keyed by period: '2026', '2026-10' or '2026-10-15'. */
  counters?: Record<string, number>
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
  /** Separate number series for quotes (hinnapakkumised). Missing means the built-in default series. */
  quoteNumbering?: NumberingSettings
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
/** 'quote' is a hinnapakkumine: not an invoice for accounting, numbered from its own series. */
export type InvoiceType = 'invoice' | 'credit-note' | 'prepayment' | 'quote'

/** Frozen copy of the seller at the time of issuing (later profile edits must not alter issued invoices). */
export type SellerSnapshot = Omit<CompanyProfile, 'defaults' | 'numbering' | 'quoteNumbering' | 'updatedAt'>

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
  /** Quotes: last day the offer is valid. */
  validUntil?: ISODate
  /** Quotes: when the client accepted (set on conversion). */
  quoteAcceptedAt?: ISODateTime
  /** Quotes: id of the invoice created from this quote. */
  convertedToInvoiceId?: string
  /** Invoices: id of the quote this invoice was created from. */
  convertedFromQuoteId?: string
  /** Drafts created by a recurring rule, and the source invoice of a rule. */
  recurringRuleId?: string

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
  /**
   * Free-text rows printed directly above the line table (after seller/buyer). Each item is one row and may
   * contain line breaks; blank items are ignored when rendering.
   */
  textBefore?: string[]
  /** Free-text rows printed directly after the totals block (before payment details). */
  textAfter?: string[]
  lateInterestPercentPerDay?: number
  /** Footer text printed on every page (copied from profile defaults.footerNote when the invoice is created). */
  footerNote?: string

  language: InvoiceLanguage
  templateId: TemplateId
  accentColor: string
  /** Snapshot of `InvoiceDefaults.secondaryColor` (or a per-invoice override). */
  secondaryColor?: string
  /** Snapshot of `InvoiceDefaults.colorMode`; absent = 'accent'. */
  colorMode?: ColorMode
  /**
   * Print an EPC069-12 "SEPA Credit Transfer" QR code (scan-to-pay) on the PDF. Optional, default off.
   * Only effective for EUR invoices with a positive total and an IBAN (see `src/pdf/machine.ts`).
   */
  paymentQr?: boolean

  issuedAt?: ISODateTime
  /**
   * Set while an issued document that was not sent yet is open for editing again: it is a draft that keeps its
   * number, and issuing it again keeps that number. Removed when it is issued.
   */
  reopenedAt?: ISODateTime
  /**
   * Issue date the document had when it was reopened. Its number belongs to that date's numbering period, so the
   * date may only move within that period until it is issued again. Removed when it is issued.
   */
  reopenedIssueDate?: ISODate
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

/** Colour theme of the app: follow the operating system, or force light/dark. */
export type UiTheme = 'auto' | 'light' | 'dark'

export interface AppSettings {
  uiLanguage: UiLanguage
  /** Missing means 'auto'. */
  theme?: UiTheme
  /**
   * The user's own Google OAuth 2.0 Web client ID ("advanced"): overrides the site's built-in client and is the only
   * way to enable Gmail sending.
   */
  googleClientId?: string
  /** Automatic backups to Google Drive after changes. Missing means off. */
  autoBackup?: AutoBackupSettings
  /**
   * Drive folder name for PDFs and backups, found or created by name. Used until the user chooses a folder
   * (`driveFolder`).
   */
  driveFolderName: string
  /**
   * Drive folder chosen by the user (Google Picker or created by the app), by ID. PDFs go to its subfolder "Arved",
   * backups to "Varukoopiad".
   */
  driveFolder?: DriveFolderChoice
  /** Upload the PDF of each issued invoice to the chosen Drive folder. Missing means on. */
  autoSavePdf?: boolean
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

export interface DriveFolderChoice {
  /** Drive file ID of the folder. */
  id: string
  /** Its name when chosen (for display only; the folder may be renamed or moved in Drive). */
  name: string
}

export interface AutoBackupSettings {
  enabled: boolean
  /** Encrypt backup files with a passphrase (the passphrase itself is never stored). */
  encrypt: boolean
  /** How many backup versions to keep in the Drive folder. */
  keepVersions: number
  lastBackupAt?: ISODateTime
}

/** A saved product or service, offered while typing an invoice line. */
export interface Product {
  id: string
  description: string
  unit: string
  /** Unit price excluding VAT, in EUR unless the invoice says otherwise. */
  unitPrice: number
  /** Missing means the profile default rate. */
  vatRate?: number
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type RecurrenceInterval = 'monthly' | 'quarterly' | 'yearly'

/** Prepares a new draft from a source invoice on a schedule (drafts are created when the app is opened). */
export interface RecurringRule {
  id: string
  sourceInvoiceId: string
  interval: RecurrenceInterval
  /** Issue date of the next draft to prepare. */
  nextDate: ISODate
  active: boolean
  lastCreatedInvoiceId?: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/** Things that happened to an issued document (issued documents themselves are immutable). */
export interface InvoiceEvent {
  id: string
  invoiceId: string
  kind: 'sent' | 'reminder'
  at: ISODateTime
  /** e.g. the recipient or the reminder level. */
  note?: string
}

export interface BackupFile {
  app: 'invoice-generator'
  /** 2 adds products, recurringRules, events and deleted (all optional when reading). */
  version: 1 | 2
  exportedAt: ISODateTime
  profile: CompanyProfile | null
  clients: Client[]
  invoices: Invoice[]
  settings: AppSettings | null
  products?: Product[]
  recurringRules?: RecurringRule[]
  events?: InvoiceEvent[]
  /** Documents deleted on purpose, so that merging an older backup does not bring them back. */
  deleted?: DeletionRecord[]
}

/** Kept for a deleted document so that a backup taken before the deletion does not bring it back. */
export interface DeletionRecord {
  /** Id of the deleted document. */
  id: string
  number: string
  type: InvoiceType
  deletedAt: ISODateTime
}
