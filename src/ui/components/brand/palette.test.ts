import { describe, expect, it } from 'vitest'
import { extractPalette } from './palette'

type RGBA = [number, number, number, number]

/** A flat RGBA buffer with `n` pixels of each colour. */
function image(parts: [RGBA, number][]): Uint8ClampedArray {
  const total = parts.reduce((s, [, n]) => s + n, 0)
  const data = new Uint8ClampedArray(total * 4)
  let o = 0
  for (const [c, n] of parts) for (let i = 0; i < n; i++, o += 4) data.set(c, o)
  return data
}

const near = (hex: string, [r, g, b]: number[], tol = 12) => {
  const n = parseInt(hex.slice(1), 16)
  return Math.abs(((n >> 16) & 255) - r) <= tol && Math.abs(((n >> 8) & 255) - g) <= tol && Math.abs((n & 255) - b) <= tol
}

describe('extractPalette', () => {
  it('returns the dominant non-neutral colours, most frequent first', () => {
    const data = image([
      [[255, 255, 255, 255], 5000], // white background
      [[20, 22, 26, 255], 1500], // black text
      [[128, 128, 128, 255], 400], // grey anti-aliasing
      [[11, 93, 122, 255], 2400], // teal
      [[224, 122, 16, 255], 900], // orange
      [[16, 125, 230, 255], 30], // a few stray pixels (under the min share)
    ])
    const colors = extractPalette(data)
    expect(colors).toHaveLength(2)
    expect(near(colors[0], [11, 93, 122])).toBe(true)
    expect(near(colors[1], [224, 122, 16])).toBe(true)
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('merges shades of the same colour (gradients, anti-aliasing) into one swatch', () => {
    const shades: [RGBA, number][] = Array.from({ length: 10 }, (_, i) => [[200 + i * 3, 40 + i * 2, 40, 255], 100])
    const colors = extractPalette(image([...shades, [[30, 90, 200, 255], 600]]))
    expect(colors).toHaveLength(2)
    expect(near(colors[0], [213, 49, 40], 20)).toBe(true)
  })

  it('drops anti-aliased blends of two logo colours or of a colour and the background', () => {
    const teal: RGBA = [11, 93, 122, 255]
    const orange: RGBA = [224, 122, 16, 255]
    const mix = (a: RGBA, b: RGBA, t: number): RGBA => [0, 1, 2].map((i) => Math.round(a[i] * t + b[i] * (1 - t))).concat(255) as RGBA
    const colors = extractPalette(
      image([
        [teal, 3000],
        [orange, 1500],
        [mix(orange, teal, 0.6), 300],
        [mix(orange, [255, 255, 255, 255], 0.5), 300],
      ]),
    )
    expect(colors).toHaveLength(2)
  })

  it('ignores transparent pixels and returns nothing for neutral logos', () => {
    expect(extractPalette(image([[[224, 122, 16, 0], 1000], [[0, 0, 0, 255], 500], [[255, 255, 255, 255], 500]]))).toEqual([])
    expect(extractPalette(new Uint8ClampedArray())).toEqual([])
  })

  it('caps the number of colours', () => {
    const many: [RGBA, number][] = [
      [[230, 30, 30, 255], 100],
      [[30, 160, 40, 255], 100],
      [[30, 60, 220, 255], 100],
      [[240, 200, 20, 255], 100],
      [[150, 40, 200, 255], 100],
      [[20, 190, 200, 255], 100],
      [[240, 120, 20, 255], 100],
    ]
    expect(extractPalette(image(many))).toHaveLength(5)
    expect(extractPalette(image(many), { max: 3 })).toHaveLength(3)
  })
})
