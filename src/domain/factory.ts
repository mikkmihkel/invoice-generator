import { isColorMode, isHexColor } from './brand'
import { STANDARD_VAT_RATE } from './law'
import type {
  AppSettings,
  BuyerSnapshot,
  Client,
  CompanyProfile,
  Invoice,
  InvoiceLine,
  SellerSnapshot,
  VatScheme,
} from './types'

export function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Format a Date as local calendar date `YYYY-MM-DD`. */
export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** Today's date in the user's local time zone (not UTC). */
export function todayISO(): string {
  return toISODate(new Date())
}

/** Strictly parse `YYYY-MM-DD`; returns null for malformed or impossible dates (e.g. 2026-02-30). */
export function parseISODate(date: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '')
  if (!match) return null
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return { y, m, d }
}

export function isValidISODate(date: string): boolean {
  return parseISODate(date) !== null
}

/** Add calendar days to `YYYY-MM-DD` (DST-safe, works with negative days). */
export function addDays(date: string, days: number): string {
  const p = parseISODate(date)
  if (!p) throw new Error(`Invalid date: ${date}`)
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + Math.trunc(days)))
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

export const DEFAULT_EMAIL_SUBJECT_ET = 'Arve {number} – {company}'
export const DEFAULT_EMAIL_BODY_ET =
  'Tere!\n\n' + 'Manuses on arve nr {number} summas {total}. Palume arve tasuda hiljemalt {dueDate}.\n\n' + 'Lugupidamisega\n{company}'
export const DEFAULT_EMAIL_SUBJECT_EN = 'Invoice {number} from {company}'
export const DEFAULT_EMAIL_BODY_EN =
  'Hello,\n\n' + 'Please find attached invoice no. {number} for {total}. Kindly pay by {dueDate}.\n\n' + 'Best regards,\n{company}'

export function createDefaultProfile(): CompanyProfile {
  return {
    name: '',
    registryCode: '',
    vatNumber: '',
    address: { street: '', city: '', postalCode: '', country: 'EE' },
    email: '',
    phone: '',
    vatRegistered: false,
    bankAccounts: [],
    defaults: {
      paymentTermDays: 14,
      templateId: 'standard',
      accentColor: '#1f4e79',
      language: 'et',
      currency: 'EUR',
      vatScheme: 'not-registered',
      defaultVatRate: STANDARD_VAT_RATE,
      defaultUnit: 'tk',
      emailSubject: DEFAULT_EMAIL_SUBJECT_ET,
      emailBody: DEFAULT_EMAIL_BODY_ET,
      emailSubjectEn: DEFAULT_EMAIL_SUBJECT_EN,
      emailBodyEn: DEFAULT_EMAIL_BODY_EN,
    },
    numbering: { prefix: '{YYYY}-', nextNumber: 1, padding: 4 },
    updatedAt: new Date().toISOString(),
  }
}

export function createDefaultSettings(): AppSettings {
  return {
    uiLanguage: 'et',
    driveFolderName: 'Arved',
    registryLiveLookup: true,
    updatedAt: new Date().toISOString(),
  }
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))
}

/** Frozen copy of the seller for an invoice (profile edits must not alter issued invoices). */
export function sellerSnapshot(profile: CompanyProfile): SellerSnapshot {
  const { defaults: _defaults, numbering: _numbering, updatedAt: _updatedAt, ...seller } = profile
  return clone(seller)
}

/**
 * Seller copy kept on a draft: without the logo, which can be large and would be rewritten by every autosave.
 * Drafts are displayed with the current profile (UI `effectiveInvoice`); issueInvoice snapshots the full seller.
 */
export function draftSellerSnapshot(profile: CompanyProfile): SellerSnapshot {
  const { logoDataUrl: _logo, ...seller } = sellerSnapshot(profile)
  return seller
}

export function buyerSnapshot(client: Client): BuyerSnapshot {
  const { id, kind, contactPerson, name, registryCode, personalCode, vatNumber, address, email, phone } = client
  const buyer: BuyerSnapshot = { clientId: id, kind, name, address: clone(address) }
  if (registryCode) buyer.registryCode = registryCode
  if (personalCode) buyer.personalCode = personalCode
  if (vatNumber) buyer.vatNumber = vatNumber
  if (email) buyer.email = email
  if (phone) buyer.phone = phone
  if (contactPerson) buyer.contactPerson = contactPerson
  return buyer
}

/** VAT scheme consistent with the seller's registration: non-registered sellers can only use 'not-registered'. */
export function effectiveVatScheme(profile: CompanyProfile, preferred: VatScheme): VatScheme {
  if (!profile.vatRegistered) return 'not-registered'
  return preferred === 'not-registered' ? 'domestic' : preferred
}

export function createEmptyLine(profile: CompanyProfile, vatScheme: VatScheme): InvoiceLine {
  return {
    id: newId(),
    description: '',
    quantity: 1,
    unit: profile.defaults.defaultUnit,
    unitPrice: 0,
    vatRate: vatScheme === 'domestic' ? profile.defaults.defaultVatRate : 0,
  }
}

/** New draft invoice pre-filled from the profile defaults (and client overrides, if given). Number is ''. */
export function createEmptyInvoice(profile: CompanyProfile, client?: Client): Invoice {
  const defaults = profile.defaults
  const vatScheme = effectiveVatScheme(profile, client?.defaultVatScheme ?? defaults.vatScheme)
  const issueDate = todayISO()
  const now = new Date().toISOString()
  const invoice: Invoice = {
    id: newId(),
    number: '',
    type: 'invoice',
    status: 'draft',
    issueDate,
    dueDate: addDays(issueDate, defaults.paymentTermDays),
    seller: draftSellerSnapshot(profile),
    buyer: client
      ? buyerSnapshot(client)
      : { kind: 'company', name: '', address: { street: '', city: '', postalCode: '', country: 'EE' } },
    bankAccountIds: profile.bankAccounts.map((a) => a.id),
    lines: [createEmptyLine(profile, vatScheme)],
    currency: defaults.currency,
    vatScheme,
    language: client?.defaultLanguage ?? defaults.language,
    templateId: defaults.templateId,
    accentColor: defaults.accentColor,
    createdAt: now,
    updatedAt: now,
  }
  if (defaults.lateInterestPercentPerDay !== undefined) {
    invoice.lateInterestPercentPerDay = defaults.lateInterestPercentPerDay
  }
  if (defaults.footerNote) invoice.footerNote = defaults.footerNote
  if (defaults.paymentQr) invoice.paymentQr = true
  if (isHexColor(defaults.secondaryColor)) invoice.secondaryColor = defaults.secondaryColor
  if (isColorMode(defaults.colorMode)) invoice.colorMode = defaults.colorMode
  return invoice
}
