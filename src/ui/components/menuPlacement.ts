/** Below this width menus open as a bottom sheet, like dialogs. */
export const MENU_SHEET_QUERY = '(max-width: 599px)'
export const VIEWPORT_GAP = 8

/**
 * Horizontal offset (relative to the trigger's wrapper) that keeps a popup of `width` inside the viewport:
 * the preferred edge first, the other edge when that overflows, clamped to the viewport as a last resort.
 */
export function menuOffset(wrap: { left: number; right: number }, width: number, viewport: number, align: 'start' | 'end'): number {
  const min = VIEWPORT_GAP
  const max = viewport - VIEWPORT_GAP - width
  const start = wrap.left
  const end = wrap.right - width
  const fits = (x: number) => x >= min && x <= max
  const preferred = align === 'start' ? start : end
  const other = align === 'start' ? end : start
  const x = fits(preferred) ? preferred : fits(other) ? other : Math.max(min, Math.min(preferred, max))
  return x - wrap.left
}

/** Bars that stay on screen while the page scrolls: the top bar, the phone tab bar and the editor's summary bar. */
const PINNED_BARS = '.topbar, .main-nav, .ed-side'

/** Smallest list height worth opening below a field; with less room it opens above when there is more room there. */
export const MIN_POPUP_HEIGHT = 160

export interface VisibleArea {
  top: number
  bottom: number
}

/**
 * Part of the viewport not covered by pinned bars (and, on phones, not behind the on-screen keyboard). Bars in the
 * upper half of the screen limit the top, the others the bottom.
 */
export function visibleArea(): VisibleArea {
  const vv = window.visualViewport
  const height = vv ? Math.min(window.innerHeight, vv.offsetTop + vv.height) : window.innerHeight
  const area = { top: 0, bottom: height }
  for (const el of document.querySelectorAll<HTMLElement>(PINNED_BARS)) {
    const position = getComputedStyle(el).position
    if (position !== 'fixed' && position !== 'sticky') continue
    const r = el.getBoundingClientRect()
    if (r.height <= 0 || r.bottom <= 0 || r.top >= height) continue
    if (r.top + r.height / 2 < height / 2) area.top = Math.max(area.top, r.bottom)
    else area.bottom = Math.min(area.bottom, r.top)
  }
  return area
}

/**
 * Where a list of natural height `wanted` opens next to `field`: below when enough of it fits above the bottom
 * bars, otherwise above if there is more room there. `maxHeight` keeps it inside the visible area.
 */
export function verticalPlacement(field: { top: number; bottom: number }, area: VisibleArea, wanted: number): { above: boolean; maxHeight: number } {
  const below = Math.floor(area.bottom - field.bottom - VIEWPORT_GAP)
  const above = Math.floor(field.top - area.top - VIEWPORT_GAP)
  const useAbove = below < Math.min(wanted, MIN_POPUP_HEIGHT) && above > below
  return { above: useAbove, maxHeight: Math.max(0, useAbove ? above : below) }
}
