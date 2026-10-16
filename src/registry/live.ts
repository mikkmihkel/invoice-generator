// Optional live layer: the public autocomplete endpoint used by the ariregister.rik.ee web UI.
// Undocumented; it may change, rate-limit or block cross-origin requests. Every failure → [].
import type { RegistryCompany } from '../domain/types'
import { STATUS_TEXT, addressFromAds, legalFormFromName } from './address'

export const LIVE_ENDPOINT = 'https://ariregister.rik.ee/est/api/autocomplete'
export const LIVE_TIMEOUT_MS = 3000

/** Shape of one `data[]` item (recorded 2026-09). */
interface LiveItem {
  reg_code?: number | string
  name?: string
  status?: string
  legal_address?: string
  zip_code?: string
  legal_form?: string | number
}

/** Numeric legal-form codes seen in responses; anything else is guessed from the name. */
const LIVE_LEGAL_FORMS: Record<string, string> = { '1': 'AS', '5': 'OÜ' }

export interface LiveResult {
  company: RegistryCompany
  /** Raw status code (R, L, N, K). */
  status: string
}

export function mapLiveItem(item: LiveItem): LiveResult | null {
  const code = String(item.reg_code ?? '').trim()
  const name = String(item.name ?? '').trim()
  if (!/^\d{8}$/.test(code) || !name) return null
  const status = String(item.status ?? '').trim().toUpperCase()
  const company: RegistryCompany = { registryCode: code, name }
  const legalForm = legalFormFromName(name) ?? LIVE_LEGAL_FORMS[String(item.legal_form ?? '')]
  if (legalForm) company.legalForm = legalForm
  if (status) company.status = STATUS_TEXT[status] ?? status
  const full = String(item.legal_address ?? '').trim()
  const zip = String(item.zip_code ?? '').trim()
  if (full) {
    const { address, addressText } = addressFromAds(full, zip)
    company.address = address
    company.addressText = addressText
  }
  return { company, status: status || 'R' }
}

/**
 * Query the live autocomplete. Never throws; deleted (K) companies are dropped.
 * `onFail` is called when the API did not answer usably (network, CORS, HTTP error, timeout, odd body),
 * but not when the caller's own `signal` aborted.
 */
export async function liveSearch(
  query: string,
  opts: { limit?: number; signal?: AbortSignal; timeoutMs?: number; onFail?: () => void } = {},
): Promise<LiveResult[]> {
  const q = query.trim()
  if (q.length < 2 || opts.signal?.aborted) return []
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? LIVE_TIMEOUT_MS)
  const onAbort = () => ctrl.abort()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  const fail = () => {
    if (!opts.signal?.aborted) opts.onFail?.()
    return []
  }
  try {
    const params = new URLSearchParams({ q, results: String(Math.min(Math.max(opts.limit ?? 10, 1), 50)) })
    // A "simple" GET (no custom headers) so the browser does not need a CORS preflight.
    const res = await fetch(`${LIVE_ENDPOINT}?${params}`, { signal: ctrl.signal, credentials: 'omit' })
    if (!res.ok) return fail()
    const json = (await res.json()) as { data?: unknown }
    if (!Array.isArray(json?.data)) return fail()
    return json.data
      .map((item) => (item && typeof item === 'object' ? mapLiveItem(item as LiveItem) : null))
      .filter((r): r is LiveResult => r !== null && r.status !== 'K')
  } catch {
    return fail()
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
