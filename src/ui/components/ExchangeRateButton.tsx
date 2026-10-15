import { ArrowsClockwiseIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { EcbRateError, fetchEcbRate } from '../../integrations/ecb'
import { useApp } from '../AppContext'
import { formatDate } from '../format'

/**
 * "Too EKP kurss": fills the euro exchange rate of a foreign-currency invoice with the ECB reference rate for
 * `date` (the date of supply, or the issue date), or the last one published before it, and shows the rate's date.
 */
export function ExchangeRateButton({
  currency,
  date,
  onRate,
  disabled,
}: {
  currency: string
  date: string
  /** Units of `currency` per 1 EUR, and the day the ECB published it for. */
  onRate: (rate: number, rateDate: string) => void
  disabled?: boolean
}) {
  const { t } = useApp()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  // A different currency or date makes the previous result stale, and a response still on its way for them is ignored.
  const key = `${currency}:${date}`
  const [shownFor, setShownFor] = useState(key)
  if (shownFor !== key) {
    setShownFor(key)
    setMessage(null)
  }
  const currentKey = useRef(key)
  useEffect(() => {
    currentKey.current = key
  }, [key])

  const cur = currency.trim().toUpperCase()
  if (!cur || cur === 'EUR') return null

  const run = async () => {
    const requested = key
    const stale = () => !alive.current || currentKey.current !== requested
    setBusy(true)
    setMessage(null)
    try {
      const r = await fetchEcbRate(cur, date)
      if (stale()) return
      onRate(r.rate, r.date)
      const rate = String(r.rate).replace('.', ',')
      setMessage({
        text:
          r.date === date
            ? t('rates.result', { date: formatDate(r.date), rate, currency: cur })
            : t('rates.resultEarlier', { date: formatDate(r.date), requested: formatDate(date), rate, currency: cur }),
        error: false,
      })
    } catch (e) {
      if (stale()) return
      const notFound = e instanceof EcbRateError && (e.code === 'not-found' || e.code === 'unsupported-currency')
      setMessage({ text: notFound ? t('rates.notFound', { currency: cur }) : t('rates.failed'), error: true })
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className="rate-fetch">
      <button type="button" className="btn btn-sm" onClick={() => void run()} disabled={disabled || busy || !/^\d{4}-\d{2}-\d{2}$/.test(date)} title={t('rates.hint')}>
        <ArrowsClockwiseIcon />
        {busy ? t('rates.fetching') : t('rates.fetch')}
      </button>
      <p className={`small ${message?.error ? 'field-error' : 'muted'}`} role="status" aria-live="polite">
        {message?.text}
      </p>
    </div>
  )
}
