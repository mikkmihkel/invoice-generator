// IBM Plex fonts for invoice PDFs (OFL-1.1). The WOFF files are inlined as base64 by Vite (`?inline`) in lazily
// imported chunks, so neither pdfmake nor the fonts are part of the main bundle. `?inline` works the same in the
// browser build and in Vitest/Node. The "complete" Plex files cover Latin Extended (õ ä ö ü š ž) and €.

import { woffToSfnt } from './woff'

export interface FontFamily {
  normal: string
  bold: string
  italics: string
  bolditalics: string
}

/** pdfmake font family names used by the templates. */
export const FONT = {
  /** Body text. `bold: true` → SemiBold. */
  sans: 'PlexSans',
  /** Headings and figures. Normal → Medium, `bold: true` → Bold. */
  strong: 'PlexSansStrong',
  /** Identifiers only: invoice number, registry code, VAT number, IBAN, reference number. */
  mono: 'PlexMono',
} as const

const FILES = {
  'IBMPlexSans-Regular.woff': () => import('@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-Regular.woff?inline'),
  'IBMPlexSans-Medium.woff': () => import('@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-Medium.woff?inline'),
  'IBMPlexSans-SemiBold.woff': () => import('@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-SemiBold.woff?inline'),
  'IBMPlexSans-Bold.woff': () => import('@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-Bold.woff?inline'),
  'IBMPlexMono-Regular.woff': () => import('@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Regular.woff?inline'),
} satisfies Record<string, () => Promise<{ default: string }>>

export const FONT_FAMILIES: Record<string, FontFamily> = {
  [FONT.sans]: {
    normal: 'IBMPlexSans-Regular.woff',
    bold: 'IBMPlexSans-SemiBold.woff',
    italics: 'IBMPlexSans-Regular.woff',
    bolditalics: 'IBMPlexSans-SemiBold.woff',
  },
  [FONT.strong]: {
    normal: 'IBMPlexSans-Medium.woff',
    bold: 'IBMPlexSans-Bold.woff',
    italics: 'IBMPlexSans-Medium.woff',
    bolditalics: 'IBMPlexSans-Bold.woff',
  },
  [FONT.mono]: {
    normal: 'IBMPlexMono-Regular.woff',
    bold: 'IBMPlexMono-Regular.woff',
    italics: 'IBMPlexMono-Regular.woff',
    bolditalics: 'IBMPlexMono-Regular.woff',
  },
}
// Anything that still asks for pdfmake's default font gets Plex Sans instead of failing.
FONT_FAMILIES.Roboto = FONT_FAMILIES[FONT.sans]

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** One font as base64 SFNT; the original WOFF when the conversion is unavailable (no DecompressionStream) or fails. */
async function loadFont(load: () => Promise<{ default: string }>): Promise<string> {
  const url = (await load()).default
  const comma = url.indexOf(',')
  const woff = comma >= 0 ? url.slice(comma + 1) : url
  if (typeof DecompressionStream !== 'function') return woff
  try {
    return bytesToBase64(await woffToSfnt(base64ToBytes(woff)))
  } catch (e) {
    console.warn('Font conversion failed, using WOFF', e)
    return woff
  }
}

let vfs: Promise<Record<string, string>> | null = null

/**
 * Base64 file contents keyed by VFS file name, ready for `pdfMake.addVirtualFileSystem`. The fonts are converted from
 * WOFF to plain SFNT once (the file names keep their `.woff` keys): fontkit would otherwise inflate the WOFF tables in
 * JavaScript on every render.
 */
export function loadFontVfs(): Promise<Record<string, string>> {
  vfs ??= Promise.all(Object.entries(FILES).map(async ([name, load]) => [name, await loadFont(load)] as const))
    .then((entries) => Object.fromEntries(entries))
    .catch((e) => {
      vfs = null
      throw e
    })
  return vfs
}
