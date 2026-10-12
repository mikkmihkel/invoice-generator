#!/usr/bin/env node
// Builds the static e-Business Register (Äriregister) search index served from public/registry/.
// Source: RIK open data "lihtandmed" CSV (daily, CC BY 4.0). See docs/registry.md for the format.
//
//   node scripts/registry/build-index.mjs                       # download from RIK (REGISTRY_SOURCE_URL overrides)
//   node scripts/registry/build-index.mjs --input file.csv|zip  # offline / testing
//   options: --out <dir> (default public/registry)  --min-count <n>  --max-postings <n>  --shard-max <n>  --quiet
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'
import { parse } from 'csv-parse'
import { nameTokens } from './normalize.mjs'

export const DEFAULT_SOURCE_URL =
  'https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__lihtandmed.csv.zip'
export const INDEX_VERSION = 1
export const SOURCE_NAME = 'Äriregister (RIK e-äriregistri avaandmed, ettevotja_rekvisiidid__lihtandmed)'
export const LICENCE = 'CC BY 4.0'
export const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/'
export const ATTRIBUTION =
  'Andmed: e-äriregister, Registrite ja Infosüsteemide Keskus (RIK), avaandmed litsentsiga CC BY 4.0 / ' +
  'Data: Estonian e-Business Register, Centre of Registers and Information Systems (RIK), open data under CC BY 4.0'

/** Column order of the lihtandmed CSV (used as a fallback if the header names ever change). */
export const COLUMNS = [
  'nimi',
  'ariregistri_kood',
  'ettevotja_oiguslik_vorm',
  'ettevotja_oigusliku_vormi_alaliik',
  'kmkr_nr',
  'ettevotja_staatus',
  'ettevotja_staatus_tekstina',
  'ettevotja_esmakande_kpv',
  'ettevotja_aadress',
  'asukoht_ettevotja_aadressis',
  'asukoha_ehak_kood',
  'asukoha_ehak_tekstina',
  'indeks_ettevotja_aadressis',
  'ads_adr_id',
  'ads_ads_oid',
  'ads_normaliseeritud_taisaadress',
  'teabesysteemi_link',
]

/** R = registrisse kantud, L = likvideerimisel, N = pankrotis. K = kustutatud is dropped. */
const KEEP_STATUSES = new Set(['R', 'L', 'N'])
const STATUS_ORDER = { R: 0, L: 1, N: 2 }

const LEGAL_FORMS = new Map(
  Object.entries({
    osaühing: 'OÜ',
    aktsiaselts: 'AS',
    'füüsilisest isikust ettevõtja': 'FIE',
    mittetulundusühing: 'MTÜ',
    sihtasutus: 'SA',
    täisühing: 'TÜ',
    usaldusühing: 'UÜ',
    korteriühistu: 'KÜ',
    'euroopa äriühing': 'SE',
    'välismaa äriühingu filiaal': 'filiaal',
  }),
)

export const DEFAULTS = {
  /** Max postings kept per token (most relevant first); longer lists are truncated and flagged. */
  maxPostings: 2500,
  /** A name shard with more postings than this is split by the next character. */
  shardMax: 4000,
  /** Size of the "top results" list stored in split shards for short prefixes. */
  starMax: 200,
  /** Registry-code prefix length for record shards. */
  recordShardDigits: 5,
}

function clean(v) {
  if (v == null) return ''
  let s = String(v).trim()
  // Fields fully wrapped in quotes (RFC-4180 style) are unwrapped; inner quotes of names are kept.
  if (s.length >= 2 && /^"(?:[^"]|"")*"$/.test(s)) s = s.slice(1, -1).replace(/""/g, '"').trim()
  if (s === '.na' || s === 'NA' || s === 'NaN') return ''
  return s
}

export function shortLegalForm(form) {
  const f = clean(form)
  if (!f) return ''
  return LEGAL_FORMS.get(f.toLowerCase()) ?? f
}

