import { describe, expect, it } from 'vitest'
import { menuOffset, verticalPlacement } from './menuPlacement'

describe('menuOffset', () => {
  // "Rohkem" button at x 160–240 on a 390 px phone, 232 px menu.
  const wrap = { left: 160, right: 240 }

  it('keeps the preferred edge when the menu fits', () => {
    expect(menuOffset({ left: 20, right: 100 }, 232, 1280, 'start')).toBe(0)
    expect(menuOffset({ left: 900, right: 980 }, 232, 1280, 'end')).toBe(80 - 232)
  })

  it('flips a start-aligned menu to end-aligned when it would overflow the right edge', () => {
    const x = menuOffset(wrap, 232, 390, 'start')
    expect(x).toBe(80 - 232)
    expect(wrap.left + x + 232).toBeLessThanOrEqual(390 - 8)
  })

  it('clamps into the viewport when neither edge fits', () => {
    const x = menuOffset({ left: 100, right: 180 }, 232, 360, 'start')
    const left = 100 + x
    expect(left).toBeGreaterThanOrEqual(8)
    expect(left + 232).toBeLessThanOrEqual(360 - 8)
  })
})

describe('verticalPlacement', () => {
  // 390×844 phone: top bar until 56, editor summary bar from 661.
  const area = { top: 56, bottom: 661 }

  it('opens below when the list fits above the bottom bar', () => {
    expect(verticalPlacement({ top: 200, bottom: 240 }, area, 300)).toEqual({ above: false, maxHeight: 413 })
  })

  it('opens above a field just over the bottom bar, kept under the top bar', () => {
    expect(verticalPlacement({ top: 580, bottom: 620 }, area, 300)).toEqual({ above: true, maxHeight: 516 })
  })

  it('stays below a short list that fits, and below when there is even less room above', () => {
    expect(verticalPlacement({ top: 560, bottom: 600 }, area, 50)).toEqual({ above: false, maxHeight: 53 })
    expect(verticalPlacement({ top: 60, bottom: 600 }, area, 300)).toEqual({ above: false, maxHeight: 53 })
  })
})
