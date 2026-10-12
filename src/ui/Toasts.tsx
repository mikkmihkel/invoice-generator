import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { errorMessage } from './util'

type ToastKind = 'success' | 'error' | 'info' | 'warning'
interface Toast {
  id: number
  kind: ToastKind
  message: string
  action?: { label: string; href: string }
}

export interface ToastApi {
  success(message: string, action?: Toast['action']): void
  error(message: string | unknown): void
  info(message: string, action?: Toast['action']): void
  warning(message: string): void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children, closeLabel = 'Close' }: { children: ReactNode; closeLabel?: string }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])

  const push = useCallback(
    (kind: ToastKind, message: string, action?: Toast['action']) => {
      const id = ++seq.current
      setToasts((ts) => [...ts.slice(-4), { id, kind, message, action }])
      setTimeout(() => dismiss(id), kind === 'error' || kind === 'warning' ? 8000 : 4500)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, a) => push('success', m, a),
      info: (m, a) => push('info', m, a),
      warning: (m) => push('warning', m),
      error: (m) => push('error', typeof m === 'string' ? m : errorMessage(m)),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : undefined}>
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <a href={t.action.href} target="_blank" rel="noreferrer" className="toast-action">
                {t.action.label}
              </a>
            )}
            <button type="button" className="toast-close" aria-label={closeLabel} onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx
}
