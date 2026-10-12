// Estonian-style formatting for the UI (amounts "1234,50 €", dates "12.10.2026").

const moneyFormatters = new Map<string, Intl.NumberFormat>()

export function formatMoney(value: number, currency = 'EUR'): string {
  if (!Number.isFinite(value)) return '—'
  let f = moneyFormatters.get(currency)
  if (!f) {
    try {
      f = new Intl.NumberFormat('et-EE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
    } catch {
      f = new Intl.NumberFormat('et-EE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    moneyFormatters.set(currency, f)
  }
  return f.format(value)
}

const numberFormatter = new Intl.NumberFormat('et-EE', { maximumFractionDigits: 4 })

/** Plain decimal number with comma separator, e.g. 1,5. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  return numberFormatter.format(value).replace(/−/g, '-').replace(/\s/g, '')
}

/** Parse user input accepting both "1,5" and "1.5", spaces as thousand separators. Returns null if not a number. */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(/[\s  ]/g, '').replace(/−/g, '-').replace(',', '.')
  if (s === '' || s === '-' || s === '.') return null
  if (!/^-?\d*\.?\d*$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** "2026-10-12" → "12.10.2026". */
export function formatDate(iso: string | undefined | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${m[3]}.${m[2]}.${m[1]}`
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Group an IBAN in blocks of four for display. */
export function formatIban(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}
