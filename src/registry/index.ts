// Estonian e-Business Register (Äriregister) lookup.
// Data: static index built from RIK open data (see docs/registry.md) + optional live autocomplete.
// No function here throws: failures (missing index, network, CORS, abort) give [] / null.
import type { RegistryCompany } from '../domain/types'
import { STATUS_TEXT } from './address'
import { liveSearch } from './live'
import { queryTokens, splitTokens, nameTokens } from './normalize'
import { findByCodePrefix, findByTokens, getRecord, loadMeta, resetIndexCache, type Candidate } from './staticIndex'

export interface RegistrySearchOptions {
  /** Max results, default 10. */
  limit?: number
  /** Also query the live RIK autocomplete API (may fail due to CORS — must degrade silently). */
  live?: boolean
  signal?: AbortSignal
  /**
   * Called when a source could not be searched: 'index' = the bundled index is missing or failed to load,
   * 'live' = the live API did not answer. Lets the UI tell "nothing found" apart from "could not search".
   */
  onUnavailable?: (source: 'index' | 'live') => void
}

export interface RegistryIndexInfo {
  builtAt: string
  count: number
  source: string
  /** Last-Modified of the downloaded RIK file, if known. */
  dataDate?: string
  sourceUrl?: string
  licence?: string
  licenceUrl?: string
  /** Attribution text the UI must show next to register data. */
  attribution?: string
}

/** Attribution for data from the e-Business Register (bundled index and live lookup alike). CC BY 4.0 requires it. */
export const REGISTRY_ATTRIBUTION = {
  et: 'Andmed: e-äriregister, Registrite ja Infosüsteemide Keskus (RIK), avaandmed litsentsiga CC BY 4.0',
  en: 'Data: Estonian e-Business Register, Centre of Registers and Information Systems (RIK), open data under CC BY 4.0',
  sourceUrl: 'https://avaandmed.ariregister.rik.ee/',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
} as const

export { resetIndexCache as resetRegistryCache }

const DEFAULT_LIMIT = 10
const STATUS_RANK: Record<string, number> = { R: 0, L: 1, N: 2 }

interface MergedCandidate extends Candidate {
  live?: RegistryCompany
}

function rankCandidates(tokens: string[], codePrefix: string | null) {
  const qn = tokens.join(' ')
  const score = (c: Candidate) => {
    const nt = nameTokens(c.name)
    const nn = nt.join(' ')
    if (nn === qn) return 0
    if (nn.startsWith(qn) || (codePrefix && c.code.startsWith(codePrefix))) return 1
    if (tokens.length && nt[0]?.startsWith(tokens[0])) return 2
    return 3
  }
  const scores = new Map<Candidate, number>()
  const s = (c: Candidate) => {
    let v = scores.get(c)
    if (v === undefined) scores.set(c, (v = score(c)))
    return v
  }
  return (a: Candidate, b: Candidate) =>
    s(a) - s(b) ||
    (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) ||
    a.name.length - b.name.length ||
    a.name.localeCompare(b.name, 'et')
}

/** Index record enriched with fresher name/status from the live API. */
function mergeLive(rec: RegistryCompany, live: RegistryCompany): RegistryCompany {
  return { ...rec, name: live.name || rec.name, status: live.status ?? rec.status }
}

