// Period export for the accountant: one CSV row per invoice / credit note, and a ZIP with the CSV, the PDFs and the
// e-invoice XML files. Drafts and quotes are never exported.
import { computeTotals, roundMoney, type Invoice, type InvoiceType, type ISODate, type UiLanguage, type VatScheme } from '../domain'
import { buildUblXml } from '../einvoice'
import { invoiceFileName, renderInvoicePdf } from '../pdf'
import { toCsv, type CsvCell } from './csv'
import { createZip, type ZipEntry } from './zip'

export type ExportPeriod = 'this-month' | 'last-month' | 'this-quarter' | 'last-quarter' | 'this-year' | 'last-year'

export interface DateRange {
  from: ISODate
  to: ISODate
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** Calendar range of a preset period relative to `today` (YYYY-MM-DD). */
export function periodRange(period: ExportPeriod, today: ISODate): DateRange {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const month = (yy: number, mm: number): DateRange => ({ from: iso(yy, mm, 1), to: iso(yy, mm, lastDay(yy, mm)) })
  const quarter = (yy: number, q: number): DateRange => ({ from: iso(yy, q * 3 - 2, 1), to: iso(yy, q * 3, lastDay(yy, q * 3)) })
  const q = Math.ceil(m / 3)
  switch (period) {
    case 'this-month':
      return month(y, m)
    case 'last-month':
      return m === 1 ? month(y - 1, 12) : month(y, m - 1)
    case 'this-quarter':
      return quarter(y, q)
    case 'last-quarter':
      return q === 1 ? quarter(y - 1, 4) : quarter(y, q - 1)
    case 'this-year':
      return { from: iso(y, 1, 1), to: iso(y, 12, 31) }
    case 'last-year':
      return { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31) }
  }
}

export interface ExportSelection extends DateRange {
  /** Invoices and prepayment invoices. */
  invoices: boolean
  creditNotes: boolean
}

/** Issued (or later paid / cancelled) invoices and credit notes; never drafts or quotes. */
export function isExportable(inv: Pick<Invoice, 'status' | 'type' | 'number'>): boolean {
  return inv.status !== 'draft' && inv.type !== 'quote' && !!inv.number
}

/** Documents in the selection, by issue date (inclusive range) and then number. */
export function selectForExport(all: readonly Invoice[], sel: ExportSelection): Invoice[] {
  return all
    .filter((inv) => {
      if (!isExportable(inv)) return false
      if (inv.issueDate < sel.from || inv.issueDate > sel.to) return false
      return inv.type === 'credit-note' ? sel.creditNotes : sel.invoices
    })
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number, 'et', { numeric: true }))
}

/** Rates that always get their own columns; other rates found in the data (e.g. 22 % on old supplies) are added. */
export const EXPORT_VAT_RATES: readonly number[] = [24, 13, 9]

type Bucket = 'zero' | 'exempt' | 'reverse' | 'outside'

/** Where a non-domestic scheme's (VAT-free) net amount goes. */
const SCHEME_BUCKET: Record<Exclude<VatScheme, 'domestic'>, Bucket> = {
  'eu-goods': 'zero',
  export: 'zero',
  exempt: 'exempt',
  'eu-reverse-charge': 'reverse',
  'domestic-reverse-charge': 'reverse',
  'non-eu-services': 'outside',
  'not-registered': 'outside',
}

