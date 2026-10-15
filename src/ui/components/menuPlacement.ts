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
