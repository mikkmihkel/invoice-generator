import type { Invoice, InvoiceLine, InvoiceTotals, LineTotals, VatBreakdownRow } from './types'

/**
 * Convert an amount to integer cents, rounding half away from zero (commercial rounding, symmetric for
 * credit notes). Goes through a fixed decimal string so binary noise like 1.005 → 1.00499… still rounds up.
 */
export function toCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  const abs = Math.abs(value)
  const cents = Math.round(Number(`${abs.toFixed(10)}e2`))
  return value < 0 ? -cents : cents
}

export function fromCents(cents: number): number {
  return cents / 100
}

/** Round to 2 decimals using half-up (commercial) rounding on cents. Negative values round away from zero. */
export function roundMoney(value: number): number {
  return fromCents(toCents(value))
}

function num(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Net amount of a line in cents: round(qty × unitPrice × (1 − discount%)). */
export function lineNetCents(line: Pick<InvoiceLine, 'quantity' | 'unitPrice' | 'discountPercent'>): number {
  const discount = Math.min(100, Math.max(0, num(line.discountPercent)))
  return toCents((num(line.quantity) * num(line.unitPrice) * (100 - discount)) / 100)
}

/** Round a (possibly fractional) cent amount half away from zero. */
function roundCents(value: number): number {
  return toCents(value / 100)
}

/**
 * Split `target` cents over lines proportionally to `raw` (unrounded per-line VAT in cents) so that the
 * parts sum exactly to `target` (largest remainder).
 */
function allocate(raw: number[], target: number): number[] {
  const parts = raw.map(roundCents)
  let diff = target - parts.reduce((a, b) => a + b, 0)
  if (diff === 0 || parts.length === 0) return parts
  const step = Math.sign(diff)
  const order = raw
    .map((r, i) => ({ i, residual: (r - parts[i]) * step }))
    .sort((a, b) => b.residual - a.residual || Math.abs(raw[b.i]) - Math.abs(raw[a.i]))
  for (let k = 0; diff !== 0; k = (k + 1) % order.length) {
    parts[order[k].i] += step
    diff -= step
  }
  return parts
}

/**
 * Compute line, VAT-breakdown and grand totals. VAT is calculated per rate on the rate's taxable sum
 * (Estonian practice) and allocated back to the lines so line VATs sum to the totals.
 * Only vatScheme 'domestic' charges VAT; other VAT-registered schemes show a single 0% row;
 * 'not-registered' hides VAT altogether.
 */
export function computeTotals(invoice: Pick<Invoice, 'lines' | 'vatScheme'>): InvoiceTotals {
  const lines = invoice.lines ?? []
  const nets = lines.map(lineNetCents)
  const vats = lines.map(() => 0)
  const breakdown: VatBreakdownRow[] = []
  const showVat = invoice.vatScheme !== 'not-registered'

  if (invoice.vatScheme === 'domestic') {
    const groups = new Map<number, number[]>()
    lines.forEach((line, i) => {
      const rate = num(line.vatRate)
      const idx = groups.get(rate)
      if (idx) idx.push(i)
      else groups.set(rate, [i])
    })
    const rates = [...groups.keys()].sort((a, b) => b - a)
    for (const rate of rates) {
      const idx = groups.get(rate)!
      const taxable = idx.reduce((acc, i) => acc + nets[i], 0)
      const vat = roundCents((taxable * rate) / 100)
      const parts = allocate(idx.map((i) => (nets[i] * rate) / 100), vat)
      idx.forEach((i, k) => {
        vats[i] = parts[k]
      })
      breakdown.push({ rate, taxable: fromCents(taxable), vat: fromCents(vat) })
    }
  } else if (showVat && lines.length > 0) {
    breakdown.push({ rate: 0, taxable: fromCents(nets.reduce((a, b) => a + b, 0)), vat: 0 })
  }

  const lineTotals: LineTotals[] = lines.map((line, i) => ({
    lineId: line.id,
    net: fromCents(nets[i]),
    vat: fromCents(vats[i]),
    gross: fromCents(nets[i] + vats[i]),
  }))
  const netCents = nets.reduce((a, b) => a + b, 0)
  const vatCents = vats.reduce((a, b) => a + b, 0)
  return {
    lines: lineTotals,
    vatBreakdown: breakdown,
    net: fromCents(netCents),
    vat: fromCents(vatCents),
    gross: fromCents(netCents + vatCents),
    showVat,
  }
}

/** Format a money amount for display, e.g. 1234.5 → "1 234,50" (et) / "1,234.50" (en). */
export function formatMoney(value: number, language: 'et' | 'en' = 'et', currency?: string): string {
  const text = new Intl.NumberFormat(language === 'et' ? 'et-EE' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(value))
  return currency ? `${text} ${currency}` : text
}
