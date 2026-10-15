import { describe, expect, it } from 'vitest'
import { isWoff, woffToSfnt } from './woff'

const FONTS = {
  'IBMPlexSans-Regular': () => import('@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-Regular.woff?inline'),
  'IBMPlexSans-Bold': () => import('@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-Bold.woff?inline'),
  'IBMPlexMono-Regular': () => import('@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Regular.woff?inline'),
}

async function woffBytes(load: () => Promise<{ default: string }>): Promise<Uint8Array> {
  const url = (await load()).default
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0))
}

/** OpenType table checksum: sum of big-endian uint32 words, zero padded. */
function checksum(bytes: Uint8Array): number {
  const padded = new Uint8Array((bytes.length + 3) & ~3)
  padded.set(bytes)
  const view = new DataView(padded.buffer)
  let sum = 0
  for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0
  return sum
}

describe('woffToSfnt', () => {
  it.each(Object.entries(FONTS))('rebuilds %s as an SFNT whose tables match the WOFF checksums', async (_, load) => {
    const woff = await woffBytes(load)
    const sfnt = await woffToSfnt(woff)
    const wv = new DataView(woff.buffer, woff.byteOffset, woff.byteLength)
    const sv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength)
    const numTables = wv.getUint16(12)

    expect(isWoff(sfnt)).toBe(false)
    expect(sv.getUint32(0)).toBe(wv.getUint32(4))
    expect(sv.getUint16(4)).toBe(numTables)
    const pow2 = 2 ** Math.floor(Math.log2(numTables))
    expect([sv.getUint16(6), sv.getUint16(8), sv.getUint16(10)]).toEqual([pow2 * 16, Math.log2(pow2), numTables * 16 - pow2 * 16])
    // totalSfntSize in the WOFF header is the size of the original font, padding included.
    expect(sfnt.length).toBe(wv.getUint32(16))

    const tags: string[] = []
    for (let i = 0; i < numTables; i++) {
      const at = 12 + i * 16
      const tag = String.fromCharCode(...sfnt.subarray(at, at + 4))
      tags.push(tag)
      const offset = sv.getUint32(at + 8)
      const table = sfnt.slice(offset, offset + sv.getUint32(at + 12))
      expect(offset % 4, tag).toBe(0)
      // head's checksum is computed with checkSumAdjustment zeroed.
      if (tag === 'head') table.fill(0, 8, 12)
      expect(checksum(table), tag).toBe(sv.getUint32(at + 4))
    }
    expect(tags).toEqual([...tags].sort())
    expect(tags).toEqual(expect.arrayContaining(['cmap', 'glyf', 'head', 'hmtx', 'loca']))
  })

  it('rejects data that is not WOFF 1.0', async () => {
    await expect(woffToSfnt(new Uint8Array(64))).rejects.toThrow(/WOFF/)
    const woff = await woffBytes(FONTS['IBMPlexMono-Regular'])
    await expect(woffToSfnt(woff.subarray(0, 200))).rejects.toThrow(/WOFF/)
  })
})
