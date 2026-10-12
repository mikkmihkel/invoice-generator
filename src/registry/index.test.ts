import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { build } from '../../scripts/registry/build-index.mjs'
import * as buildNormalize from '../../scripts/registry/normalize.mjs'
import { getCompanyByCode, getIndexInfo, resetRegistryCache, searchCompanies } from './index'
import { LIVE_ENDPOINT, liveSearch } from './live'
import { nameTokens, normalizeText, queryTokens } from './normalize'

const FIXTURE = path.resolve(__dirname, '../../scripts/registry/fixtures/lihtandmed.csv')

let tmp: string
let indexDir: string
let splitDir: string
let liveHandler: ((url: URL, init?: RequestInit) => Promise<Response>) | null = null
let currentDir: string | null = null
const fetchLog: string[] = []

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = String(input instanceof Request ? input.url : input)
  fetchLog.push(raw)
  if (raw.startsWith(LIVE_ENDPOINT)) {
    if (!liveHandler) throw new TypeError('Failed to fetch')
    return liveHandler(new URL(raw), init)
  }
  const m = /registry\/([^?]+)/.exec(raw)
  if (!m || !currentDir) return new Response('not found', { status: 404 })
  try {
    const body = await readFile(path.join(currentDir, m[1]), 'utf8')
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
  } catch {
    return new Response('not found', { status: 404 })
  }
}

const liveJson = (data: unknown[]) => async () => new Response(JSON.stringify({ status: 'OK', data }), { status: 200 })

beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'registry-client-'))
  indexDir = path.join(tmp, 'index')
  splitDir = path.join(tmp, 'split')
  await build({ input: FIXTURE, outDir: indexDir })
  // Tiny limits force split shards, top lists and truncated tokens even with the small fixture.
  await build({ input: FIXTURE, outDir: splitDir, shardMax: 2, maxPostings: 2, starMax: 3 })
})
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})
beforeEach(() => {
  resetRegistryCache()
  currentDir = indexDir
  liveHandler = null
  fetchLog.length = 0
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const codes = (rs: { registryCode: string }[]) => rs.map((r) => r.registryCode)

describe('normalisation parity with the index builder', () => {
  it('matches scripts/registry/normalize.mjs', () => {
    const samples = ['Põhjala Õlletehas OÜ', '"Kuldne Kala" OÜ', 'Šokk & Žürii AS', 'MTÜ Ühine Jõud', 'Ærø ß Łódź', 'McDonald’s', 'A&B Ehitus', 'AS']
    for (const s of samples) {
      expect(normalizeText(s)).toBe(buildNormalize.normalizeText(s))
      expect(nameTokens(s)).toEqual(buildNormalize.nameTokens(s))
    }
    expect([...buildNormalize.STOP_WORDS].sort()).toEqual(
      [...new Set(['ou', 'osauhing', 'as', 'aktsiaselts', 'mtu', 'mittetulundusuhing', 'sa', 'sihtasutus', 'tu', 'taisuhing', 'uu', 'usaldusuhing', 'fie', 'tulundusuhistu', 'ku', 'korteriuhistu'])].sort(),
    )
  })

  it('query tokens drop legal-form words unless that is all there is', () => {
    expect(queryTokens('Mustamäe Side AS')).toEqual(['mustamae', 'side'])
    expect(queryTokens('as')).toEqual(['as'])
    expect(queryTokens('  ')).toEqual([])
  })
})

describe('getIndexInfo', () => {
  it('returns build metadata and licence', async () => {
    const info = await getIndexInfo()
    expect(info).toMatchObject({ count: 15, licence: 'CC BY 4.0' })
    expect(info?.builtAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(info?.attribution).toMatch(/CC BY 4\.0/)
  })
})

describe('searchCompanies (static index)', () => {
  it('ranks exact, then starts-with, active before liquidation', async () => {
    const rs = await searchCompanies('kinnisvara')
    expect(codes(rs)).toEqual(['12999997', '12666661', '10000018', '12888887', '14000009'])
    expect(rs[2]).toMatchObject({ name: 'Kinnisvara Partnerid AS', status: 'Likvideerimisel', legalForm: 'AS' })
  })

  it('ignores diacritics and case', async () => {
    expect(codes(await searchCompanies('ÕUNAPUU'))).toEqual(['14000009'])
    expect(codes(await searchCompanies('ounapuu'))).toEqual(['14000009'])
    expect(codes(await searchCompanies('šokk'))).toEqual(['12666661'])
    expect(codes(await searchCompanies('sokk'))).toEqual(['12666661'])
  })

  it('matches every word as a prefix (AND)', async () => {
    expect(codes(await searchCompanies('pohj õlle'))).toEqual(['12345678'])
    expect(codes(await searchCompanies('eesti kinnisvara'))).toEqual(['12888887'])
    expect(codes(await searchCompanies('eesti kala'))).toEqual([])
    expect(codes(await searchCompanies('Mustamäe Side AS'))).toEqual(['10555555'])
  })

  it('respects the limit', async () => {
    expect(await searchCompanies('kinnisvara', { limit: 2 })).toHaveLength(2)
  })

  it('finds by exact registry code and by code prefix', async () => {
    expect(codes(await searchCompanies('12345678'))).toEqual(['12345678'])
    expect(codes(await searchCompanies('1234 5678'))).toEqual(['12345678'])
    expect(codes(await searchCompanies('12345'))).toEqual(['12345678'])
    expect(await searchCompanies('99999999')).toEqual([])
  })

  it('excludes deleted companies', async () => {
    expect(await searchCompanies('vana ehitus')).toEqual([])
    expect(await getCompanyByCode('12222220')).toBeNull()
  })

  it('returns full company data with mapped address', async () => {
    const [c] = await searchCompanies('põhjala')
    expect(c).toEqual({
      registryCode: '12345678',
      name: 'Põhjala Õlletehas OÜ',
      legalForm: 'OÜ',
      vatNumber: 'EE101234567',
      status: 'Registrisse kantud',
      address: { street: 'Peetri tn 5', city: 'Tallinn', postalCode: '10111', county: 'Harju maakond', country: 'EE' },
      addressText: 'Peetri tn 5, Kesklinna linnaosa, Tallinn, 10111 Harju maakond',
    })
  })
})

describe('getCompanyByCode', () => {
  it.each([
    ['14000009', { legalForm: 'OÜ', address: { street: 'Turu tn 34', city: 'Tartu', postalCode: '51004', county: 'Tartu maakond', country: 'EE' } }],
    ['14111111', { name: 'Jaan Tamm', legalForm: 'FIE', address: { street: 'Mäe', city: 'Linaküla, Kihnu vald', postalCode: '88003', county: 'Pärnu maakond', country: 'EE' } }],
    ['10000018', { address: { street: 'Pargi tn 2', city: 'Keila', postalCode: '76607', county: 'Harju maakond', country: 'EE' } }],
    ['90001233', { legalForm: 'SA', address: { street: 'Tiigi tn 1', city: 'Abja-Paluoja linn, Mulgi vald', postalCode: '69403', county: 'Viljandi maakond', country: 'EE' } }],
    ['80123455', { legalForm: 'MTÜ', name: 'MTÜ Ühine Jõud' }],
    ['80555551', { legalForm: 'KÜ' }],
    ['11111116', { name: '"Kuldne Kala" OÜ', status: 'Pankrotis', vatNumber: 'EE101111116' }],
    ['16111115', { address: { street: 'Ahtri tn 12', city: 'Tallinn', postalCode: '10151', county: 'Harju maakond', country: 'EE' }, addressText: 'Ahtri tn 12, Kesklinna linnaosa, Tallinn, 10151 Harju maakond' }],
  ])('%s', async (code, expected) => {
    expect(await getCompanyByCode(code)).toMatchObject({ registryCode: code, ...expected })
  })

  it('gives only address text for a foreign address', async () => {
    const c = await getCompanyByCode('14777778')
    expect(c).toMatchObject({ legalForm: 'filiaal', addressText: '313A/133 GOULBURN STREET, Surry Hills, NSW, 2010' })
    expect(c?.address).toBeUndefined()
  })

  it('rejects malformed codes', async () => {
    expect(await getCompanyByCode('1234')).toBeNull()
    expect(await getCompanyByCode('abcdefgh')).toBeNull()
  })

  it('caches shards in memory', async () => {
    await getCompanyByCode('12345678')
    await getCompanyByCode('12345678')
    expect(fetchLog.filter((u) => u.includes('r/12345.json'))).toHaveLength(1)
    expect(fetchLog.filter((u) => u.includes('meta.json'))).toHaveLength(1)
  })
})

describe('split index (top lists, truncated tokens)', () => {
  beforeEach(() => {
    currentDir = splitDir
  })

  it('still finds companies through deeper shards', async () => {
    expect(codes(await searchCompanies('pohjala'))).toEqual(['12345678'])
    expect(codes(await searchCompanies('eesti kinnisvara'))).toEqual(['12888887'])
    expect(codes(await searchCompanies('õunapuu kinnisvara'))).toEqual(['14000009'])
  })

  it('answers short prefixes from the top list', async () => {
    const rs = await searchCompanies('k')
    expect(rs.length).toBeGreaterThan(0)
    expect(rs.length).toBeLessThanOrEqual(4)
    for (const r of rs) expect(nameTokens(r.name).some((t) => t.startsWith('k'))).toBe(true)
  })

  it('returns the best of a truncated token list', async () => {
    const rs = await searchCompanies('kinnisvara')
    expect(codes(rs).slice(0, 1)).toEqual(['12999997'])
  })
})

describe('graceful degradation', () => {
  it('returns empty results when the index is missing', async () => {
    currentDir = null
    expect(await searchCompanies('kinnisvara')).toEqual([])
    expect(await getCompanyByCode('12345678')).toBeNull()
    expect(await getIndexInfo()).toBeNull()
  })

  it('handles network errors and HTML fallbacks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })))
    expect(await searchCompanies('kinnisvara')).toEqual([])
    resetRegistryCache()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await searchCompanies('kinnisvara')).toEqual([])
    expect(await getCompanyByCode('12345678')).toBeNull()
  })

  it('resolves to [] / null when aborted', async () => {
    const ctrl = new AbortController()
    const p = searchCompanies('kinnisvara', { signal: ctrl.signal })
    ctrl.abort()
    expect(await p).toEqual([])
    expect(await getCompanyByCode('12345678', { signal: ctrl.signal })).toBeNull()
    // the shared cache is not poisoned by an aborted caller
    expect(codes(await searchCompanies('eesti kinnisvara'))).toEqual(['12888887'])
  })

  it('handles empty and nonsense queries', async () => {
    expect(await searchCompanies('')).toEqual([])
    expect(await searchCompanies('   ')).toEqual([])
    expect(await searchCompanies('!!!')).toEqual([])
    expect(await searchCompanies('zzzzqqq')).toEqual([])
  })
})

describe('live layer', () => {
  const newCompany = {
    company_id: 1, reg_code: 17000001, name: 'Uus Firma OÜ', historical_names: [], status: 'R',
    legal_address: 'Harju maakond, Tallinn, Kristiine linnaosa, Mustamäe tee 3', zip_code: '15033', legal_form: '5',
    url: 'https://ariregister.rik.ee/est/company/17000001/Uus-Firma-OÜ',
  }

  it('merges live hits with index results and dedupes', async () => {
    liveHandler = liveJson([
      newCompany,
      { reg_code: 12888887, name: 'Eesti Kinnisvara OÜ', status: 'L', legal_address: 'Harju maakond, Tallinn, Pirita linnaosa, Regati pst 12', zip_code: '11911', legal_form: '5' },
      { reg_code: 12222220, name: 'Vana Kinnisvara OÜ', status: 'K' },
    ])
    const rs = await searchCompanies('kinnisvara', { live: true, limit: 10 })
    const live = fetchLog.find((u) => u.startsWith(LIVE_ENDPOINT))
    expect(live).toContain('q=kinnisvara')
    expect(codes(rs)).toContain('17000001')
    expect(codes(rs)).not.toContain('12222220')
    expect(new Set(codes(rs)).size).toBe(rs.length)
    // index data (VAT) kept, fresher status from live
    expect(rs.find((r) => r.registryCode === '12888887')).toMatchObject({ vatNumber: 'EE102888887', status: 'Likvideerimisel' })
    expect(rs.find((r) => r.registryCode === '17000001')).toMatchObject({
      name: 'Uus Firma OÜ',
      legalForm: 'OÜ',
      status: 'Registrisse kantud',
      address: { street: 'Mustamäe tee 3', city: 'Tallinn', postalCode: '15033', county: 'Harju maakond', country: 'EE' },
    })
  })

  it('is silent when the live API fails (CORS / network)', async () => {
    liveHandler = null // fetch throws TypeError like a CORS failure
    expect(codes(await searchCompanies('eesti kinnisvara', { live: true }))).toEqual(['12888887'])
    liveHandler = async () => new Response('oops', { status: 500 })
    expect(codes(await searchCompanies('eesti kinnisvara', { live: true }))).toEqual(['12888887'])
  })

  it('works without an index and falls back to live for unknown codes', async () => {
    currentDir = null
    liveHandler = liveJson([newCompany])
    expect(codes(await searchCompanies('uus firma', { live: true }))).toEqual(['17000001'])
    expect(await getCompanyByCode('17000001', { live: true })).toMatchObject({ name: 'Uus Firma OÜ' })
    expect(await getCompanyByCode('17000001')).toBeNull()
  })

  it('times out', async () => {
    liveHandler = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    const started = Date.now()
    expect(await liveSearch('kinnisvara', { timeoutMs: 20 })).toEqual([])
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
