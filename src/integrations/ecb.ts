// Euro foreign exchange reference rates from the ECB Data Portal (no key, CORS enabled).

export const ECB_API_ORIGIN = 'https://data-api.ecb.europa.eu'

export interface EcbRate {
  currency: string
  /** Units of `currency` per 1 EUR, as published. */
  rate: number
  /** Day the rate was published for (the requested date or the last business day before it). */
  date: string
}

export type EcbErrorCode = 'unsupported-currency' | 'not-found' | 'network' | 'timeout' | 'bad-response'

export class EcbRateError extends Error {
  readonly code: EcbErrorCode
  constructor(code: EcbErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'EcbRateError'
    this.code = code
  }
}

/** Calendar days searched backwards for a published rate (weekends and TARGET holidays have none). */
export const ECB_LOOKBACK_DAYS = 10
const TIMEOUT_MS = 10_000

const cache = new Map<string, Promise<EcbRate>>()

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function ecbRateUrl(currency: string, date: string): string {
  const params = new URLSearchParams({ startPeriod: shiftDate(date, -ECB_LOOKBACK_DAYS), endPeriod: date, format: 'csvdata' })
  return `${ECB_API_ORIGIN}/service/data/EXR/D.${currency}.EUR.SP00.A?${params}`
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** Observations `{ date, rate }` from an SDMX `csvdata` response, in file order. */
export function parseEcbCsv(text: string): { date: string; rate: number }[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  const header = splitCsvLine(lines[0]).map((h) => h.trim())
  const iDate = header.indexOf('TIME_PERIOD')
  const iValue = header.indexOf('OBS_VALUE')
  if (iDate < 0 || iValue < 0) throw new EcbRateError('bad-response', 'missing columns')
  const rows: { date: string; rate: number }[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const date = cells[iDate]?.trim() ?? ''
    const rate = Number(cells[iValue])
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(rate) && rate > 0) rows.push({ date, rate })
  }
  return rows
}

async function load(currency: string, date: string, fetchImpl: typeof fetch): Promise<EcbRate> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = setTimeout(() => ctrl?.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetchImpl(ecbRateUrl(currency, date), { signal: ctrl?.signal })
  } catch (e) {
    throw new EcbRateError(ctrl?.signal.aborted ? 'timeout' : 'network', e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
  // 404 = no data for the key/period (unknown currency or no publication in the window).
  if (res.status === 404) throw new EcbRateError('not-found')
  if (!res.ok) throw new EcbRateError('network', `HTTP ${res.status}`)
  const text = await res.text()
  if (!text.trim()) throw new EcbRateError('not-found')
  const best = parseEcbCsv(text)
    .filter((r) => r.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop()
  if (!best) throw new EcbRateError('not-found')
  return { currency, rate: best.rate, date: best.date }
}

/**
 * ECB reference rate for `currency` (ISO 4217) on `date` (YYYY-MM-DD), or the last one published within
 * the ten days before it. EUR is 1. Results are cached in memory per currency and date; failures are not.
 */
export function fetchEcbRate(currency: string, date: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<EcbRate> {
  const cur = currency.trim().toUpperCase()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) return Promise.reject(new EcbRateError('bad-response', 'invalid date'))
  if (!/^[A-Z]{3}$/.test(cur)) return Promise.reject(new EcbRateError('unsupported-currency'))
  if (cur === 'EUR') return Promise.resolve({ currency: cur, rate: 1, date })
  const key = `${cur}:${date}`
  const hit = cache.get(key)
  if (hit) return hit
  const p = load(cur, date, fetchImpl)
  cache.set(key, p)
  p.catch(() => cache.delete(key))
  return p
}

/** For tests. */
export function clearEcbCache(): void {
  cache.clear()
}
