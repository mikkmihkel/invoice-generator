// EU VAT number check through the European Commission's VIES REST API.
//
// The per-state GET endpoint is used because it is a CORS "simple request" (no preflight); the POST
// check-vat-number endpoint needs a JSON preflight. VIES does not appear to send Access-Control-Allow-Origin
// to other websites, so in a browser the request usually fails with a network error: that is reported as
// 'blocked' and the UI falls back to the official VIES page.

import { EU_VAT_PREFIXES, normalizeVatNumber } from '../domain/law'

export const VIES_API_BASE = 'https://ec.europa.eu/taxation_customs/vies/rest-api'
/** The official VIES web form, for checking by hand when the browser cannot call the API. */
export const VIES_WEB_URL = 'https://ec.europa.eu/taxation_customs/vies/#/vat-validation'

export type ViesResult =
  | { status: 'valid'; countryCode: string; vatNumber: string; name?: string; address?: string; requestDate?: string }
  | { status: 'invalid'; countryCode: string; vatNumber: string }
  /** The member state's service or VIES itself did not answer (try again later). */
  | { status: 'unavailable'; countryCode: string; vatNumber: string; reason?: string }
  /** The browser has no connection. */
  | { status: 'offline'; countryCode: string; vatNumber: string }
  /** VIES could not be read from the browser (CORS, blocked, timeout): check on the official page instead. */
  | { status: 'blocked'; countryCode: string; vatNumber: string; reason?: string }

const TIMEOUT_MS = 12_000

/** "EE 101 234 567" → { countryCode: 'EE', number: '101234567' }; Greece uses EL in VIES. Null for non-EU numbers. */
export function splitVatNumber(vat: string): { countryCode: string; number: string } | null {
  const n = normalizeVatNumber(vat)
  let cc = n.slice(0, 2)
  if (cc === 'GR') cc = 'EL'
  const number = n.slice(2)
  if (!EU_VAT_PREFIXES.includes(cc) || !/^[0-9A-Z+*]{2,14}$/.test(number)) return null
  return { countryCode: cc, number }
}

/** GET /ms/{countryCode}/vat/{vatNumber} */
export function viesCheckUrl(countryCode: string, vatNumber: string): string {
  return `${VIES_API_BASE}/ms/${encodeURIComponent(countryCode)}/vat/${encodeURIComponent(vatNumber)}`
}

/**
 * The VIES web form with the country, number and language in the address. The form may ignore these
 * parameters, so the caller also copies the number to the clipboard.
 */
export function viesWebUrl(countryCode: string, vatNumber: string, locale?: string): string {
  const params = new URLSearchParams({ memberStateCode: countryCode, number: vatNumber })
  if (locale) params.set('locale', locale)
  return `${VIES_WEB_URL}?${params}`
}

/** Trader name or address as returned, or undefined when the member state does not disclose it ("---"). */
function disclosed(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().replace(/\s*\n\s*/g, ', ')
  return s && !/^-+$/.test(s) ? s.slice(0, 300) : undefined
}

/**
 * Interpret a VIES REST response body (both the per-state GET and the check-vat-number formats). Error codes
 * such as MS_UNAVAILABLE, TIMEOUT or MS_MAX_CONCURRENT_REQ mean the answer is unknown, not that the number is invalid.
 */
export function parseViesResponse(body: unknown, countryCode: string, vatNumber: string): ViesResult {
  const base = { countryCode, vatNumber }
  if (!body || typeof body !== 'object') return { status: 'unavailable', ...base, reason: 'empty response' }
  const b = body as Record<string, unknown>
  const wrappers = Array.isArray(b.errorWrappers) ? (b.errorWrappers as { error?: unknown }[]) : []
  const userError = typeof b.userError === 'string' && b.userError !== 'VALID' && b.userError !== 'INVALID' ? b.userError : ''
  const error = String(wrappers[0]?.error ?? userError)
  if (error === 'INVALID_INPUT') return { status: 'invalid', ...base }
  if (error) return { status: 'unavailable', ...base, reason: error }
  const valid = typeof b.isValid === 'boolean' ? b.isValid : typeof b.valid === 'boolean' ? b.valid : null
  if (valid === null) return { status: 'unavailable', ...base, reason: 'unexpected response' }
  if (!valid) return { status: 'invalid', ...base }
  return {
    status: 'valid',
    ...base,
    name: disclosed(b.name ?? b.traderName),
    address: disclosed(b.address ?? b.traderAddress),
    requestDate: typeof b.requestDate === 'string' ? b.requestDate : undefined,
  }
}

// Set after the first request that the browser could not read, so later checks in this session go straight
// to the official page instead of waiting for another failure.
let blockedInSession = false

export function viesBlockedInSession(): boolean {
  return blockedInSession
}

/** For tests. */
export function resetViesSession(): void {
  blockedInSession = false
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/**
 * Ask VIES whether `number` is a valid VAT number of `countryCode` (VIES code, e.g. 'EE', 'EL'). Never throws.
 * The request is a plain GET without credentials or non-safelisted headers, so the browser sends no preflight.
 */
export async function checkVatNumber(countryCode: string, number: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<ViesResult> {
  const cc = countryCode.trim().toUpperCase() === 'GR' ? 'EL' : countryCode.trim().toUpperCase()
  const vatNumber = normalizeVatNumber(number).replace(new RegExp(`^(${cc}|${cc === 'EL' ? 'GR' : cc})`), '')
  if (isOffline()) return { status: 'offline', countryCode: cc, vatNumber }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = setTimeout(() => ctrl?.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetchImpl(viesCheckUrl(cc, vatNumber), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: ctrl?.signal,
    })
  } catch (e) {
    if (isOffline()) return { status: 'offline', countryCode: cc, vatNumber }
    const timedOut = ctrl?.signal.aborted === true
    // A TypeError without a response is what a missing CORS header looks like; it cannot be told apart from a
    // blocked network, and either way the official page is the way forward.
    if (!timedOut) blockedInSession = true
    return { status: 'blocked', countryCode: cc, vatNumber, reason: timedOut ? 'timeout' : e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* not JSON */
  }
  const hasError = !!body && typeof body === 'object' && ('errorWrappers' in body || 'userError' in body)
  if (!res.ok && !hasError) return { status: 'unavailable', countryCode: cc, vatNumber, reason: `HTTP ${res.status}` }
  return parseViesResponse(body, cc, vatNumber)
}
