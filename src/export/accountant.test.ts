import { parse } from 'csv-parse/sync'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Invoice } from '../domain'
import { translate } from '../ui/i18n'
import { VAT_SCHEMES } from '../ui/options'
import { creditNoteInvoice, line, sampleInvoice } from '../pdf/testFixtures'
import { accountantCsv, accountantRows, accountantZip, exportTotals, isExportable, periodRange, selectForExport, totalInEur, vatRateColumns } from './accountant'

vi.mock('../pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pdf')>()
  return { ...actual, renderInvoicePdf: vi.fn(async () => new Blob(['%PDF-1.7 test'], { type: 'application/pdf' })) }
})
vi.mock('../einvoice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../einvoice')>()
  return { ...actual, buildUblXml: vi.fn((inv: Invoice) => `<Invoice>${inv.number}</Invoice>`) }
})

const { renderInvoicePdf } = await import('../pdf')
const { buildUblXml } = await import('../einvoice')

beforeEach(() => {
  vi.mocked(renderInvoicePdf).mockClear()
  vi.mocked(buildUblXml).mockClear()
})

describe('periodRange', () => {
  it('computes months, quarters and years', () => {
    expect(periodRange('this-month', '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(periodRange('last-month', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodRange('last-month', '2028-03-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(periodRange('last-month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(periodRange('this-quarter', '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(periodRange('last-quarter', '2026-10-15')).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(periodRange('last-quarter', '2026-02-01')).toEqual({ from: '2025-10-01', to: '2025-12-31' })
    expect(periodRange('this-year', '2026-10-15')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(periodRange('last-year', '2026-10-15')).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })
})

describe('selectForExport', () => {
  const docs = [
    sampleInvoice({ id: 'a', number: '2026-0010', issueDate: '2026-10-31' }),
    sampleInvoice({ id: 'b', number: '2026-0002', issueDate: '2026-10-01', status: 'paid', paidAt: '2026-10-05' }),
    sampleInvoice({ id: 'c', number: '2026-0011', issueDate: '2026-11-01' }),
    sampleInvoice({ id: 'd', number: '', status: 'draft', issueDate: '2026-10-10' }),
    sampleInvoice({ id: 'e', number: 'HP-2026-001', type: 'quote', issueDate: '2026-10-10' }),
    creditNoteInvoice({ id: 'f', number: '2026-0009', issueDate: '2026-10-20' }),
    sampleInvoice({ id: 'g', number: '2026-0003', issueDate: '2026-10-01', type: 'prepayment', status: 'cancelled' }),
  ]
  const range = periodRange('this-month', '2026-10-15')

  it('takes issued documents in the range, without drafts and quotes, ordered by date and number', () => {
    expect(selectForExport(docs, { ...range, invoices: true, creditNotes: true }).map((d) => d.id)).toEqual(['b', 'g', 'f', 'a'])
  })

  it('filters by document kind', () => {
    expect(selectForExport(docs, { ...range, invoices: false, creditNotes: true }).map((d) => d.id)).toEqual(['f'])
    expect(selectForExport(docs, { ...range, invoices: true, creditNotes: false }).map((d) => d.id)).toEqual(['b', 'g', 'a'])
  })

  it('never exports drafts or quotes', () => {
    expect(isExportable({ status: 'draft', type: 'invoice', number: '' })).toBe(false)
    expect(isExportable({ status: 'issued', type: 'quote', number: 'HP-1' })).toBe(false)
    expect(isExportable({ status: 'cancelled', type: 'credit-note', number: 'K-1' })).toBe(true)
  })
})

function csvRecords(text: string): Record<string, string>[] {
  return parse(text, { bom: true, delimiter: ';', columns: true }) as Record<string, string>[]
}

describe('accountantCsv', () => {
  it('writes one row per document with per-rate VAT and decimal commas', () => {
    const inv = sampleInvoice()
    const [row] = csvRecords(accountantCsv([inv]))
    // 12.5 h × 65 = 812.50 @ 24 %; 2 × 80.50 − 10 % = 144.90 @ 13 %; 1234.567 → 1234.57 @ 9 %
    expect(row).toMatchObject({
      Number: '2026-0007',
      Viitenumber: '20260007',
      Liik: 'Arve',
      'Arve kuupäev': '12.10.2026',
      'Käibe tekkimise kuupäev': '10.10.2026',
      Maksetähtaeg: '26.10.2026',
      Ostja: 'Klient Žürii OÜ',
      'Ostja registrikood': '87654321',
      'Ostja KMKR nr': 'EE987654321',
      Valuuta: 'EUR',
      Käibemaksurežiim: 'Tavaline käibemaks (Eesti)',
      'Summa km-ta': '2191,97',
      'Käive 24%': '812,50',
      'Käibemaks 24%': '195,00',
      'Käive 13%': '144,90',
      'Käibemaks 13%': '18,84',
      'Käive 9%': '1234,57',
      'Käibemaks 9%': '111,11',
      'Käive 0%': '',
      'Maksuvaba käive': '',
      'Pöördmaksustatav käive': '',
      'Käibemaks kokku': '324,95',
      'Summa kokku': '2516,92',
      'Summa kokku EUR': '2516,92',
      Olek: 'Väljastatud',
      'Laekumise kuupäev': '',
      'Krediteeritava arve nr': '',
    })
  })

  it('puts zero-rated, exempt and reverse-charge sales in their own columns', () => {
    const lines = [line({ id: 'x', quantity: 2, unitPrice: 50, vatRate: 0 })]
    const docs = [
      sampleInvoice({ number: 'A1', lines }),
      sampleInvoice({ number: 'A2', vatScheme: 'eu-goods', lines }),
      sampleInvoice({ number: 'A3', vatScheme: 'exempt', lines }),
      sampleInvoice({ number: 'A4', vatScheme: 'eu-reverse-charge', lines }),
      sampleInvoice({ number: 'A5', vatScheme: 'non-eu-services', lines }),
    ]
    const rows = csvRecords(accountantCsv(docs))
    const pick = (r: Record<string, string>) => [r['Käive 0%'], r['Maksuvaba käive'], r['Pöördmaksustatav käive'], r['Muu käive km-ta'], r['Käibemaks kokku']]
    expect(rows.map(pick)).toEqual([
      ['100,00', '', '', '', '0,00'],
      ['100,00', '', '', '', '0,00'],
      ['', '100,00', '', '', '0,00'],
      ['', '', '100,00', '', '0,00'],
      ['', '', '', '100,00', '0,00'],
    ])
  })

  it('names the VAT treatment exactly as the app does', () => {
    const docs = VAT_SCHEMES.map((vatScheme, i) => sampleInvoice({ id: `s${i}`, number: `S${i}`, vatScheme }))
    for (const lang of ['et', 'en'] as const) {
      const header = lang === 'et' ? 'Käibemaksurežiim' : 'VAT treatment'
      const names = csvRecords(accountantCsv(docs, lang)).map((r) => r[header])
      expect(names).toEqual(VAT_SCHEMES.map((s) => translate(lang, `vat.scheme.${s}`)))
    }
  })

  it('shows credit notes as negative amounts with the credited invoice number', () => {
    const cn = creditNoteInvoice({ number: '2026-0009', status: 'issued' })
    const [row] = csvRecords(accountantCsv([cn]))
    expect(row.Liik).toBe('Kreeditarve')
    expect(row['Krediteeritava arve nr']).toBe(cn.creditedInvoiceNumber)
    expect(row['Summa kokku'].startsWith('-')).toBe(true)
  })

  it('zeroes an invoice cancelled without a credit note and keeps one cancelled with a credit note', () => {
    const voided = sampleInvoice({ id: 'v', number: '2026-0005', status: 'cancelled' })
    const credited = sampleInvoice({ id: 'c', number: '2026-0007', status: 'cancelled' })
    const cn = creditNoteInvoice({ id: 'n', number: '2026-0008', status: 'issued', lines: credited.lines.map((l) => ({ ...l, quantity: -l.quantity })) })
    // The credit note may fall outside the period: every document is passed to find it.
    const all = [voided, credited, cn]
    const [v, c] = csvRecords(accountantCsv([voided, credited], 'et', all))
    expect(v).toMatchObject({ Olek: 'Tühistatud', 'Summa km-ta': '0,00', 'Käive 24%': '', 'Käibemaks kokku': '0,00', 'Summa kokku': '0,00', 'Summa kokku EUR': '0,00' })
    expect(c).toMatchObject({ Olek: 'Tühistatud', 'Summa kokku': '2516,92' })
    expect(exportTotals([voided, credited], all)).toEqual(new Map([['EUR', 2516.92]]))
    expect(exportTotals([voided, credited, cn], all)).toEqual(new Map([['EUR', 0]]))
    expect(exportTotals([voided], all)).toEqual(new Map([['EUR', 0]]))
  })

  it('converts foreign-currency totals to EUR when the rate is known', () => {
    const usd = sampleInvoice({ currency: 'USD', eurExchangeRate: 1.25, lines: [line({ id: 'u', unitPrice: 100, vatRate: 24 })] })
    const [row] = csvRecords(accountantCsv([usd, { ...usd, number: 'X', eurExchangeRate: undefined }]))
    expect(row['Summa kokku']).toBe('124,00')
    expect(row['Summa kokku EUR']).toBe('99,20')
    expect(totalInEur({ currency: 'USD' }, 10)).toBeNull()
  })

  it('adds columns for other rates in use (e.g. 22 % on an older supply)', () => {
    const old = sampleInvoice({ lines: [line({ id: 'o', unitPrice: 100, vatRate: 22 })] })
    expect(vatRateColumns([old])).toEqual([24, 22, 13, 9])
    const [row] = csvRecords(accountantCsv([old]))
    expect(row['Käibemaks 22%']).toBe('22,00')
  })

  it('has English headers and neutralises formulas in buyer names', () => {
    const inv = sampleInvoice({ buyer: { ...sampleInvoice().buyer, name: '=cmd|calc' } })
    const rows = accountantRows([inv], 'en')
    expect(rows[0].slice(0, 4)).toEqual(['Number', 'Reference number', 'Type', 'Issue date'])
    expect(accountantCsv([inv], 'en')).toContain(";'=cmd|calc;")
  })
})

describe('accountantZip', () => {
  const range = { from: '2026-10-01', to: '2026-10-31' }
  const docs = [sampleInvoice({ id: 'a', number: '2026-0001' }), creditNoteInvoice({ id: 'b', number: '2026-0002' })]

  async function names(blob: Blob): Promise<string[]> {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const v = new DataView(bytes.buffer)
    const eocd = bytes.length - 22
    let p = v.getUint32(eocd + 16, true)
    const out: string[] = []
    for (let i = 0; i < v.getUint16(eocd + 10, true); i++) {
      const len = v.getUint16(p + 28, true)
      out.push(new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + len)))
      p += 46 + len + v.getUint16(p + 30, true) + v.getUint16(p + 32, true)
    }
    return out
  }

  it('bundles the CSV, a PDF and an XML per document and reports progress', async () => {
    const progress: number[] = []
    const res = await accountantZip(docs, { range, onProgress: (p) => progress.push(p.done) })
    expect(res.fileName).toBe('arved_2026-10-01_2026-10-31.zip')
    expect(res.blob.type).toBe('application/zip')
    expect(res.failed).toEqual([])
    const list = await names(res.blob)
    expect(list[0]).toBe('arved_2026-10-01_2026-10-31.csv')
    expect(list.filter((n) => n.startsWith('PDF/') && n.endsWith('.pdf'))).toHaveLength(2)
    expect(list.filter((n) => n.startsWith('XML/') && n.endsWith('.xml'))).toHaveLength(2)
    expect(progress).toEqual([0, 1, 2])
    expect(renderInvoicePdf).toHaveBeenCalledTimes(2)
  })

  it('keeps going when one document fails and lists it', async () => {
    vi.mocked(renderInvoicePdf).mockRejectedValueOnce(new Error('font'))
    const res = await accountantZip(docs, { range })
    expect(res.failed).toEqual(['2026-0001'])
    expect((await names(res.blob)).filter((n) => n.startsWith('PDF/'))).toHaveLength(1)
  })

  it('stops when cancelled', async () => {
    const ctrl = new AbortController()
    const run = accountantZip(docs, {
      range,
      signal: ctrl.signal,
      onProgress: (p) => {
        if (p.done === 1) ctrl.abort()
      },
    })
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(renderInvoicePdf).toHaveBeenCalledTimes(1)
  })

  it('gives same-named files distinct paths', async () => {
    const twins = [sampleInvoice({ id: 'x', number: '7' }), sampleInvoice({ id: 'y', number: '7' })]
    const list = await names((await accountantZip(twins, { range })).blob)
    expect(new Set(list).size).toBe(list.length)
    expect(list).toContain('PDF/Arve_7_Klient-Zurii-OU (2).pdf')
  })
})
