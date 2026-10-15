// IBM Plex fonts for invoice PDFs (OFL-1.1). The WOFF files are inlined as base64 by Vite (`?inline`) in lazily
// imported chunks, so neither pdfmake nor the fonts are part of the main bundle. `?inline` works the same in the
// browser build and in Vitest/Node. The "complete" Plex files cover Latin Extended (õ ä ö ü š ž) and €.

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

/** Base64 file contents keyed by VFS file name, ready for `pdfMake.addVirtualFileSystem`. */
export async function loadFontVfs(): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([name, load]) => {
      const url = (await load()).default
      const comma = url.indexOf(',')
      return [name, comma >= 0 ? url.slice(comma + 1) : url] as const
    }),
  )
  return Object.fromEntries(entries)
}
