import { describe, expect, it } from 'vitest'
import { FONT, FONT_FAMILIES, loadFontVfs } from './fonts'

describe('IBM Plex font VFS', () => {
  it('provides every file the font families reference, as base64 WOFF', async () => {
    const vfs = await loadFontVfs()
    const files = new Set(Object.values(FONT_FAMILIES).flatMap((f) => Object.values(f)))
    for (const file of files) {
      expect(vfs[file], file).toBeTruthy()
      // "wOFF" signature.
      expect(atob(vfs[file].slice(0, 8)).startsWith('wOFF'), file).toBe(true)
    }
  })

  it('defines the sans, strong and mono families plus a Roboto alias', () => {
    for (const name of [FONT.sans, FONT.strong, FONT.mono, 'Roboto']) {
      expect(Object.keys(FONT_FAMILIES[name])).toEqual(['normal', 'bold', 'italics', 'bolditalics'])
    }
    expect(FONT_FAMILIES[FONT.mono].normal).toBe('IBMPlexMono-Regular.woff')
  })
})
