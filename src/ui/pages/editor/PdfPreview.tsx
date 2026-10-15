import { XIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Invoice } from '../../../domain'
import { renderInvoicePdf } from '../../../pdf'
import { useApp } from '../../AppContext'
import { Skeleton } from '../../components/ui'
import { errorMessage } from '../../util'

const FOCUSABLE = 'a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'

/** Identity of a rendered PDF: the same invoice version renders the same document. */
const versionOf = (inv: Invoice) => `${inv.id}:${inv.updatedAt}:${inv.status}`

/**
 * The real invoice PDF in a side drawer. Nothing renders until the drawer opens; the last document is kept
 * for the same invoice version, so reopening is instant. Old object URLs are revoked.
 */
export function PreviewDrawer({
  invoice,
  open,
  onClose,
  actions,
  returnFocus,
  delay = 250,
}: {
  invoice: Invoice
  open: boolean
  onClose: () => void
  actions?: ReactNode
  /** Where focus goes on close (the opener; Safari does not focus buttons on click). */
  returnFocus?: RefObject<HTMLElement | null>
  delay?: number
}) {
  const { t } = useApp()
  const [doc, setDoc] = useState<{ url: string; version: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const urlRef = useRef<string | null>(null)
  const seq = useRef(0)
  const panel = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const version = versionOf(invoice)
  const fresh = doc?.version === version

  useEffect(() => {
    if (!open || fresh) return
    const my = ++seq.current
    const handle = setTimeout(async () => {
      setRendering(true)
      try {
        const blob = await renderInvoicePdf(invoice)
        if (my !== seq.current) return
        if (typeof URL.createObjectURL !== 'function') throw new Error('URL.createObjectURL unavailable')
        const next = URL.createObjectURL(blob)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = next
        setDoc({ url: next, version })
        setError(null)
      } catch (e) {
        if (my !== seq.current) return
        console.warn('PDF preview failed', e)
        setError(errorMessage(e))
      } finally {
        if (my === seq.current) setRendering(false)
      }
    }, delay)
    return () => clearTimeout(handle)
  }, [invoice, version, open, fresh, delay])

  useEffect(
    () => () => {
      seq.current++
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  // Modal while open: focus moves in, Tab stays inside, Escape closes, focus returns to the opener.
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      ;(returnFocus?.current ?? prev)?.focus?.()
    }
  }, [open, returnFocus])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panel.current) return
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="drawer" role="dialog" aria-modal="true" aria-labelledby="preview-title" onKeyDown={onKeyDown}>
        <div className="drawer-head">
          <div className="drawer-title">
            <h2 id="preview-title">{t('preview.title')}</h2>
            <p className="drawer-sub" aria-live="polite">
              {rendering ? t('preview.updating') : t('editor.previewSub')}
            </p>
          </div>
          {actions}
          <button type="button" className="icon-btn" aria-label={t('common.close')} title={t('common.close')} onClick={onClose} data-autofocus>
            <XIcon size={18} />
          </button>
        </div>
        <div className="drawer-body">
          {error && (
            <div className="notice notice-warn" role="status">
              {t('preview.failed')}
              <details>
                <summary>{t('common.details')}</summary>
                <code className="small">{error}</code>
              </details>
            </div>
          )}
          {doc ? (
            <iframe className="preview-frame" title={t('preview.frameTitle')} src={doc.url + '#toolbar=0&navpanes=0&view=FitH'} />
          ) : (
            !error && (
              <div className="preview-placeholder" role="status" aria-label={t('preview.loading')}>
                <Skeleton w="45%" h={14} />
                <Skeleton w="30%" />
                <Skeleton w="100%" h={1} />
                <Skeleton w="85%" />
                <Skeleton w="70%" />
                <Skeleton w="78%" />
                <Skeleton w="40%" h={14} className="sk-right" />
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
