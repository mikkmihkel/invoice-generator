import { useEffect, useState } from 'react'
import type { Invoice } from '../../../domain'
import { renderInvoicePdf } from '../../../pdf'
import { useApp } from '../../AppContext'
import { renderPdfPageImage, type PageImage } from '../../components/brand/pdfRaster'
import { Skeleton } from '../../components/ui'
import { errorMessage } from '../../util'

const PAGE_WIDTH = 720

/** A rendered first page, or (when rasterising is unavailable) the PDF itself for the browser's viewer. */
type Rendered = { image: PageImage } | { url: string }

// Rendered pages per invoice version (id + updatedAt), so flipping between invoices does not re-render them.
const cache = new Map<string, Rendered>()
const MAX_CACHED = 6

function remember(key: string, value: Rendered) {
  cache.set(key, value)
  while (cache.size > MAX_CACHED) {
    const [oldKey, old] = cache.entries().next().value as [string, Rendered]
    cache.delete(oldKey)
    if ('url' in old) URL.revokeObjectURL?.(old.url)
  }
}

async function render(invoice: Invoice): Promise<Rendered> {
  const pdf = await renderInvoicePdf(invoice)
  try {
    return { image: await renderPdfPageImage(pdf, PAGE_WIDTH) }
  } catch (e) {
    console.warn('Page image failed, showing the PDF instead', e)
    if (typeof URL.createObjectURL !== 'function') throw e
    return { url: URL.createObjectURL(pdf) }
  }
}

/** The real invoice (first page of the PDF), rendered only when asked for. */
export function PdfPage({ invoice, cacheKey }: { invoice: Invoice; cacheKey: string }) {
  const { t } = useApp()
  const [state, setState] = useState<{ key: string; page?: Rendered; error?: string }>(() => ({ key: cacheKey, page: cache.get(cacheKey) }))

  useEffect(() => {
    if (cache.has(cacheKey)) return
    let alive = true
    render(invoice)
      .then((page) => {
        remember(cacheKey, page)
        if (alive) setState({ key: cacheKey, page })
      })
      .catch((e) => alive && setState({ key: cacheKey, error: errorMessage(e) }))
    return () => {
      alive = false
    }
    // The cache key changes whenever the invoice does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey])

  const page = state.key === cacheKey ? (state.page ?? cache.get(cacheKey)) : cache.get(cacheKey)
  const error = state.key === cacheKey ? state.error : undefined

  if (error) {
    return (
      <div className="notice notice-warn" role="status">
        {t('preview.failed')}
        <details>
          <summary>{t('common.details')}</summary>
          <code className="small">{error}</code>
        </details>
      </div>
    )
  }
  return (
    <div className="pdf-page">
      {page && 'image' in page ? (
        <img className="pdf-page-image" src={page.image.src} width={page.image.width} height={page.image.height} alt={t('preview.frameTitle')} />
      ) : page ? (
        <iframe className="pdf-page-frame" title={t('preview.frameTitle')} src={page.url + '#toolbar=0&navpanes=0&view=FitH'} />
      ) : (
        <div className="pdf-page-placeholder" role="status" aria-label={t('preview.loading')}>
          <Skeleton w="45%" h={14} />
          <Skeleton w="30%" />
          <Skeleton w="100%" h={1} />
          <Skeleton w="85%" />
          <Skeleton w="70%" />
          <Skeleton w="78%" />
          <Skeleton w="40%" h={14} />
        </div>
      )}
    </div>
  )
}
