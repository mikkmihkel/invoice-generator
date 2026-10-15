// Pure colour helpers for the brand components.
import { contrastRatio, hexOr, isHexColor, MIN_TEXT_CONTRAST } from '../../../domain'

/** Calm, print-friendly preset colours (all readable as text on white). */
export const BRAND_PRESETS = ['#1f4e79', '#0b5d7a', '#1f6b4a', '#7a4a12', '#b3261e', '#6b2d8f', '#2b3036'] as const

/** Starting point for the secondary colour when nothing better is known. */
export const DEFAULT_SECONDARY = '#c2410c'

/** `#rrggbb` (lower case) from what a person typed: tolerates a missing `#` and spaces; null if not valid. */
export function parseHexInput(text: string): string | null {
  const t = text.trim().replace(/^#?/, '#')
  return isHexColor(t) ? t.toLowerCase() : null
}

/** True when `hex` is too light to be used as text on white (< 3:1). */
export function isLowContrast(hex: string | undefined): boolean {
  const c = hexOr(hex, undefined)
  return !!c && contrastRatio(c, '#ffffff') < MIN_TEXT_CONTRAST
}

function rgb(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** A second colour to start from: the logo colour most unlike the primary (if clearly different), else a warm default. */
export function suggestSecondary(primary: string, candidates: readonly string[]): string {
  const p = rgb(hexOr(primary, '#000000'))
  let best: string | undefined
  let bestDistance = 90
  for (const c of candidates) {
    const hex = hexOr(c, undefined)
    if (!hex) continue
    const d = Math.hypot(...rgb(hex).map((v, i) => v - p[i]))
    if (d > bestDistance) [best, bestDistance] = [hex, d]
  }
  return best ?? DEFAULT_SECONDARY
}
