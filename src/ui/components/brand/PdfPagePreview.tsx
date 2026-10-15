import { useEffect, useRef, useState } from 'react'
import type { Invoice } from '../../../domain'
import { renderInvoicePdf } from '../../../pdf'
import { useApp } from '../../AppContext'
import { Skeleton } from '../ui'
import { renderPdfPageImage, type PageImage } from './pdfRaster'

export interface PdfPagePreviewProps {
  /** Invoice to render (the real PDF, page 1). Re-rendered when the object changes, after `delay`. */
  invoice: Invoice
  /** Rendered width in CSS pixels (the image scales down with its container). Default 360. */
  width?: number
  /** Debounce in ms. Default 600. */
  delay?: number
  /** Accessible description of the image. */
  alt: string
  className?: string
}

/**
 * The real first page of an invoice PDF as an image. Lazy: nothing is rendered until the preview scrolls into view
 * (pdfmake and pdf.js load on first use); updates are debounced and the last image stays visible while updating.
 */
export function PdfPagePreview({ invoice, width = 360, delay = 600, alt, className }: PdfPagePreviewProps) {
  const { t } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [image, setImage] = useState<PageImage | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el || visible || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true)
        io.disconnect()
      }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const my = ++seq.current
    const handle = setTimeout(async () => {
      setBusy(true)
      try {
        const pdf = await renderInvoicePdf(invoice, { embedEInvoice: false })
        if (my !== seq.current) return
        const img = await renderPdfPageImage(pdf, width)
        if (my !== seq.current) return
        setImage(img)
        setFailed(false)
      } catch (e) {
        if (my !== seq.current) return
        console.warn('Design preview failed', e)
        setFailed(true)
      } finally {
        if (my === seq.current) setBusy(false)
      }
    }, image ? delay : 0)
    return () => clearTimeout(handle)
    // `image` only decides the first render's delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice, width, delay, visible])

  useEffect(() => () => void seq.current++, [])

  return (
    <div ref={ref} className={`pdf-page-preview${busy ? ' is-busy' : ''}${className ? ' ' + className : ''}`} style={{ maxWidth: width }} aria-busy={busy || undefined}>
      {image ? (
        <img src={image.src} width={image.width} height={image.height} alt={alt} />
      ) : failed ? null : (
        <div className="pdf-page-placeholder" role="status" aria-label={t('appearance.previewLoading')}>
          <Skeleton w="40%" h={12} />
          <Skeleton w="28%" />
          <Skeleton w="100%" h={1} />
          <Skeleton w="85%" />
          <Skeleton w="70%" />
          <Skeleton w="36%" h={12} className="sk-right" />
        </div>
      )}
      {failed && <p className="field-hint pdf-page-failed">{t('appearance.previewFailed')}</p>}
      {busy && image && (
        <span className="pdf-page-status" aria-live="polite">
          {t('appearance.previewLoading')}
        </span>
      )}
    </div>
  )
}
