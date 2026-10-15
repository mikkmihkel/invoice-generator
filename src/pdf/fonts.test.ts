import { afterEach, describe, expect, it, vi } from 'vitest'
import { FONT, FONT_FAMILIES, loadFontVfs } from './fonts'

const signature = (b64: string) => atob(b64.slice(0, 8)).slice(0, 4)

describe('IBM Plex font VFS', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('provides every file the font families reference, converted from WOFF to TrueType once', async () => {
    const vfs = await loadFontVfs()
    const files = new Set(Object.values(FONT_FAMILIES).flatMap((f) => Object.values(f)))
    for (const file of files) {
      expect(vfs[file], file).toBeTruthy()
      // SFNT version 1.0 (TrueType outlines), no longer "wOFF".
      expect(signature(vfs[file]), file).toBe('\0\x01\0\0')
    }
    // Cached: every render reuses the converted bytes.
    expect(await loadFontVfs()).toBe(vfs)
  })

  it('falls back to the WOFF files when DecompressionStream is unavailable', async () => {
    vi.stubGlobal('DecompressionStream', undefined)
    const fresh = await import('./fonts')
    const vfs = await fresh.loadFontVfs()
    expect(signature(vfs['IBMPlexSans-Regular.woff'])).toBe('wOFF')
  })

  it('defines the sans, strong and mono families plus a Roboto alias', () => {
    for (const name of [FONT.sans, FONT.strong, FONT.mono, 'Roboto']) {
      expect(Object.keys(FONT_FAMILIES[name])).toEqual(['normal', 'bold', 'italics', 'bolditalics'])
    }
    expect(FONT_FAMILIES[FONT.mono].normal).toBe('IBMPlexMono-Regular.woff')
  })
})
