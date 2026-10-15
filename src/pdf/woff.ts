// WOFF 1.0 → SFNT (TrueType/OpenType) conversion. pdfmake's fontkit reads WOFF itself but inflates every table with a
// pure-JS inflate on each render (most of a render's main-thread time); converting once with the browser's native
// DecompressionStream lets every render read plain tables.

const WOFF_SIGNATURE = 0x774f4646 // 'wOFF'
const WOFF_HEADER = 44
const WOFF_ENTRY = 20
const SFNT_HEADER = 12
const SFNT_ENTRY = 16

/** Whether the bytes start with the WOFF 1.0 signature. */
export function isWoff(bytes: Uint8Array): boolean {
  return bytes.length >= WOFF_HEADER && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) === WOFF_SIGNATURE
}

/** zlib-inflate `data` into exactly `size` bytes with the platform's DecompressionStream. */
async function inflate(data: Uint8Array, size: number): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate')
  const writer = stream.writable.getWriter()
  // Errors surface through the reader as well; this only keeps them from being reported as unhandled.
  writer.write(data.slice()).then(() => writer.close()).catch(() => undefined)
  const reader = stream.readable.getReader()
  const out = new Uint8Array(size)
  let pos = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (pos + value.length > size) throw new Error('WOFF table larger than declared')
    out.set(value, pos)
    pos += value.length
  }
  if (pos !== size) throw new Error('WOFF table smaller than declared')
  return out
}

/**
 * Rebuild the SFNT font stored in a WOFF 1.0 file: offset table, table records (checksums from the WOFF directory)
 * and the tables, each padded to 4 bytes. Throws on malformed input or when DecompressionStream is unavailable.
 */
export async function woffToSfnt(woff: Uint8Array): Promise<Uint8Array> {
  if (!isWoff(woff)) throw new Error('Not a WOFF 1.0 file')
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength)
  const flavor = view.getUint32(4)
  const numTables = view.getUint16(12)
  if (numTables === 0 || WOFF_HEADER + numTables * WOFF_ENTRY > woff.length) throw new Error('Bad WOFF table directory')

  const entries = Array.from({ length: numTables }, (_, i) => {
    const at = WOFF_HEADER + i * WOFF_ENTRY
    const entry = {
      tag: view.getUint32(at),
      offset: view.getUint32(at + 4),
      compLength: view.getUint32(at + 8),
      origLength: view.getUint32(at + 12),
      checksum: view.getUint32(at + 16),
    }
    if (entry.offset + entry.compLength > woff.length || entry.compLength > entry.origLength) throw new Error('Bad WOFF table entry')
    return entry
  })
  // SFNT table records must be sorted by tag (WOFF requires the same order, but be lenient).
  entries.sort((a, b) => a.tag - b.tag)
  if (entries.some((e) => e.compLength < e.origLength) && typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream is unavailable')
  }
  const tables = await Promise.all(
    entries.map((e) => {
      const raw = woff.subarray(e.offset, e.offset + e.compLength)
      return e.compLength < e.origLength ? inflate(raw, e.origLength) : Promise.resolve(raw)
    }),
  )

  const pad4 = (n: number) => (n + 3) & ~3
  const size = tables.reduce((sum, t) => sum + pad4(t.length), SFNT_HEADER + numTables * SFNT_ENTRY)
  const out = new Uint8Array(size)
  const sfnt = new DataView(out.buffer)
  let pow2 = 1
  let log2 = 0
  while (pow2 * 2 <= numTables) {
    pow2 *= 2
    log2++
  }
  sfnt.setUint32(0, flavor)
  sfnt.setUint16(4, numTables)
  sfnt.setUint16(6, pow2 * 16)
  sfnt.setUint16(8, log2)
  sfnt.setUint16(10, numTables * 16 - pow2 * 16)

  let offset = SFNT_HEADER + numTables * SFNT_ENTRY
  entries.forEach((e, i) => {
    const at = SFNT_HEADER + i * SFNT_ENTRY
    sfnt.setUint32(at, e.tag)
    sfnt.setUint32(at + 4, e.checksum)
    sfnt.setUint32(at + 8, offset)
    sfnt.setUint32(at + 12, e.origLength)
    out.set(tables[i], offset)
    offset += pad4(e.origLength)
  })
  return out
}