function normalizeVat(v) {
  const s = clean(v).toUpperCase().replace(/\s+/g, '')
  if (/^\d{9}$/.test(s)) return `EE${s}`
  return s
}

/** Map a CSV row (array) to an index record, or null when it should be skipped. */
export function toRecord(row, col) {
  const get = (name) => clean(row[col[name]])
  const code = get('ariregistri_kood')
  if (!/^\d{8}$/.test(code)) return null
  const status = get('ettevotja_staatus').toUpperCase()
  if (!KEEP_STATUSES.has(status)) return null
  const name = get('nimi').replace(/\s+/g, ' ')
  if (!name) return null
  const ehak = get('asukoha_ehak_tekstina')
  return {
    code,
    name,
    form: shortLegalForm(get('ettevotja_oiguslik_vorm')),
    vat: normalizeVat(get('kmkr_nr')),
    status,
    street: get('asukoht_ettevotja_aadressis'),
    ehak,
    postal: get('indeks_ettevotja_aadressis'),
    // Only needed when the EHAK text is missing; the client derives the address from it.
    ads: ehak ? '' : get('ads_normaliseeritud_taisaadress'),
  }
}

// ---------------------------------------------------------------------------------------------
// ZIP (single entry) reader — Node has no unzip; the RIK file is a plain deflate ZIP.

const SIG_EOCD = 0x06054b50
const SIG_ZIP64_LOCATOR = 0x07064b50
const SIG_ZIP64_EOCD = 0x06064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

async function readAt(fh, position, length) {
  const buf = Buffer.alloc(length)
  const { bytesRead } = await fh.read(buf, 0, length, position)
  return buf.subarray(0, bytesRead)
}

/** Locate the first entry matching `match` and return where its compressed data starts. */
export async function findZipEntry(zipPath, match = (n) => /\.csv$/i.test(n)) {
  const fh = await open(zipPath, 'r')
  try {
    const { size } = await fh.stat()
    const tailLen = Math.min(size, 22 + 0xffff + 20)
    const tail = await readAt(fh, size - tailLen, tailLen)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error('Not a ZIP file (end of central directory not found)')
    let count = tail.readUInt16LE(eocd + 10)
    let cdSize = tail.readUInt32LE(eocd + 12)
    let cdOffset = tail.readUInt32LE(eocd + 16)
    if ((cdOffset === 0xffffffff || count === 0xffff) && eocd >= 20 && tail.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR) {
      const z64 = await readAt(fh, Number(tail.readBigUInt64LE(eocd - 20 + 8)), 56)
      if (z64.readUInt32LE(0) !== SIG_ZIP64_EOCD) throw new Error('Corrupt ZIP64 directory')
      count = Number(z64.readBigUInt64LE(32))
      cdSize = Number(z64.readBigUInt64LE(40))
      cdOffset = Number(z64.readBigUInt64LE(48))
    }
    const cd = await readAt(fh, cdOffset, cdSize)
    let p = 0
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('Corrupt ZIP central directory')
      const method = cd.readUInt16LE(p + 10)
      let compressedSize = cd.readUInt32LE(p + 20)
      let uncompressedSize = cd.readUInt32LE(p + 24)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      let localOffset = cd.readUInt32LE(p + 42)
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8')
      // ZIP64 extended information extra field
      let e = p + 46 + nameLen
      const extraEnd = e + extraLen
      while (e + 4 <= extraEnd) {
        const id = cd.readUInt16LE(e)
        const len = cd.readUInt16LE(e + 2)
        if (id === 0x0001) {
          let q = e + 4
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = Number(cd.readBigUInt64LE(q))
            q += 8
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(cd.readBigUInt64LE(q))
            q += 8
          }
          if (localOffset === 0xffffffff) localOffset = Number(cd.readBigUInt64LE(q))
        }
        e += 4 + len
      }
      p = extraEnd + commentLen
      if (name.endsWith('/') || !match(name)) continue
      const local = await readAt(fh, localOffset, 30)
      if (local.readUInt32LE(0) !== SIG_LOCAL) throw new Error('Corrupt ZIP local header')
      const dataStart = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
      return { name, method, compressedSize, uncompressedSize, dataStart }
    }
    throw new Error('No CSV file found in the ZIP archive')
  } finally {
    await fh.close()
  }
}

