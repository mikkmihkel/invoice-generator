import { useCallback } from 'react'

/**
 * Callback ref for the editor summary. While CSS pins it to the bottom of the screen (`position: fixed`, under 1280 px),
 * its real height is published as `--ed-bar-live` on <html>, so the page padding and the docked preview leave room for
 * it, also when its check list is expanded. Without ResizeObserver the CSS falls back to a fixed estimate.
 */
export function useFixedBarHeight(): (el: HTMLElement | null) => (() => void) | undefined {
  return useCallback((el: HTMLElement | null) => {
    if (!el || typeof ResizeObserver !== 'function') return undefined
    const root = document.documentElement
    let last = ''
    const update = () => {
      const next = getComputedStyle(el).position === 'fixed' ? `${Math.ceil(el.getBoundingClientRect().height)}px` : ''
      if (next === last) return
      last = next
      if (next) root.style.setProperty('--ed-bar-live', next)
      else root.style.removeProperty('--ed-bar-live')
    }
    const observer = new ResizeObserver(update)
    observer.observe(el)
    // Crossing a breakpoint can switch the bar between pinned and in-flow without resizing it.
    window.addEventListener('resize', update)
    update()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      root.style.removeProperty('--ed-bar-live')
    }
  }, [])
}
