// Dominant brand colours of a logo: a pixel histogram over non-neutral colours, refined with a few k-means passes.
// Pure (works on raw RGBA pixels) so it is unit-testable; `logoColors` (logoColors.ts) feeds it from a canvas.

export interface PaletteOptions {
  /** Maximum number of colours to return (default 5). */
  max?: number
  /** Pixels whose channel spread (max - min) is below this are treated as neutral (white, grey, black). Default 40. */
  minChroma?: number
  /** Ignore colours covering less than this share of the colourful pixels (default 0.03). */
  minShare?: number
  /** Colours closer than this (RGB distance) are merged (default 56). */
  mergeDistance?: number
}

interface Cluster {
  r: number
  g: number
  b: number
  n: number
}

const dist2 = (a: Cluster, b: Cluster) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2

const WHITE: Cluster = { r: 255, g: 255, b: 255, n: 0 }
const BLACK: Cluster = { r: 0, g: 0, b: 0, n: 0 }

/** Distance from `c` to the segment between `a` and `b` (in the middle 80%, where real blends lie). */
function blendDistance2(c: Cluster, a: Cluster, b: Cluster): number {
  const d = { r: b.r - a.r, g: b.g - a.g, b: b.b - a.b }
  const len2 = d.r ** 2 + d.g ** 2 + d.b ** 2
  if (!len2) return dist2(c, a)
  const t = ((c.r - a.r) * d.r + (c.g - a.g) * d.g + (c.b - a.b) * d.b) / len2
  if (t < 0.1 || t > 0.9) return Infinity
  return dist2(c, { r: a.r + d.r * t, g: a.g + d.g * t, b: a.b + d.b * t, n: 0 })
}

/** True when `c` looks like a mix of two more frequent colours (or of one and white/black). */
function isBlend(c: Cluster, bigger: Cluster[]): boolean {
  const refs = [...bigger, WHITE, BLACK]
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      if (i >= bigger.length && j >= bigger.length) continue
      if (blendDistance2(c, refs[i], refs[j]) < 18 ** 2) return true
    }
  }
  return false
}

const toHex = (c: Cluster) => `#${[c.r, c.g, c.b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`

/**
 * Up to `max` dominant, clearly coloured `#rrggbb` colours in `pixels` (RGBA, e.g. `ImageData.data`), most frequent
 * first. Transparent and neutral pixels (backgrounds, black text, grey anti-aliasing) are skipped.
 */
export function extractPalette(pixels: ArrayLike<number>, opts: PaletteOptions = {}): string[] {
  const max = opts.max ?? 5
  const minChroma = opts.minChroma ?? 40
  const minShare = opts.minShare ?? 0.03
  const mergeDistance2 = (opts.mergeDistance ?? 56) ** 2
  const count = Math.floor(pixels.length / 4)
  // Sample at most ~40k pixels.
  const step = Math.max(1, Math.floor(count / 40_000))

  // 1. Histogram over 4-bit-per-channel buckets, keeping each bucket's mean colour.
  const buckets = new Map<number, Cluster>()
  let total = 0
  for (let i = 0; i < count; i += step) {
    const o = i * 4
    const r = pixels[o]
    const g = pixels[o + 1]
    const b = pixels[o + 2]
    const a = pixels[o + 3]
    if (a < 128) continue
    if (Math.max(r, g, b) - Math.min(r, g, b) < minChroma) continue
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const c = buckets.get(key)
    if (c) {
      c.r += r
      c.g += g
      c.b += b
      c.n++
    } else buckets.set(key, { r, g, b, n: 1 })
    total++
  }
  if (!total) return []
  const points = [...buckets.values()].map((c) => ({ r: c.r / c.n, g: c.g / c.n, b: c.b / c.n, n: c.n })).sort((a, b) => b.n - a.n)

  // 2. Seed clusters greedily from the most frequent buckets, skipping near-duplicates.
  let centers: Cluster[] = []
  for (const p of points) {
    if (centers.length >= max * 2) break
    if (centers.every((c) => dist2(c, p) > mergeDistance2)) centers.push({ ...p })
  }

  // 3. A few weighted k-means passes over the buckets.
  for (let pass = 0; pass < 4; pass++) {
    const acc = centers.map(() => ({ r: 0, g: 0, b: 0, n: 0 }))
    for (const p of points) {
      let best = 0
      for (let k = 1; k < centers.length; k++) if (dist2(centers[k], p) < dist2(centers[best], p)) best = k
      const a = acc[best]
      a.r += p.r * p.n
      a.g += p.g * p.n
      a.b += p.b * p.n
      a.n += p.n
    }
    centers = acc.filter((a) => a.n > 0).map((a) => ({ r: a.r / a.n, g: a.g / a.n, b: a.b / a.n, n: a.n }))
  }

  // 4. Merge clusters that converged onto each other, drop blends of bigger ones (anti-aliased edges between two
  //    colours, or a colour and the white/black background), drop rare ones; most frequent first.
  centers.sort((a, b) => b.n - a.n)
  const out: Cluster[] = []
  for (const c of centers) {
    const twin = out.find((o) => dist2(o, c) <= mergeDistance2)
    if (twin) twin.n += c.n
    else if (!isBlend(c, out)) out.push({ ...c })
  }
  return out
    .filter((c) => c.n / total >= minShare)
    .slice(0, max)
    .map(toHex)
}