async function search(query: string, opts: RegistrySearchOptions): Promise<RegistryCompany[]> {
  const { signal } = opts
  const limit = Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT))
  const q = query.trim()
  if (!q) return []
  const compact = q.replace(/\s+/g, '')
  if (/^\d{8}$/.test(compact)) {
    const c = await getCompanyByCode(compact, opts)
    return c ? [c] : []
  }
  const tokens = queryTokens(q)
  if (!tokens.length) return []
  const codePrefix = /^\d{5,7}$/.test(compact) ? compact : null
  const nameMatches = (name: string) => {
    const words = splitTokens(name)
    return tokens.every((t) => words.some((w) => w.startsWith(t)))
  }

  const [byName, byCode, live] = await Promise.all([
    findByTokens(tokens, nameMatches, signal),
    codePrefix ? findByCodePrefix(codePrefix, signal) : Promise.resolve([]),
    opts.live ? liveSearch(q, { limit, signal, onFail: () => opts.onUnavailable?.('live') }) : Promise.resolve([]),
  ])
  if (byName === null && !signal?.aborted) opts.onUnavailable?.('index')

  const merged = new Map<string, MergedCandidate>()
  for (const c of [...(byName ?? []), ...(byCode ?? [])]) if (!merged.has(c.code)) merged.set(c.code, { ...c })
  for (const l of live) {
    const existing = merged.get(l.company.registryCode)
    if (existing) {
      existing.live = l.company
      existing.status = l.status
    } else {
      merged.set(l.company.registryCode, { code: l.company.registryCode, name: l.company.name, status: l.status, live: l.company })
    }
  }
  const top = [...merged.values()].sort(rankCandidates(tokens, codePrefix)).slice(0, limit)
  const indexAvailable = byName !== null

  const results = await Promise.all(
    top.map(async (c): Promise<RegistryCompany> => {
      const rec = indexAvailable ? await getRecord(c.code, signal) : null
      if (rec) return c.live ? mergeLive(rec, c.live) : rec
      if (c.live) return c.live
      const fallback: RegistryCompany = { registryCode: c.code, name: c.name }
      if (STATUS_TEXT[c.status]) fallback.status = STATUS_TEXT[c.status]
      return fallback
    }),
  )
  return signal?.aborted ? [] : results
}

/**
 * Search by name fragment or registry code. Uses the bundled static index (public/registry/*) built from RIK open data.
 * - 8 digits → exact registry code lookup.
 * - Otherwise every word must match the start of a word in the name (diacritics and legal-form words ignored);
 *   5–7 digits additionally match registry-code prefixes.
 * - Ranking: exact name, name starts with query, first word matches, then active before liquidation/bankruptcy.
 * Resolves to [] on any failure or when `signal` aborts.
 */
export async function searchCompanies(query: string, opts: RegistrySearchOptions = {}): Promise<RegistryCompany[]> {
  try {
    return await search(query, opts)
  } catch {
    return []
  }
}

/** Exact lookup by 8-digit registry code. Falls back to the live API (when `opts.live`) if the index lacks it. */
export async function getCompanyByCode(registryCode: string, opts: RegistrySearchOptions = {}): Promise<RegistryCompany | null> {
  try {
    const code = String(registryCode ?? '').replace(/\s+/g, '')
    if (!/^\d{8}$/.test(code)) return null
    const rec = await getRecord(code, opts.signal)
    if (rec) return opts.signal?.aborted ? null : rec
    if (rec === null && !opts.signal?.aborted) opts.onUnavailable?.('index')
    if (opts.live) {
      const live = await liveSearch(code, { limit: 5, signal: opts.signal, onFail: () => opts.onUnavailable?.('live') })
      const hit = live.find((l) => l.company.registryCode === code)
      if (hit && !opts.signal?.aborted) return hit.company
    }
    return null
  } catch {
    return null
  }
}

/** Metadata about the bundled index (build date, record count) or null if not available. */
export async function getIndexInfo(): Promise<RegistryIndexInfo | null> {
  try {
    const meta = await loadMeta()
    if (!meta) return null
    const info: RegistryIndexInfo = { builtAt: meta.builtAt, count: meta.count, source: meta.source }
    if (meta.dataDate) info.dataDate = meta.dataDate
    if (meta.sourceUrl) info.sourceUrl = meta.sourceUrl
    if (meta.licence) info.licence = meta.licence
    if (meta.licenceUrl) info.licenceUrl = meta.licenceUrl
    if (meta.attribution) info.attribution = meta.attribution
    return info
  } catch {
    return null
  }
}
