// Client for the static search index in public/registry/ (built by scripts/registry/build-index.mjs).
// Every function resolves to null / [] when the index is missing or a file fails to load.
import type { RegistryCompany } from '../domain/types'
import { STATUS_TEXT, legalFormFromName, recordAddress } from './address'

export interface IndexMeta {
  version: number
  builtAt: string
  dataDate?: string | null
  count: number
  source: string
  sourceUrl?: string
  licence?: string
  licenceUrl?: string
  attribution?: string
  recordShardDigits: number
  /** Name shard keys: 0 = leaf, 1 = split into longer keys. */
  shards: Record<string, 0 | 1>
}

/** [registryCode, name, status?] — status omitted when 'R'. */
type PostingJson = [number, string, string?]
interface NameShard {
  /** token → postings */
  t: Record<string, PostingJson[]>
  /** tokens whose posting list was truncated at build time */
  x?: string[]
  /** split shards only: best postings over all tokens with this prefix */
  s?: PostingJson[]
}
/** [name, legalForm, vat, status, street, ehakText, postalCode, adsFullAddress] — trailing empties trimmed. */
type RecordJson = string[]
type RecordShard = Record<string, RecordJson>

export interface Candidate {
  code: string
  name: string
  /** Status code: R, L, N (K for deleted, live results only). */
  status: string
}

export const INDEX_DIR = 'registry/'
const META_RETRY_MS = 30_000
const SHARD_CACHE_LIMIT = 400

let metaPromise: Promise<IndexMeta | null> | null = null
let metaFailedAt = 0
const shardCache = new Map<string, Promise<unknown>>()

/** Testing hook: forget cached meta and shards. */
export function resetIndexCache(): void {
  metaPromise = null
  metaFailedAt = 0
  shardCache.clear()
}

function indexUrl(rel: string): string {
  return `${import.meta.env.BASE_URL}${INDEX_DIR}${rel}`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init)
    if (!res.ok) return null
    // Vite's dev server answers unknown paths with index.html — json() then throws, caught below.
    return (await res.json()) as T
  } catch {
    return null
  }
}

export class AbortedError extends Error {
  constructor() {
    super('Aborted')
    this.name = 'AbortError'
  }
}

/** Resolve `p`, or reject as soon as `signal` aborts (the underlying fetch keeps filling the cache). */
export function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(new AbortedError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AbortedError())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export function loadMeta(): Promise<IndexMeta | null> {
  if (metaPromise && !(metaFailedAt && Date.now() - metaFailedAt > META_RETRY_MS)) return metaPromise
  metaFailedAt = 0
  metaPromise = fetchJson<IndexMeta>(indexUrl('meta.json'), { cache: 'no-cache' }).then((meta) => {
    if (!meta || typeof meta !== 'object' || meta.version !== 1 || !meta.shards || !meta.recordShardDigits) {
      metaFailedAt = Date.now()
      return null
    }
    return meta
  })
  return metaPromise
}

function loadShard<T>(meta: IndexMeta, rel: string): Promise<T | null> {
  const cached = shardCache.get(rel)
  if (cached) {
    // refresh LRU position
    shardCache.delete(rel)
    shardCache.set(rel, cached)
    return cached as Promise<T | null>
  }
  const p = fetchJson<T>(`${indexUrl(rel)}?v=${encodeURIComponent(meta.builtAt)}`).then((v) => {
    if (v == null) shardCache.delete(rel)
    return v
  })
  shardCache.set(rel, p)
  if (shardCache.size > SHARD_CACHE_LIMIT) shardCache.delete(shardCache.keys().next().value!)
  return p
}

const toCandidate = ([code, name, status]: PostingJson): Candidate => ({
  code: String(code).padStart(8, '0'),
  name,
  status: status || 'R',
})

/** Which name shard holds tokens starting with `token`; `viaStar` = only the shard's top list covers it. */
export function resolveShardKey(shards: Record<string, 0 | 1>, token: string): { key: string; viaStar: boolean } | null {
  let key = token.slice(0, 1)
  if (!Object.hasOwn(shards, key)) return null
  while (shards[key] === 1 && token.length > key.length) {
    const next = token.slice(0, key.length + 1)
    if (!Object.hasOwn(shards, next)) return null
    key = next
  }
  return { key, viaStar: shards[key] === 1 }
}

