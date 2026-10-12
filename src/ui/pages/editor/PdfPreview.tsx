import { CaretDownIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import type { Invoice } from '../../../domain'
import { renderInvoicePdf } from '../../../pdf'
import { useApp } from '../../AppContext'
import { Skeleton } from '../../components/ui'
import { errorMessage } from '../../util'

const OPEN_KEY = 'invoice-generator:previewOpen'

/** Open by default on wide screens, where the preview sits beside the form; remembered per browser. */
function initialOpen(): boolean {
  try {
    const stored = localStorage.getItem(OPEN_KEY)
    if (stored === '1' || stored === '0') return stored === '1'
  } catch {
    /* storage unavailable */
  }
  return typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1180px)').matches
}

/** Debounced live PDF preview in an iframe, collapsible. Old object URLs are revoked; nothing renders while collapsed. */
export function PdfPreview({ invoice, delay = 700 }: { invoice: Invoice; delay?: number }) {
  const { t } = useApp()
  const [open, setOpen] = useState(initialOpen)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const urlRef = useRef<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
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
        setUrl(next)
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
  }, [invoice, delay, open])

  useEffect(
    () => () => {
      seq.current++
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <section className={`panel preview${open ? ' preview-open' : ''}`} aria-labelledby="preview-title">
      <div className="preview-head">
        <h2 id="preview-title">{t('preview.title')}</h2>
        {open && rendering && (
          <span className="preview-status" aria-live="polite">
            {t('preview.updating')}
          </span>
        )}
        <button type="button" className="btn btn-ghost btn-sm preview-toggle" aria-expanded={open} aria-controls="preview-body" onClick={toggle}>
          {open ? t('preview.hide') : t('preview.show')}
          <CaretDownIcon className="caret" />
        </button>
      </div>
      {open && (
        <div id="preview-body" className="preview-body">
          {error && (
            <div className="notice notice-warn" role="status">
              {t('preview.failed')}
              <details>
                <summary>{t('common.details')}</summary>
                <code className="small">{error}</code>
              </details>
            </div>
          )}
          {url ? (
            <iframe className="preview-frame" title={t('preview.frameTitle')} src={url + '#toolbar=0&navpanes=0&view=FitH'} />
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
      )}
    </section>
  )
}
