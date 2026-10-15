import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

/** Resolves true when the user agrees to leave the page (e.g. discards unsaved changes). */
export type LeaveCheck = () => Promise<boolean>

interface NavGuard {
  set: (check: LeaveCheck | null) => void
  get: () => LeaveCheck | null
}

const NavGuardContext = createContext<NavGuard | null>(null)

/**
 * In-app navigation guard. HashRouter has no data router, so react-router's `useBlocker` is unavailable:
 * a page with unsaved changes registers a check here and the shell's links ask it before navigating.
 */
export function NavGuardProvider({ children }: { children: ReactNode }) {
  const ref = useRef<LeaveCheck | null>(null)
  const value = useMemo<NavGuard>(
    () => ({
      set: (check) => {
        ref.current = check
      },
      get: () => ref.current,
    }),
    [],
  )
  return <NavGuardContext.Provider value={value}>{children}</NavGuardContext.Provider>
}

/** While `when` is true, leaving through the shell's links first runs `check`. */
export function useNavGuard(when: boolean, check: LeaveCheck) {
  const ctx = useContext(NavGuardContext)
  const checkRef = useRef(check)
  useEffect(() => {
    checkRef.current = check
  })
  useEffect(() => {
    if (!ctx || !when) return
    const guard: LeaveCheck = () => checkRef.current()
    ctx.set(guard)
    return () => {
      if (ctx.get() === guard) ctx.set(null)
    }
  }, [ctx, when])
}

/**
 * Navigate to `to` unless a page objects. Returns a link click handler (plain left clicks only; modified clicks
 * open new tabs as usual) and a function for programmatic navigation such as keyboard shortcuts.
 */
export function useGuardedNavigation() {
  const ctx = useContext(NavGuardContext)
  const navigate = useNavigate()

  const go = useCallback(
    (to: string) => {
      const check = ctx?.get()
      if (!check) {
        navigate(to)
        return
      }
      void check().then((ok) => {
        if (!ok) return
        ctx?.set(null)
        navigate(to)
      })
    },
    [ctx, navigate],
  )

  const onLinkClick = useCallback(
    (to: string) => (e: React.MouseEvent) => {
      if (!ctx?.get() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      go(to)
    },
    [ctx, go],
  )

  return { go, onLinkClick }
}
