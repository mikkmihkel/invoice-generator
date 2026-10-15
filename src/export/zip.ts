// Minimal ZIP writer (stored entries, no compression). PDFs are already compressed, so deflate would gain little.
// Limits: no ZIP64, so each file and the archive must stay under 4 GiB and 65 535 entries.

export interface ZipEntry {
  /** Path inside the archive, `/`-separated, e.g. "pdf/Arve_2026-0001.pdf". */
  name: string
  data: Uint8Array | string
  /** Modification time; defaults to now. */
  date?: Date
}

let crcTable: Uint32Array | null = null

function table(): Uint32Array {
  if (crcTable) return crcTable
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  crcTable = t
  return t
}

/** CRC-32 (IEEE 802.3), as used by ZIP and PNG. */
export function crc32(data: Uint8Array, seed = 0): number {
  const t = table()
  let c = (seed ^ 0xffffffff) >>> 0
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS date and time fields (local time, 2-second resolution, years 1980–2107). */
export function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()))
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  }
}

const UTF8_FLAG = 0x0800
const MAX = 0xffffffff

/** Build a ZIP archive from the entries. Names are stored as UTF-8. */
export function createZip(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
  if (entries.length > 0xffff) throw new Error('Too many files for a ZIP archive')
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = enc.encode(entry.name.replace(/\\/g, '/').replace(/^\/+/, ''))
    const data = typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data
    if (data.length >= MAX || offset >= MAX) throw new Error('ZIP archive too large')
    const crc = crc32(data)
    const { date, time } = dosDateTime(entry.date ?? new Date())

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed: 2.0
    lv.setUint16(6, UTF8_FLAG, true)
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true)
    cv.setUint16(8, UTF8_FLAG, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    // extra length, comment length, disk number, internal and external attributes stay 0
    cv.setUint32(42, offset, true)
    central.set(name, 46)

    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  if (offset + centralSize >= MAX) throw new Error('ZIP archive too large')
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + centralSize + end.length)
  let pos = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, pos)
    pos += part.length
  }
  return out
}
