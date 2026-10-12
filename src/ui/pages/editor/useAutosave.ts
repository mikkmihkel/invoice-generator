import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface AutosaveOptions<T> {
  save: (value: T) => Promise<void>
  /** Called after each successful save (e.g. to switch the URL after the first one). */
  onSaved?: (value: T) => void
  /** `first` = the previous save attempt succeeded (report once, not on every retry). */
  onError?: (error: unknown, first: boolean) => void
  delay?: number
}

export interface Autosave<T> {
  state: SaveState
  error: unknown
  /** The value changed: save it after `delay`. */
  markDirty(): void
  /**
   * Save pending changes now (pass `value` to save that instead of the last rendered one). Saves are
   * serialized — one in flight, then the latest value. Resolves false if the save failed; the changes stay dirty.
   */
  flush(value?: T): Promise<boolean>
  /** Drop pending changes and stop saving; resolves once an in-flight save has finished. */
  discard(): Promise<void>
  /** Forget pending changes after the value was replaced from storage (e.g. after issuing). */
  reset(): void
}

/** Debounced, serialized autosave with visible state; flushes when the page is hidden or the component unmounts. */
export function useAutosave<T>(value: T | null, { save, onSaved, onError, delay = 700 }: AutosaveOptions<T>): Autosave<T> {
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<unknown>(null)
  const valueRef = useRef(value)
  const dirtyRef = useRef(false)
  const disabledRef = useRef(false)
  const failedRef = useRef(false)
  const mountedRef = useRef(true)
  const chainRef = useRef<Promise<boolean>>(Promise.resolve(true))
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const callbacks = useRef({ save, onSaved, onError })

  useLayoutEffect(() => {
    valueRef.current = value
    callbacks.current = { save, onSaved, onError }
  })

  const update = useCallback((s: SaveState) => {
    if (mountedRef.current) setState(s)
  }, [])

  const saveNow = useCallback(async (): Promise<boolean> => {
    clearTimeout(timerRef.current)
    const v = valueRef.current
    if (disabledRef.current || !dirtyRef.current) return true
    if (v == null) return false
    dirtyRef.current = false
    update('saving')
    try {
      await callbacks.current.save(v)
      failedRef.current = false
      if (mountedRef.current) setError(null)
      callbacks.current.onSaved?.(v)
      update(dirtyRef.current ? 'pending' : 'saved')
      return true
    } catch (e) {
      dirtyRef.current = true
      const first = !failedRef.current
      failedRef.current = true
      if (mountedRef.current) setError(e)
      update('error')
      callbacks.current.onError?.(e, first)
      return false
    }
  }, [update])

  const flush = useCallback(
    (next?: T): Promise<boolean> => {
      if (next !== undefined) {
        valueRef.current = next
        dirtyRef.current = true
      }
      const run = chainRef.current.then(saveNow, saveNow)
      chainRef.current = run
      return run
    },
    [saveNow],
  )

  const markDirty = useCallback(() => {
    if (disabledRef.current) return
    dirtyRef.current = true
    update('pending')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void flush(), delay)
  }, [delay, flush, update])

  const discard = useCallback(async () => {
    disabledRef.current = true
    dirtyRef.current = false
    clearTimeout(timerRef.current)
    await chainRef.current.catch(() => false)
  }, [])

  const reset = useCallback(() => {
    dirtyRef.current = false
    clearTimeout(timerRef.current)
    update('idle')
  }, [update])

  // Save pending edits when leaving the editor or the page.
  useEffect(() => {
    mountedRef.current = true
    const onHide = () => void flush()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    // IndexedDB writes may not finish during unload: flush early and ask the browser to confirm leaving.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || disabledRef.current) return
      void flush()
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onVisibility)
      mountedRef.current = false
      void flush()
    }
  }, [flush])

  return { state, error, markDirty, flush, discard, reset }
}
