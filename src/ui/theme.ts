import type { UiTheme } from '../domain/types'

/** Last applied theme, mirrored in localStorage so it can be set before React renders (no light flash). */
const THEME_KEY = 'invoice-generator:theme'
const THEMES: readonly UiTheme[] = ['auto', 'light', 'dark']
const THEME_COLOR = { light: '#fbfbfc', dark: '#15181b' } as const

export function normalizeTheme(value: unknown): UiTheme {
  return THEMES.includes(value as UiTheme) ? (value as UiTheme) : 'auto'
}

export function readStoredTheme(): UiTheme {
  try {
    return normalizeTheme(localStorage.getItem(THEME_KEY))
  } catch {
    return 'auto'
  }
}

/**
 * Apply the theme: 'auto' leaves the choice to prefers-color-scheme; 'light'/'dark' set data-theme on <html>,
 * which the tokens in src/ui/styles/tokens.css honour. Browser chrome (color-scheme, theme-color) follows along.
 */
export function applyTheme(theme: UiTheme, doc: Document = document): void {
  const root = doc.documentElement
  if (theme === 'auto') delete root.dataset.theme
  else root.dataset.theme = theme

  doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme === 'auto' ? 'light dark' : theme)
  doc.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const scheme = meta.getAttribute('media')?.includes('dark') ? 'dark' : 'light'
    meta.setAttribute('content', THEME_COLOR[theme === 'auto' ? scheme : theme])
  })
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* private mode: the theme still applies for this visit */
  }
}
