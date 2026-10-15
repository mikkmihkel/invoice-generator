import { crc32 as nodeCrc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createZip, crc32, dosDateTime } from './zip'

interface ReadEntry {
  name: string
  data: Uint8Array
  crc: number
  flags: number
}

/** Reads a stored-only ZIP through its central directory and checks the local headers agree. */
function readZip(zip: Uint8Array): ReadEntry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const eocd = zip.length - 22
  expect(v.getUint32(eocd, true)).toBe(0x06054b50)
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out: ReadEntry[] = []
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50)
    const flags = v.getUint16(p + 8, true)
    const method = v.getUint16(p + 10, true)
    const crc = v.getUint32(p + 16, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const offset = v.getUint32(p + 42, true)
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen))
    expect(method).toBe(0)
    expect(v.getUint32(offset, true)).toBe(0x04034b50)
    expect(v.getUint32(offset + 14, true)).toBe(crc)
    const localNameLen = v.getUint16(offset + 26, true)
    const start = offset + 30 + localNameLen + v.getUint16(offset + 28, true)
    out.push({ name, data: zip.subarray(start, start + size), crc, flags })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

describe('crc32', () => {
  it('matches the standard check value and Node', () => {
    const enc = new TextEncoder()
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
    const sample = enc.encode('Õunapuu & Šokolaad OÜ — 1 234,50 €')
    expect(crc32(sample)).toBe(nodeCrc32(sample))
  })
})

describe('dosDateTime', () => {
  it('packs local date and time with 2-second resolution', () => {
    const { date, time } = dosDateTime(new Date(2026, 9, 15, 13, 45, 31))
    expect(date).toBe(((2026 - 1980) << 9) | (10 << 5) | 15)
    expect(time).toBe((13 << 11) | (45 << 5) | 15)
  })
})

describe('createZip', () => {
  it('stores files with UTF-8 names and correct checksums', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 255])
    const zip = createZip([
      { name: 'arved.csv', data: '﻿Number;Summa\r\n2026-0001;12,50\r\n' },
      { name: 'PDF/Arve_2026-0001_Õun-OÜ.pdf', data: pdf },
      { name: '/XML\\tühi.xml', data: '' },
    ])
    const entries = readZip(zip)
    expect(entries.map((e) => e.name)).toEqual(['arved.csv', 'PDF/Arve_2026-0001_Õun-OÜ.pdf', 'XML/tühi.xml'])
    expect(entries.every((e) => e.flags & 0x0800)).toBe(true)
    expect([...entries[1].data]).toEqual([...pdf])
    expect(new TextDecoder().decode(entries[0].data)).toContain('2026-0001;12,50')
    for (const e of entries) expect(e.crc).toBe(nodeCrc32(e.data))
  })

  it('writes a valid empty archive', () => {
    const zip = createZip([])
    expect(zip.length).toBe(22)
    expect(readZip(zip)).toEqual([])
  })
})
