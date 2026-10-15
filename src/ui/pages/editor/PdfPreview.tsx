import { XIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Invoice } from '../../../domain'
import { useApp } from '../../AppContext'
import { Skeleton } from '../../components/ui'
import { errorMessage } from '../../util'
import { renderDocument, type Rendered } from './previewPages'

const FOCUSABLE = 'a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'

/** Identity of a rendered PDF: the same invoice version renders the same document. */
const versionOf = (inv: Invoice) => `${inv.id}:${inv.updatedAt}:${inv.status}`

/**
 * The real invoice PDF, every page, beside the form. Docked (`sheet` false) it is a non-modal panel: the form stays
 * editable and the pages re-render after `delay` ms of quiet, keeping the previous pages until the new ones are ready.
 * As a `sheet` (phones) it covers the screen like a dialog. Nothing renders while closed; the last document is kept,
 * so reopening the same invoice version is instant.
 */
export function PreviewPanel({
  invoice,
  open,
  onClose,
  actions,
  sheet = false,
  returnFocus,
  delay = 600,
}: {
  invoice: Invoice
  open: boolean
  onClose: () => void
  actions?: ReactNode
  sheet?: boolean
  /** Where focus goes when the sheet closes (the opener; Safari does not focus buttons on click). */
  returnFocus?: RefObject<HTMLElement | null>
  delay?: number
}) {
  const { t } = useApp()
  const [doc, setDoc] = useState<Rendered | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const urlRef = useRef<string | null>(null)
  const seq = useRef(0)
  const panel = useRef<HTMLElement>(null)
  const invoiceRef = useRef(invoice)
  const hasDoc = useRef(false)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
    invoiceRef.current = invoice
  })
  const version = versionOf(invoice)
  const fresh = doc?.version === version

  useEffect(() => {
    if (!open || fresh) return
    let cancelled = false
    const my = ++seq.current
    const stale = () => cancelled || my !== seq.current
    // The first document renders right away; later edits wait for a pause in typing.
    const handle = setTimeout(async () => {
      setRendering(true)
      try {
        const next = await renderDocument(invoiceRef.current, version, stale)
        if (!next) return
        if (stale()) {
          if ('url' in next) URL.revokeObjectURL(next.url)
          return
        }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = 'url' in next ? next.url : null
        hasDoc.current = true
        setRendering(false)
        setDoc(next)
        setError(null)
      } catch (e) {
        if (stale()) return
        console.warn('PDF preview failed', e)
        setRendering(false)
        setError(errorMessage(e))
      }
    }, hasDoc.current ? delay : 0)
    return () => {
      clearTimeout(handle)
      // A newer version (or closing) supersedes a render in flight.
      cancelled = true
      setRendering(false)
    }
  }, [version, open, fresh, delay])

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  // As a sheet: focus moves in, Escape closes, focus returns to the opener and the page keeps its scroll position.
  useEffect(() => {
    if (!open || !sheet) return
    const opener = returnFocus?.current ?? (document.activeElement as HTMLElement | null)
    const scrollY = window.scrollY
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    document.documentElement.classList.add('ed-sheet-open')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.documentElement.classList.remove('ed-sheet-open')
      if (Math.abs(window.scrollY - scrollY) > 1) window.scrollTo?.(0, scrollY)
      opener?.focus?.({ preventScroll: true })
    }
  }, [open, sheet, returnFocus])

  if (!open) return null

  // Docked, closing moves focus back to the toggle (the sheet's effect does this itself) without scrolling the page.
  const close = () => {
    onClose()
    if (!sheet) returnFocus?.current?.focus({ preventScroll: true })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !sheet) {
      // Docked: Escape closes when focus is inside the panel.
      e.stopPropagation()
      close()
      return
    }
    if (e.key !== 'Tab' || !sheet || !panel.current) return
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

  const pages = doc && 'pages' in doc ? doc.pages : null
  const body = (
    <>
      <div className="pv-head">
        <div className="pv-title">
          <h2 id="preview-title">{t('preview.title')}</h2>
          <p className="pv-sub">{rendering && doc ? t('preview.updating') : t('editor.previewSub')}</p>
        </div>
        {actions}
        <button type="button" className="icon-btn" aria-label={t('editor.previewClose')} title={t('editor.previewClose')} onClick={close} data-autofocus>
          <XIcon size={18} />
        </button>
      </div>
      <div className={`pv-body${rendering && doc ? ' is-busy' : ''}`} aria-busy={rendering || undefined}>
        {error && (
          <div className="notice notice-warn" role="status">
            {t('preview.failed')}
            <details>
              <summary>{t('common.details')}</summary>
              <code className="small">{error}</code>
            </details>
          </div>
        )}
        {pages ? (
          pages.map((p, i) => (
            <img
              key={i}
              className="pv-page"
              src={p.src}
              width={p.width}
              height={p.height}
              alt={pages.length > 1 ? t('editor.previewPageAlt', { n: i + 1, total: pages.length }) : t('preview.frameTitle')}
            />
          ))
        ) : doc && 'url' in doc ? (
          <iframe className="pv-frame" title={t('preview.frameTitle')} src={doc.url + '#toolbar=0&navpanes=0&view=FitH'} />
        ) : (
          !error && (
            <div className="pv-placeholder" role="status" aria-label={t('preview.loading')}>
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
    </>
  )

  return sheet ? (
    <div ref={panel as RefObject<HTMLDivElement>} id="ed-preview" className="pv pv-sheet" role="dialog" aria-modal="true" aria-labelledby="preview-title" onKeyDown={onKeyDown}>
      {body}
    </div>
  ) : (
    <aside ref={panel} id="ed-preview" className="pv pv-docked" aria-labelledby="preview-title" onKeyDown={onKeyDown}>
      {body}
    </aside>
  )
}
