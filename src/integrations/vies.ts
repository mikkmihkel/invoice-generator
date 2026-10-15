// EU VAT number check through the European Commission's VIES REST API.

import { EU_VAT_PREFIXES, normalizeVatNumber } from '../domain/law'

export const VIES_API_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number'
/** The official VIES web form, for checking by hand when the browser cannot call the API. */
export const VIES_WEB_URL = 'https://ec.europa.eu/taxation_customs/vies/#/vat-validation'

export type ViesResult =
  | { status: 'valid'; countryCode: string; vatNumber: string; name?: string; address?: string; requestDate?: string }
  | { status: 'invalid'; countryCode: string; vatNumber: string }
  /** The member state's service or VIES itself did not answer (try again later). */
  | { status: 'unavailable'; countryCode: string; vatNumber: string; reason?: string }
  /** The browser could not reach VIES at all (network, CORS or timeout): check on the official page instead. */
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

/** Trader name or address as returned, or undefined when the member state does not disclose it ("---"). */
function disclosed(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().replace(/\s*\n\s*/g, ', ')
  return s && !/^-+$/.test(s) ? s.slice(0, 300) : undefined
}

/**
 * Interpret a VIES REST response body (both the check-vat-number and the per-state GET formats). Error codes
 * such as MS_UNAVAILABLE, TIMEOUT or MS_MAX_CONCURRENT_REQ mean the answer is unknown, not that the number is invalid.
 */
export function parseViesResponse(body: unknown, countryCode: string, vatNumber: string): ViesResult {
  const base = { countryCode, vatNumber }
  if (!body || typeof body !== 'object') return { status: 'unavailable', ...base, reason: 'empty response' }
  const b = body as Record<string, unknown>
  const wrappers = Array.isArray(b.errorWrappers) ? (b.errorWrappers as { error?: unknown }[]) : []
  const error = String(wrappers[0]?.error ?? (b.userError && b.userError !== 'VALID' && b.userError !== 'INVALID' ? b.userError : '') ?? '')
  if (error === 'INVALID_INPUT') return { status: 'invalid', ...base }
  if (error) return { status: 'unavailable', ...base, reason: error }
  const valid = typeof b.valid === 'boolean' ? b.valid : typeof b.isValid === 'boolean' ? b.isValid : null
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

/**
 * Ask VIES whether `number` is a valid VAT number of `countryCode` (VIES code, e.g. 'EE', 'EL'). Never throws:
 * a browser that cannot reach the API (no CORS permission, offline, timeout) gets status 'blocked'.
 */
export async function checkVatNumber(countryCode: string, number: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<ViesResult> {
  const cc = countryCode.trim().toUpperCase() === 'GR' ? 'EL' : countryCode.trim().toUpperCase()
  const vatNumber = normalizeVatNumber(number).replace(new RegExp(`^${cc}`), '')
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = setTimeout(() => ctrl?.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetchImpl(VIES_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ countryCode: cc, vatNumber }),
      signal: ctrl?.signal,
    })
  } catch (e) {
    return { status: 'blocked', countryCode: cc, vatNumber, reason: ctrl?.signal.aborted ? 'timeout' : e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* not JSON */
  }
  if (!res.ok && !(body && typeof body === 'object' && 'errorWrappers' in body)) return { status: 'unavailable', countryCode: cc, vatNumber, reason: `HTTP ${res.status}` }
  return parseViesResponse(body, cc, vatNumber)
}