interface TokenMatches {
  candidates: Candidate[]
  /** false when the list may be missing matches (truncated or top-list only) */
  complete: boolean
}

async function matchesForToken(meta: IndexMeta, token: string, signal?: AbortSignal): Promise<TokenMatches | null> {
  const loc = resolveShardKey(meta.shards, token)
  if (!loc) return { candidates: [], complete: true }
  const shard = await abortable(loadShard<NameShard>(meta, `n/${loc.key}.json`), signal)
  if (!shard || typeof shard.t !== 'object') return null
  const truncated = new Set(shard.x ?? [])
  const out: Candidate[] = []
  let complete = true
  if (loc.viaStar) {
    complete = false
    for (const p of shard.t[token] ?? []) out.push(toCandidate(p))
    for (const p of shard.s ?? []) out.push(toCandidate(p))
  } else {
    for (const [tok, postings] of Object.entries(shard.t)) {
      if (!tok.startsWith(token)) continue
      if (truncated.has(tok)) complete = false
      for (const p of postings) out.push(toCandidate(p))
    }
  }
  return { candidates: out, complete }
}

/**
 * All indexed companies whose name has, for every query token, a word starting with it.
 * Returns null when the index is unavailable. Not ranked.
 */
export async function findByTokens(tokens: string[], nameMatches: (name: string) => boolean, signal?: AbortSignal): Promise<Candidate[] | null> {
  const meta = await abortable(loadMeta(), signal)
  if (!meta) return null
  if (!tokens.length) return []
  const lists = await Promise.all(tokens.map((t) => matchesForToken(meta, t, signal)))
  if (lists.some((l) => l === null)) return null
  const all = lists as TokenMatches[]
  // Drive the AND from the smallest complete list; verify the other tokens on the name itself.
  const driver = [...all].sort((a, b) => Number(b.complete) - Number(a.complete) || a.candidates.length - b.candidates.length)[0]
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const c of driver.candidates) {
    if (seen.has(c.code) || !nameMatches(c.name)) continue
    seen.add(c.code)
    out.push(c)
  }
  return out
}

function recordShardKey(meta: IndexMeta, code: string): string {
  return `r/${code.slice(0, meta.recordShardDigits)}.json`
}

export function toCompany(code: string, rec: RecordJson): RegistryCompany {
  const [name = '', form = '', vat = '', status = '', street = '', ehak = '', postal = '', ads = ''] = rec
  const company: RegistryCompany = { registryCode: code, name }
  const legalForm = form || legalFormFromName(name)
  if (legalForm) company.legalForm = legalForm
  if (vat) company.vatNumber = vat
  if (status) company.status = STATUS_TEXT[status] ?? status
  const { address, addressText } = recordAddress(street, ehak, postal, ads)
  if (address) company.address = address
  if (addressText) company.addressText = addressText
  return company
}

/** Full record by 8-digit code: undefined = not in index, null = index unavailable. */
export async function getRecord(code: string, signal?: AbortSignal): Promise<RegistryCompany | undefined | null> {
  const meta = await abortable(loadMeta(), signal)
  if (!meta) return null
  const shard = await abortable(loadShard<RecordShard>(meta, recordShardKey(meta, code)), signal)
  if (!shard) {
    // A missing record shard simply means no company has a code with this prefix.
    return undefined
  }
  const rec = Object.hasOwn(shard, code) ? shard[code] : undefined
  return Array.isArray(rec) ? toCompany(code, rec) : undefined
}

/** Companies whose registry code starts with `prefix` (at least recordShardDigits long). */
export async function findByCodePrefix(prefix: string, signal?: AbortSignal): Promise<Candidate[] | null> {
  const meta = await abortable(loadMeta(), signal)
  if (!meta) return null
  if (prefix.length < meta.recordShardDigits) return []
  const shard = await abortable(loadShard<RecordShard>(meta, recordShardKey(meta, prefix)), signal)
  if (!shard) return []
  return Object.entries(shard)
    .filter(([code]) => code.startsWith(prefix))
    .map(([code, rec]) => ({ code, name: rec[0] ?? '', status: rec[3] || 'R' }))
}