const TEXT = {
  et: {
    number: 'Number',
    type: 'Liik',
    issueDate: 'Kuupäev',
    supplyDate: 'Käibe kuupäev',
    dueDate: 'Maksetähtaeg',
    buyer: 'Ostja',
    buyerCode: 'Ostja registrikood',
    buyerVat: 'Ostja KMKR nr',
    currency: 'Valuuta',
    scheme: 'Käibemaksu käsitlus',
    net: 'Summa km-ta',
    taxable: (r: number) => `Käive ${r}%`,
    vat: (r: number) => `Käibemaks ${r}%`,
    zero: 'Käive 0%',
    exempt: 'Maksuvaba käive',
    reverse: 'Pöördmaksustatav käive',
    outside: 'Muu käive km-ta',
    vatTotal: 'Käibemaks kokku',
    total: 'Summa kokku',
    totalEur: 'Summa kokku EUR',
    status: 'Staatus',
    paidAt: 'Tasumise kuupäev',
    credited: 'Krediteeritud arve nr',
    types: { invoice: 'Arve', 'credit-note': 'Kreeditarve', prepayment: 'Ettemaksuarve', quote: 'Hinnapakkumine' },
    statuses: { draft: 'Mustand', issued: 'Väljastatud', paid: 'Tasutud', cancelled: 'Tühistatud' },
    schemes: {
      domestic: 'Eesti käibemaks',
      'not-registered': 'Müüja ei ole käibemaksukohustuslane',
      'eu-reverse-charge': 'Teenus ELi ettevõttele (pöördmaksustamine)',
      'eu-goods': 'Ühendusesisene kaubatarne',
      export: 'Kauba eksport',
      'non-eu-services': 'Teenus väljapoole ELi',
      exempt: 'Maksuvaba',
      'domestic-reverse-charge': 'Siseriiklik pöördmaksustamine',
    },
  },
  en: {
    number: 'Number',
    type: 'Type',
    issueDate: 'Issue date',
    supplyDate: 'Supply date',
    dueDate: 'Due date',
    buyer: 'Buyer',
    buyerCode: 'Buyer registry code',
    buyerVat: 'Buyer VAT number',
    currency: 'Currency',
    scheme: 'VAT treatment',
    net: 'Net amount',
    taxable: (r: number) => `Taxable ${r}%`,
    vat: (r: number) => `VAT ${r}%`,
    zero: 'Supply 0%',
    exempt: 'Exempt supply',
    reverse: 'Reverse charge supply',
    outside: 'Other supply without VAT',
    vatTotal: 'VAT total',
    total: 'Total',
    totalEur: 'Total EUR',
    status: 'Status',
    paidAt: 'Paid on',
    credited: 'Credited invoice number',
    types: { invoice: 'Invoice', 'credit-note': 'Credit note', prepayment: 'Prepayment invoice', quote: 'Quote' },
    statuses: { draft: 'Draft', issued: 'Issued', paid: 'Paid', cancelled: 'Cancelled' },
    schemes: {
      domestic: 'Estonian VAT',
      'not-registered': 'Seller not VAT registered',
      'eu-reverse-charge': 'Service to EU business (reverse charge)',
      'eu-goods': 'Intra-Community supply of goods',
      export: 'Export of goods',
      'non-eu-services': 'Service outside the EU',
      exempt: 'Exempt',
      'domestic-reverse-charge': 'Domestic reverse charge',
    },
  },
} as const satisfies Record<UiLanguage, { types: Record<InvoiceType, string>; schemes: Record<VatScheme, string> } & Record<string, unknown>>

