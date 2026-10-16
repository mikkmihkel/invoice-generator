import { CheckCircleIcon, InfoIcon, WarningCircleIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { errorMessage } from './util'

type ToastKind = 'success' | 'error' | 'info' | 'warning'
interface Toast {
  id: number
  kind: ToastKind
  message: string
  action?: ToastAction
}

/** A link, or a button such as "Undo" (the toast then stays a little longer and closes when it is pressed). */
export type ToastAction = { label: string; href: string } | { label: string; onClick: () => void }

export interface ToastApi {
  success(message: string, action?: Toast['action']): void
  /** An action here is typically "Try again". */
  error(message: string | unknown, action?: Toast['action']): void
  info(message: string, action?: Toast['action']): void
  warning(message: string, action?: Toast['action']): void
}

const ToastContext = createContext<ToastApi | null>(null)

const ICON: Record<ToastKind, ReactNode> = {
  success: <CheckCircleIcon size={18} />,
  error: <WarningCircleIcon size={18} />,
  warning: <WarningIcon size={18} />,
  info: <InfoIcon size={18} />,
}

export function ToastProvider({ children, closeLabel = 'Close' }: { children: ReactNode; closeLabel?: string }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])

  const push = useCallback(
    (kind: ToastKind, message: string, action?: Toast['action']) => {
      const id = ++seq.current
      setToasts((ts) => [...ts.slice(-4), { id, kind, message, action }])
      setTimeout(() => dismiss(id), kind === 'error' || kind === 'warning' || (action && 'onClick' in action) ? 8000 : 4500)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, a) => push('success', m, a),
      info: (m, a) => push('info', m, a),
      warning: (m, a) => push('warning', m, a),
      error: (m, a) => push('error', typeof m === 'string' ? m : errorMessage(m), a),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : undefined}>
            <span className="toast-icon">{ICON[t.kind]}</span>
            <span className="toast-msg">{t.message}</span>
            {t.action &&
              ('onClick' in t.action ? (
                <button
                  type="button"
                  className="link-btn toast-action"
                  onClick={() => {
                    dismiss(t.id)
                    ;(t.action as { onClick: () => void }).onClick()
                  }}
                >
                  {t.action.label}
                </button>
              ) : (
                <a href={t.action.href} target="_blank" rel="noreferrer" className="toast-action">
                  {t.action.label}
                </a>
              ))}
            <button type="button" className="icon-btn icon-btn-sm toast-close" aria-label={closeLabel} title={closeLabel} onClick={() => dismiss(t.id)}>
              <XIcon size={14} />
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
