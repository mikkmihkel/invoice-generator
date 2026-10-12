import { useEffect, useRef, useState } from 'react'
import type { Invoice } from '../../../domain'
import { renderInvoicePdf } from '../../../pdf'
import { useApp } from '../../AppContext'
import { errorMessage } from '../../util'

/** Debounced live PDF preview in an iframe. Old object URLs are revoked. */
export function PdfPreview({ invoice, delay = 700 }: { invoice: Invoice; delay?: number }) {
  const { t } = useApp()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const urlRef = useRef<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
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
  }, [invoice, delay])

  useEffect(
    () => () => {
      seq.current++
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  return (
    <section className="card preview" aria-labelledby="preview-title">
      <div className="preview-head">
        <h2 id="preview-title">{t('preview.title')}</h2>
        {rendering && <span className="muted small" aria-live="polite">{t('preview.updating')}</span>}
      </div>
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
        !error && <div className="preview-placeholder muted">{t('preview.loading')}</div>
      )}
    </section>
  )
}
