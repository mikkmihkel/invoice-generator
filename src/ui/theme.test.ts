import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme, normalizeTheme, readStoredTheme } from './theme'

afterEach(() => {
  delete document.documentElement.dataset.theme
  document.head.querySelectorAll('meta[name="color-scheme"], meta[name="theme-color"]').forEach((m) => m.remove())
  localStorage.clear()
})

function addMeta(name: string, content: string, media?: string) {
  const m = document.createElement('meta')
  m.name = name
  m.content = content
  if (media) m.setAttribute('media', media)
  document.head.append(m)
  return m
}

describe('theme', () => {
  it('forces light or dark with data-theme and follows the system on auto', () => {
    const scheme = addMeta('color-scheme', 'light dark')
    const lightBar = addMeta('theme-color', '#fbfbfc', '(prefers-color-scheme: light)')
    const darkBar = addMeta('theme-color', '#15181b', '(prefers-color-scheme: dark)')

    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(scheme.content).toBe('dark')
    expect(lightBar.content).toBe('#15181b')

    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(darkBar.content).toBe('#fbfbfc')

    applyTheme('auto')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(scheme.content).toBe('light dark')
    expect(lightBar.content).toBe('#fbfbfc')
    expect(darkBar.content).toBe('#15181b')
  })

  it('remembers the last theme for the next start and ignores unknown values', () => {
    expect(readStoredTheme()).toBe('auto')
    applyTheme('dark')
    expect(readStoredTheme()).toBe('dark')
    localStorage.setItem('invoice-generator:theme', 'neon')
    expect(readStoredTheme()).toBe('auto')
    expect(normalizeTheme(undefined)).toBe('auto')
  })
})
