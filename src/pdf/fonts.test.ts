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

  it('defines Plex Sans (Regular/SemiBold) and its Bold display weight plus a Roboto alias, and no monospaced family', async () => {
    for (const name of [FONT.sans, FONT.display, 'Roboto']) {
      expect(Object.keys(FONT_FAMILIES[name])).toEqual(['normal', 'bold', 'italics', 'bolditalics'])
    }
    expect(FONT_FAMILIES[FONT.sans]).toMatchObject({ normal: 'IBMPlexSans-Regular.woff', bold: 'IBMPlexSans-SemiBold.woff' })
    expect(FONT_FAMILIES[FONT.display].normal).toBe('IBMPlexSans-Bold.woff')
    const vfs = await loadFontVfs()
    expect(Object.keys(vfs).sort()).toEqual(['IBMPlexSans-Bold.woff', 'IBMPlexSans-Regular.woff', 'IBMPlexSans-SemiBold.woff'])
  })
})