/** "2026-10-15" → "15.10.2026" (read as a date by Estonian spreadsheets). */
function csvDate(value: ISODate | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/** Gross converted to EUR (invoice-currency units per 1 EUR); null when the rate is missing. */
export function totalInEur(inv: Pick<Invoice, 'currency' | 'eurExchangeRate'>, gross: number): number | null {
  if ((inv.currency || 'EUR').toUpperCase() === 'EUR') return gross
  const rate = inv.eurExchangeRate
  return rate && Number.isFinite(rate) && rate > 0 ? roundMoney(gross / rate) : null
}

/** VAT-rate columns for these documents: the standard ones plus any other non-zero domestic rate used. */
export function vatRateColumns(docs: readonly Invoice[]): number[] {
  const rates = new Set(EXPORT_VAT_RATES)
  for (const inv of docs) {
    if (inv.vatScheme !== 'domestic') continue
    for (const line of inv.lines) if (Number.isFinite(line.vatRate) && line.vatRate !== 0) rates.add(line.vatRate)
  }
  return [...rates].sort((a, b) => b - a)
}

/** Header and data rows of the accountant CSV (amounts as numbers, in the document currency). */
export function accountantRows(docs: readonly Invoice[], lang: UiLanguage = 'et'): CsvCell[][] {
  const L = TEXT[lang === 'en' ? 'en' : 'et']
  const rates = vatRateColumns(docs)
  const header: CsvCell[] = [
    L.number,
    L.type,
    L.issueDate,
    L.supplyDate,
    L.dueDate,
    L.buyer,
    L.buyerCode,
    L.buyerVat,
    L.currency,
    L.scheme,
    L.net,
    ...rates.flatMap((r) => [L.taxable(r), L.vat(r)]),
    L.zero,
    L.exempt,
    L.reverse,
    L.outside,
    L.vatTotal,
    L.total,
    L.totalEur,
    L.status,
    L.paidAt,
    L.credited,
  ]
  const rows = docs.map((inv): CsvCell[] => {
    const totals = computeTotals(inv)
    const byRate = new Map(inv.vatScheme === 'domestic' ? totals.vatBreakdown.map((b) => [b.rate, b]) : [])
    const bucket: Bucket | null = inv.vatScheme === 'domestic' ? (byRate.has(0) ? 'zero' : null) : SCHEME_BUCKET[inv.vatScheme]
    const bucketNet = (b: Bucket): number | null => {
      if (bucket !== b) return null
      return inv.vatScheme === 'domestic' ? (byRate.get(0)?.taxable ?? 0) : totals.net
    }
    return [
      inv.number,
      L.types[inv.type] ?? inv.type,
      csvDate(inv.issueDate),
      csvDate(inv.supplyDate || inv.issueDate),
      csvDate(inv.dueDate),
      inv.buyer?.name ?? '',
      inv.buyer?.registryCode ?? '',
      inv.buyer?.vatNumber ?? '',
      (inv.currency || 'EUR').toUpperCase(),
      L.schemes[inv.vatScheme] ?? inv.vatScheme,
      totals.net,
      ...rates.flatMap((r) => {
        const row = byRate.get(r)
        return row ? [row.taxable, row.vat] : [null, null]
      }),
      bucketNet('zero'),
      bucketNet('exempt'),
      bucketNet('reverse'),
      bucketNet('outside'),
      totals.vat,
      totals.gross,
      totalInEur(inv, totals.gross),
      L.statuses[inv.status] ?? inv.status,
      csvDate(inv.paidAt),
      inv.creditedInvoiceNumber ?? '',
    ]
  })
  return [header, ...rows]
}

/** The accountant CSV (UTF-8 with BOM, `;`, decimal comma). */
export function accountantCsv(docs: readonly Invoice[], lang: UiLanguage = 'et'): string {
  return toCsv(accountantRows(docs, lang))
}

/** File name stem for the period, e.g. "arved_2026-10-01_2026-10-31". */
export function exportBaseName(range: DateRange, lang: UiLanguage = 'et'): string {
  return `${lang === 'en' ? 'invoices' : 'arved'}_${range.from}_${range.to}`
}

export interface ExportProgress {
  done: number
  total: number
}

export interface AccountantZipOptions {
  range: DateRange
  lang?: UiLanguage
  signal?: AbortSignal
  onProgress?: (p: ExportProgress) => void
}

export interface AccountantZipResult {
  blob: Blob
  fileName: string
  /** Numbers of documents whose PDF or XML could not be created (the rest of the archive is complete). */
  failed: string[]
}

function abortError(): Error {
  return typeof DOMException === 'function' ? new DOMException('Export cancelled', 'AbortError') : Object.assign(new Error('Export cancelled'), { name: 'AbortError' })
}

/** Unique archive path: "a.pdf", then "a (2).pdf". */
function uniqueName(name: string, used: Set<string>): string {
  let candidate = name
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = name.replace(/(\.[^.]+)?$/, ` (${n})$1`)
  used.add(candidate.toLowerCase())
  return candidate
}

/**
 * ZIP with the CSV, one PDF per document (PDF/) and its e-invoice XML (XML/). PDFs are rendered one by one;
 * `signal` cancels between documents (the promise rejects with an AbortError).
 */
export async function accountantZip(docs: readonly Invoice[], opts: AccountantZipOptions): Promise<AccountantZipResult> {
  const lang = opts.lang ?? 'et'
  const base = exportBaseName(opts.range, lang)
  const now = new Date()
  const used = new Set<string>()
  const entries: ZipEntry[] = [{ name: uniqueName(`${base}.csv`, used), data: accountantCsv(docs, lang), date: now }]
  const failed: string[] = []
  const total = docs.length
  opts.onProgress?.({ done: 0, total })

  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw abortError()
    const inv = docs[i]
    let ok = true
    try {
      const pdf = await renderInvoicePdf(inv)
      entries.push({ name: uniqueName(`PDF/${invoiceFileName(inv, 'pdf')}`, used), data: new Uint8Array(await pdf.arrayBuffer()), date: now })
    } catch (e) {
      console.warn('PDF export failed', inv.number, e)
      ok = false
    }
    try {
      entries.push({ name: uniqueName(`XML/${invoiceFileName(inv, 'xml')}`, used), data: buildUblXml(inv), date: now })
    } catch (e) {
      console.warn('XML export failed', inv.number, e)
      ok = false
    }
    if (!ok) failed.push(inv.number)
    opts.onProgress?.({ done: i + 1, total })
  }
  if (opts.signal?.aborted) throw abortError()

  return { blob: new Blob([createZip(entries)], { type: 'application/zip' }), fileName: `${base}.zip`, failed }
}
