import { describe, expect, it } from 'vitest'
import { colorModeOf, contrastRatio, hexOr, isColorMode, isHexColor, relativeLuminance } from './brand'

describe('brand colours', () => {
  it('accepts only #rrggbb', () => {
    expect(isHexColor('#1f6FEB')).toBe(true)
    for (const bad of ['#fff', '1f6feb', '#1f6feb0', 'red', 'url(x)', '#1f6feb;color:red', undefined, 12]) expect(isHexColor(bad)).toBe(false)
  })

  it('normalises hex or falls back', () => {
    expect(hexOr('#AA3300', '#000000')).toBe('#aa3300')
    expect(hexOr('expression(alert(1))', '#000000')).toBe('#000000')
    expect(hexOr(undefined, undefined)).toBeUndefined()
  })

  it('defaults the colour mode to accent', () => {
    expect(isColorMode('duo')).toBe(true)
    expect(isColorMode('neon')).toBe(false)
    expect(colorModeOf(undefined)).toBe('accent')
    expect(colorModeOf('mono')).toBe('mono')
    expect(colorModeOf('x')).toBe('accent')
  })

  it('computes WCAG contrast', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1)
    expect(relativeLuminance('#000000')).toBe(0)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21)
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.5)
    expect(contrastRatio('#f5c542', '#ffffff')).toBeLessThan(3)
  })
})
