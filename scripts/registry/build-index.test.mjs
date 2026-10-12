// @vitest-environment node
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, buildIndex, findZipEntry, readRecords, openCsvStream } from './build-index.mjs'
import { nameTokens, normalizeText } from './normalize.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, 'fixtures/lihtandmed.csv')
const SCRIPT = path.join(here, 'build-index.mjs')

/** Minimal single-entry ZIP writer (method 8 = deflate, 0 = stored). */
function makeZip(name, data, method = 8) {
  const body = method === 8 ? zlib.deflateRawSync(data) : data
  const crc = zlib.crc32(data)
  const nameBuf = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(body.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt32LE(0, 42)
  const cdOffset = local.length + nameBuf.length + body.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length + nameBuf.length, 12)
  eocd.writeUInt32LE(cdOffset, 16)
  return Buffer.concat([local, nameBuf, body, central, nameBuf, eocd])
}

let tmp
beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'registry-test-'))
})
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('normalize', () => {
  it('folds Estonian diacritics and strips legal-form words', () => {
    expect(normalizeText('Põhjala Õlletehas OÜ')).toBe('pohjala olletehas ou')
    expect(normalizeText('Kinnisvarabüroo Šokk & Žürii')).toBe('kinnisvaraburoo sokk zurii')
    expect(nameTokens('"Kuldne Kala" OÜ')).toEqual(['kuldne', 'kala'])
    expect(nameTokens('Aktsiaselts Mäe')).toEqual(['mae'])
    expect(nameTokens('McDonald’s Eesti AS')).toEqual(['mcdonalds', 'eesti'])
    // a name made only of legal-form words keeps them
    expect(nameTokens('AS')).toEqual(['as'])
  })
})

describe('CSV parsing', () => {
  it('keeps registered / in liquidation / bankrupt, drops deleted and malformed rows', async () => {
    const records = await readRecords(await openCsvStream(FIXTURE))
    const codes = records.map((r) => r.code)
    expect(records).toHaveLength(15)
    expect(codes).not.toContain('12222220') // K = kustutatud
    expect(codes).not.toContain('123')
    const kala = records.find((r) => r.code === '11111116')
    expect(kala).toMatchObject({ name: '"Kuldne Kala" OÜ', status: 'N', form: 'OÜ', vat: 'EE101111116' })
    const fie = records.find((r) => r.code === '14111111')
    expect(fie).toMatchObject({ form: 'FIE', street: 'Mäe', ehak: 'Linaküla, Kihnu vald, Pärnu maakond', postal: '88003', ads: '' })
    expect(records.find((r) => r.code === '14777778')?.form).toBe('filiaal')
    // ADS full address is only kept when the EHAK text is missing
    expect(records.find((r) => r.code === '16111115')?.ads).toBe('Harju maakond, Tallinn, Kesklinna linnaosa, Ahtri tn 12')
  })

  it('reads the CSV from a ZIP archive (deflate and stored)', async () => {
    const csv = await readFile(FIXTURE)
    for (const method of [8, 0]) {
      const zipPath = path.join(tmp, `src-${method}.zip`)
      await writeFile(zipPath, makeZip('ettevotja_rekvisiidid__lihtandmed.csv', csv, method))
      const entry = await findZipEntry(zipPath)
      expect(entry).toMatchObject({ name: 'ettevotja_rekvisiidid__lihtandmed.csv', method, uncompressedSize: csv.length })
      const records = await readRecords(await openCsvStream(zipPath))
      expect(records).toHaveLength(15)
    }
  })

  it('unwraps RFC-4180 quoted fields', async () => {
    const file = path.join(tmp, 'quoted.csv')
    await writeFile(
      file,
      'nimi;ariregistri_kood;ettevotja_oiguslik_vorm;ettevotja_oigusliku_vormi_alaliik;kmkr_nr;ettevotja_staatus\n' +
        '"""Ankur"" OÜ";"12345678";"Osaühing";"";"";"R"\n',
    )
    const [rec] = await readRecords(await openCsvStream(file))
    expect(rec).toMatchObject({ code: '12345678', name: '"Ankur" OÜ', form: 'OÜ' })
  })
})

describe('index build', () => {
  it('writes meta, name shards and record shards', async () => {
    const out = path.join(tmp, 'index')
    const meta = await build({ input: FIXTURE, outDir: out })
    expect(meta).toMatchObject({ version: 1, count: 15, licence: 'CC BY 4.0', recordShardDigits: 5 })
    const stored = JSON.parse(await readFile(path.join(out, 'meta.json'), 'utf8'))
    expect(stored.count).toBe(15)
    expect(stored.shards.k).toBe(0)
    const k = JSON.parse(await readFile(path.join(out, 'n/k.json'), 'utf8'))
    // exact first-word match first, liquidation status kept as third field
    expect(k.t.kinnisvara[0]).toEqual([12999997, 'Kinnisvara OÜ'])
    expect(k.t.kinnisvara).toContainEqual([10000018, 'Kinnisvara Partnerid AS', 'L'])
    const r = JSON.parse(await readFile(path.join(out, 'r/12345.json'), 'utf8'))
    expect(r['12345678']).toEqual([
      'Põhjala Õlletehas OÜ', 'OÜ', 'EE101234567', 'R', 'Peetri tn 5', 'Kesklinna linnaosa, Tallinn, Harju maakond', '10111',
    ])
    // rebuilding replaces the previous index
    await build({ input: FIXTURE, outDir: out })
    expect((await readdir(path.join(out, 'r'))).length).toBe(stored.stats.recordShards)
  })

  it('splits large shards, truncates very common tokens and stores top lists', () => {
    const recs = Array.from({ length: 30 }, (_, i) => ({
      code: String(10000000 + i * 7),
      name: `Kask${i} Kinnisvara OÜ`,
      form: 'OÜ', vat: '', status: i % 5 ? 'R' : 'L', street: '', ehak: '', postal: '', ads: '',
    }))
    const { files, meta } = buildIndex(recs, { shardMax: 10, maxPostings: 8, starMax: 5 })
    expect(meta.shards.k).toBe(1)
    expect(meta.shards.ki).toBe(0)
    expect(meta.shards.kask1).toBe(1) // kask1, kask10..kask19
    const ki = JSON.parse(files.get('n/ki.json'))
    expect(ki.x).toContain('kinnisvara')
    expect(ki.t.kinnisvara).toHaveLength(8)
    const k = JSON.parse(files.get('n/k.json'))
    expect(k.s).toHaveLength(5)
    expect(k.t).toEqual({})
  })
})

describe('CLI', () => {
  const run = promisify(execFile)
  it('builds from --input and fails cleanly on bad input', async () => {
    const out = path.join(tmp, 'cli')
    const { stdout } = await run(process.execPath, [SCRIPT, '--input', FIXTURE, '--out', out])
    expect(stdout).toMatch(/Wrote 15 companies/)
    expect(existsSync(path.join(out, 'meta.json'))).toBe(true)
    await expect(run(process.execPath, [SCRIPT, '--input', path.join(tmp, 'nope.csv'), '--out', out, '--quiet'])).rejects.toMatchObject({ code: 1 })
    await expect(run(process.execPath, [SCRIPT, '--input', FIXTURE, '--out', out, '--min-count', '100', '--quiet'])).rejects.toMatchObject({ code: 1 })
  })
})