async function isZip(file) {
  const fh = await open(file, 'r')
  try {
    const head = await readAt(fh, 0, 4)
    return head.length === 4 && head.readUInt32LE(0) === SIG_LOCAL
  } finally {
    await fh.close()
  }
}

/** Readable stream of the CSV bytes, whether `file` is a CSV or a ZIP containing one. */
export async function openCsvStream(file) {
  if (!(await isZip(file))) return createReadStream(file)
  const entry = await findZipEntry(file)
  if (entry.compressedSize === 0) return Readable.from([])
  const raw = createReadStream(file, { start: entry.dataStart, end: entry.dataStart + entry.compressedSize - 1 })
  if (entry.method === 0) return raw
  if (entry.method !== 8) throw new Error(`Unsupported ZIP compression method ${entry.method}`)
  const inflate = zlib.createInflateRaw()
  raw.on('error', (err) => inflate.destroy(err))
  return raw.pipe(inflate)
}

async function download(url, dest, log) {
  log(`Downloading ${url}`)
  const res = await fetch(url, { headers: { 'user-agent': 'invoice-generator registry index builder (GitHub Actions)' } })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText} (${url})`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  return res.headers.get('last-modified')
}

/** Parse the CSV stream into index records (deleted entities and malformed rows dropped). */
export async function readRecords(stream, log = () => {}) {
  // `quote: false`: names like `"Kuldne Kala" OÜ` contain bare quotes; fields never contain ';'.
  const parser = parse({ delimiter: ';', bom: true, quote: false, relax_column_count: true, skip_empty_lines: true })
  stream.on('error', (err) => parser.destroy(err))
  stream.pipe(parser)
  const records = new Map()
  let col = null
  let rows = 0
  let skipped = 0
  for await (const row of parser) {
    if (!col) {
      const header = row.map((h) => clean(h).replace(/^﻿/, '').toLowerCase())
      col = {}
      const missing = []
      COLUMNS.forEach((name, i) => {
        const idx = header.indexOf(name)
        if (idx < 0) missing.push(name)
        col[name] = idx >= 0 ? idx : i
      })
      if (missing.includes('ariregistri_kood') || missing.includes('nimi')) {
        log(`WARNING: unexpected CSV header, falling back to column positions. Header: ${header.join(';')}`)
      }
      continue
    }
    rows++
    const rec = toRecord(row, col)
    if (rec) records.set(rec.code, rec)
    else skipped++
  }
  log(`Read ${rows} rows, kept ${records.size}, skipped ${skipped} (deleted / malformed)`)
  return [...records.values()]
}

// ---------------------------------------------------------------------------------------------
// Index construction

function comparePostings(a, b) {
  return (
    (a.first ? 0 : 1) - (b.first ? 0 : 1) ||
    STATUS_ORDER[a.rec.status] - STATUS_ORDER[b.rec.status] ||
    a.rec.name.length - b.rec.name.length ||
    (a.rec.name < b.rec.name ? -1 : a.rec.name > b.rec.name ? 1 : 0)
  )
}

const postingJson = (p) => (p.rec.status === 'R' ? [Number(p.rec.code), p.rec.name] : [Number(p.rec.code), p.rec.name, p.rec.status])

function trimTrailingEmpty(arr) {
  let n = arr.length
  while (n > 0 && arr[n - 1] === '') n--
  return arr.slice(0, n)
}

/**
 * Build all index files in memory.
 * Returns { files: Map<relativePath, jsonString>, meta }.
 */
export function buildIndex(records, options = {}) {
  const opts = { ...DEFAULTS, ...options }

  // token -> postings
  const tokens = new Map()
  for (const rec of records) {
    const seen = new Set()
    nameTokens(rec.name).forEach((t, i) => {
      if (seen.has(t)) return
      seen.add(t)
      let list = tokens.get(t)
      if (!list) tokens.set(t, (list = []))
      list.push({ rec, first: i === 0 })
    })
  }
  const truncated = new Set()
  let postingCount = 0
  for (const [t, list] of tokens) {
    list.sort(comparePostings)
    if (list.length > opts.maxPostings) {
      list.length = opts.maxPostings
      truncated.add(t)
    }
    postingCount += list.length
  }

  const files = new Map()
  const shards = {}

  const writeShard = (key, toks, split) => {
    const t = {}
    const x = []
    for (const tok of toks) {
      if (split && tok !== key) continue
      t[tok] = tokens.get(tok).map(postingJson)
      if (truncated.has(tok)) x.push(tok)
    }
    const body = { t }
    if (x.length) body.x = x
    if (split) {
      const all = toks.flatMap((tok) => tokens.get(tok))
      all.sort(comparePostings)
      const seen = new Set()
      const s = []
      for (const p of all) {
        if (seen.has(p.rec.code)) continue
        seen.add(p.rec.code)
        s.push(postingJson(p))
        if (s.length >= opts.starMax) break
      }
      body.s = s
    }
    files.set(`n/${key}.json`, JSON.stringify(body))
    shards[key] = split ? 1 : 0
  }

  const assign = (key, toks) => {
    const total = toks.reduce((n, tok) => n + tokens.get(tok).length, 0)
    const longer = toks.filter((tok) => tok.length > key.length)
    if (total <= opts.shardMax || longer.length === 0) {
      writeShard(key, toks, false)
      return
    }
    writeShard(key, toks, true)
    const groups = new Map()
    for (const tok of longer) {
      const k = tok.slice(0, key.length + 1)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(tok)
    }
    for (const [k, g] of groups) assign(k, g)
  }

  const roots = new Map()
  for (const tok of tokens.keys()) {
    const k = tok[0]
    if (!roots.has(k)) roots.set(k, [])
    roots.get(k).push(tok)
  }
  for (const [k, g] of roots) assign(k, g)

  // Record shards by registry-code prefix
  const recordShards = new Map()
  for (const rec of records) {
    const k = rec.code.slice(0, opts.recordShardDigits)
    if (!recordShards.has(k)) recordShards.set(k, {})
    recordShards.get(k)[rec.code] = trimTrailingEmpty([rec.name, rec.form, rec.vat, rec.status, rec.street, rec.ehak, rec.postal, rec.ads])
  }
  for (const [k, obj] of recordShards) files.set(`r/${k}.json`, JSON.stringify(obj))

  const meta = {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    dataDate: opts.dataDate ?? null,
    count: records.length,
    source: SOURCE_NAME,
    sourceUrl: opts.sourceUrl ?? DEFAULT_SOURCE_URL,
    licence: LICENCE,
    licenceUrl: LICENCE_URL,
    attribution: ATTRIBUTION,
    recordShardDigits: opts.recordShardDigits,
    stats: {
      tokens: tokens.size,
      postings: postingCount,
      truncatedTokens: truncated.size,
      nameShards: Object.keys(shards).length,
      recordShards: recordShards.size,
    },
    shards,
  }
  return { files, meta }
}

/** Remove a previous index from `outDir` (keeps .gitkeep and anything unrelated). */
async function cleanOutDir(outDir) {
  await rm(path.join(outDir, 'meta.json'), { force: true })
  await rm(path.join(outDir, 'n'), { recursive: true, force: true })
  await rm(path.join(outDir, 'r'), { recursive: true, force: true })
}

export async function writeIndex(outDir, { files, meta }) {
  await cleanOutDir(outDir)
  await mkdir(path.join(outDir, 'n'), { recursive: true })
  await mkdir(path.join(outDir, 'r'), { recursive: true })
  const entries = [...files]
  let bytes = 0
  const BATCH = 64
  for (let i = 0; i < entries.length; i += BATCH) {
    await Promise.all(
      entries.slice(i, i + BATCH).map(([rel, body]) => {
        bytes += Buffer.byteLength(body)
        return writeFile(path.join(outDir, rel), body)
      }),
    )
  }
  meta.stats.bytes = bytes
  // meta.json last: the client treats a directory without it as "no index".
  await writeFile(path.join(outDir, 'meta.json'), JSON.stringify(meta))
  return meta
}

/**
 * Full pipeline: obtain source (local --input or download), parse, build, write.
 * @param {{ input?: string, url?: string, outDir: string, minCount?: number, log?: (msg: string) => void } & Partial<typeof DEFAULTS>} options
 */
export async function build(options) {
  const log = options.log ?? (() => {})
  let file = options.input
  let tmp = null
  let dataDate = null
  const sourceUrl = options.input ? `file:${path.basename(options.input)}` : (options.url ?? DEFAULT_SOURCE_URL)
  try {
    if (!file) {
      tmp = await mkdtemp(path.join(tmpdir(), 'registry-'))
      file = path.join(tmp, 'source.zip')
      const lastModified = await download(sourceUrl, file, log)
      dataDate = lastModified ? new Date(lastModified).toISOString() : null
    }
    const records = await readRecords(await openCsvStream(file), log)
    const minCount = options.minCount ?? 0
    if (records.length < minCount) {
      throw new Error(`Only ${records.length} records parsed (expected at least ${minCount}) — source format changed?`)
    }
    const index = buildIndex(records, { ...options, dataDate, sourceUrl })
    const meta = await writeIndex(options.outDir, index)
    log(
      `Wrote ${meta.count} companies to ${options.outDir}: ${meta.stats.nameShards} name shards, ` +
        `${meta.stats.recordShards} record shards, ${(meta.stats.bytes / 1e6).toFixed(1)} MB ` +
        `(${meta.stats.truncatedTokens} very common tokens truncated)`,
    )
    return meta
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  }
}

const USAGE = `Usage: node scripts/registry/build-index.mjs [options]
  (no --input)          download ${DEFAULT_SOURCE_URL}
                        (override with env REGISTRY_SOURCE_URL)
  --input, -i <file>    local lihtandmed .csv or .csv.zip instead of downloading
  --out, -o <dir>       output directory (default public/registry)
  --min-count <n>       fail if fewer companies are parsed (default 1000 when downloading, 0 with --input)
  --max-postings <n>    max postings per name token (default ${DEFAULTS.maxPostings})
  --shard-max <n>       split name shards above this many postings (default ${DEFAULTS.shardMax})
  --quiet               no progress output`

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`Missing value for ${a}`)
      return v
    }
    if (a === '--input' || a === '-i') out.input = next()
    else if (a === '--out' || a === '-o') out.outDir = next()
    else if (a === '--min-count') out.minCount = Number(next())
    else if (a === '--max-postings') out.maxPostings = Number(next())
    else if (a === '--shard-max') out.shardMax = Number(next())
    else if (a === '--quiet') out.quiet = true
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`Unknown argument: ${a}`)
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  await build({
    ...args,
    url: process.env.REGISTRY_SOURCE_URL || DEFAULT_SOURCE_URL,
    outDir: path.resolve(args.outDir ?? path.join(root, 'public/registry')),
    // A real download must yield a plausible number of companies; local inputs may be tiny fixtures.
    minCount: args.minCount ?? (args.input ? 0 : 1000),
    log: args.quiet ? () => {} : (msg) => console.log(`[registry] ${msg}`),
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`[registry] FAILED: ${err?.stack ?? err}`)
    process.exitCode = 1
  })
}
