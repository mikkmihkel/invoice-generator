// Brand colours of the invoice document: validation and contrast helpers shared by UI, storage and PDF.
import type { ColorMode } from './types'

export const COLOR_MODES: readonly ColorMode[] = ['mono', 'accent', 'duo']

/** Plain `#rrggbb` only: anything else (e.g. `url(...)`) must never reach a CSS or PDF colour sink. */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
}

/** `value` lower-cased when it is a valid `#rrggbb`, otherwise `fallback`. */
export function hexOr<T extends string | undefined>(value: unknown, fallback: T): string | T {
  return isHexColor(value) ? value.toLowerCase() : fallback
}

export function isColorMode(value: unknown): value is ColorMode {
  return typeof value === 'string' && (COLOR_MODES as readonly string[]).includes(value)
}

/** Colour mode with the default applied ('accent' when absent or unknown). */
export function colorModeOf(value: unknown): ColorMode {
  return isColorMode(value) ? value : 'accent'
}

function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of a `#rrggbb` colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** WCAG contrast ratio between two `#rrggbb` colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Minimum contrast for a colour used as large/bold text or rules on white (WCAG non-text / large text). */
export const MIN_TEXT_CONTRAST = 3
