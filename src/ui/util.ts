import {
  computeTotals,
  newId,
  type Address,
  type BuyerSnapshot,
  type Client,
  type CompanyProfile,
  type Invoice,
  type InvoiceTotals,
  type Party,
  type RegistryCompany,
  type SellerSnapshot,
} from '../domain'

export type DisplayStatus = 'draft' | 'issued' | 'paid' | 'overdue' | 'cancelled'

export function localTodayISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function nowISO(): string {
  return new Date().toISOString()
}

/** 'overdue' is derived: issued, unpaid and past due date. */
export function displayStatus(inv: Pick<Invoice, 'status' | 'dueDate'>, today = localTodayISO()): DisplayStatus {
  if (inv.status === 'issued' && inv.dueDate && inv.dueDate < today) return 'overdue'
  return inv.status
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + 'T00:00:00Z')
  const b = Date.parse(toISO + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

export function addDaysISO(dateISO: string, days: number): string {
  const t = Date.parse(dateISO + 'T00:00:00Z')
  if (Number.isNaN(t)) return dateISO
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10)
}

const ZERO_TOTALS: InvoiceTotals = { lines: [], vatBreakdown: [], net: 0, vat: 0, gross: 0, showVat: false }

/** computeTotals, but never throws (the UI must keep rendering even on a bad line). */
export function safeTotals(inv: Pick<Invoice, 'lines' | 'vatScheme'>): InvoiceTotals {
  try {
    return computeTotals(inv)
  } catch (e) {
    console.error('computeTotals failed', e)
    return ZERO_TOTALS
  }
}

export function sellerSnapshot(profile: CompanyProfile): SellerSnapshot {
  const { defaults: _d, numbering: _n, updatedAt: _u, ...rest } = profile
  return structuredCloneSafe(rest)
}

/** Drafts always show the current company profile; issued invoices keep their frozen snapshot. */
export function effectiveInvoice(inv: Invoice, profile: CompanyProfile | null): Invoice {
  if (inv.status !== 'draft' || !profile) return inv
  return { ...inv, seller: sellerSnapshot(profile) }
}

export function buyerFromClient(c: Client): BuyerSnapshot {
  return {
    clientId: c.id,
    kind: c.kind,
    name: c.name,
    registryCode: c.registryCode,
    personalCode: c.personalCode,
    vatNumber: c.vatNumber,
    address: { ...c.address },
    email: c.email,
    phone: c.phone,
    contactPerson: c.contactPerson,
  }
}

export function emptyAddress(): Address {
  return { street: '', city: '', postalCode: '', country: 'EE' }
}

export function addressFromRegistry(r: RegistryCompany): Address {
  if (r.address) return { ...emptyAddress(), ...r.address }
  return { ...emptyAddress(), street: r.addressText ?? '' }
}

export function partyFromRegistry(r: RegistryCompany): Party {
  return {
    name: r.name,
    registryCode: r.registryCode,
    vatNumber: r.vatNumber || undefined,
    address: addressFromRegistry(r),
  }
}

export function newClient(partial: Partial<Client> = {}): Client {
  const now = nowISO()
  return {
    id: newId(),
    kind: 'company',
    name: '',
    address: emptyAddress(),
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

export function clientFromRegistry(r: RegistryCompany): Client {
  return newClient({ ...partyFromRegistry(r), kind: 'company' })
}

export function formatAddress(a: Address | undefined): string {
  if (!a) return ''
  const cityLine = [a.postalCode, a.city].filter(Boolean).join(' ')
  return [a.street, cityLine, a.county, a.country && a.country !== 'EE' ? a.country : '']
    .filter((s) => s && s.trim())
    .join(', ')
}

/** Replace {placeholders}; unknown placeholders are left as is. */
export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}

/** Sum amounts per currency → "1200,00 € · 50,00 $". */
export function sumByCurrency(items: { amount: number; currency: string }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of items) m.set(it.currency, (m.get(it.currency) ?? 0) + it.amount)
  return m
}

export function structuredCloneSafe<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))
}

let errorLanguage: 'et' | 'en' = 'et'
/** Set by AppProvider so error texts follow the UI language. */
export function setErrorLanguage(lang: 'et' | 'en') {
  errorLanguage = lang
}

/**
 * User-facing text for an error. Understands the bilingual errors of other modules
 * (RepositoryError / GoogleApiError `.messages`, InvoiceValidationError `.issues`).
 */
export function errorMessage(e: unknown): string {
  const x = e as { messages?: { et?: string; en?: string }; issues?: { severity: string; message: { et: string; en: string } }[] } | null
  if (x && Array.isArray(x.issues)) {
    const errs = x.issues.filter((i) => i.severity === 'error')
    if (errs.length) return errs.map((i) => i.message[errorLanguage] || i.message.et).join(' ')
  }
  if (x && x.messages && typeof x.messages[errorLanguage] === 'string') return x.messages[errorLanguage] as string
  if (e instanceof Error) return e.message
  return String(e)
}

const LAST_BACKUP_KEY = 'invoice-generator:lastBackupAt'

export function getLastBackupAt(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY)
  } catch {
    return null
  }
}

export function markBackupDone(at = new Date().toISOString()) {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, at)
  } catch {
    /* storage unavailable */
  }
}

/** Resize an image file to at most `maxWidth` px wide and return a PNG data URL. */
export async function resizeImageToDataUrl(file: File, maxWidth = 400): Promise<string> {
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('invalid image'))
    i.src = src
  })
  const w = img.naturalWidth || img.width || maxWidth
  const h = img.naturalHeight || img.height || maxWidth
  const scale = Math.min(1, maxWidth / w)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

/** Guess bank name + BIC from an Estonian IBAN's bank code (only used to prefill empty fields). */
export function estonianBankFromIban(iban: string): { bankName: string; bic: string } | null {
  const s = iban.replace(/\s+/g, '').toUpperCase()
  if (!s.startsWith('EE') || s.length < 6) return null
  const banks: Record<string, { bankName: string; bic: string }> = {
    '22': { bankName: 'Swedbank', bic: 'HABAEE2X' },
    '10': { bankName: 'SEB Pank', bic: 'EEUHEE2X' },
    '77': { bankName: 'LHV Pank', bic: 'LHVBEE22' },
    '42': { bankName: 'Coop Pank', bic: 'EKRDEE22' },
    '96': { bankName: 'Luminor', bic: 'RIKOEE22' },
    '17': { bankName: 'Luminor', bic: 'RIKOEE22' },
  }
  return banks[s.slice(4, 6)] ?? null
}

/** Sort like the repository: newest issueDate first, then createdAt. */
export function sortInvoices(list: Invoice[]): Invoice[] {
  return [...list].sort((a, b) => {
    if (a.issueDate !== b.issueDate) return a.issueDate < b.issueDate ? 1 : -1
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  })
}
