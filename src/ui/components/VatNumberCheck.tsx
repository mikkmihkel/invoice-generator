import { ArrowSquareOutIcon, CheckCircleIcon, SealCheckIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { checkVatNumber, splitVatNumber, VIES_WEB_URL, type ViesResult } from '../../integrations/vies'
import { useApp } from '../AppContext'

/**
 * Checks an EU VAT number in VIES and shows valid / invalid / service unavailable, with the registered name when
 * the member state discloses it. When the browser cannot reach VIES, it says so and links to the official page.
 * Renders nothing for numbers without an EU prefix.
 */
export function VatNumberCheck({ vatNumber, onResult }: { vatNumber: string | undefined; onResult?: (result: ViesResult) => void }) {
  const { t } = useApp()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ViesResult | null>(null)
  const [checkedFor, setCheckedFor] = useState(vatNumber)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  if (checkedFor !== vatNumber) {
    setCheckedFor(vatNumber)
    setResult(null)
  }

  const parts = vatNumber ? splitVatNumber(vatNumber) : null
  if (!parts) return null

  const run = async () => {
    setBusy(true)
    setResult(null)
    const r = await checkVatNumber(parts.countryCode, parts.number)
    if (!alive.current) return
    setBusy(false)
    setResult(r)
    onResult?.(r)
  }

  const display = parts.countryCode + parts.number
  return (
    <div className="vies-check">
      <button type="button" className="btn btn-sm" onClick={() => void run()} disabled={busy}>
        <SealCheckIcon />
        {busy ? t('vies.checking') : t('vies.check')}
      </button>
      <div className="small" role="status" aria-live="polite">
        {result?.status === 'valid' && (
          <p className="tone-success vies-result">
            <CheckCircleIcon />
            <span>
              {result.name ? t('vies.validName', { name: result.name }) : t('vies.valid')}
              {result.address && <span className="muted"> · {result.address}</span>}
            </span>
          </p>
        )}
        {result?.status === 'invalid' && (
          <p className="field-error vies-result">
            <WarningCircleIcon />
            <span>{t('vies.invalid')}</span>
          </p>
        )}
        {result?.status === 'unavailable' && <p className="tone-warn">{t('vies.unavailable')}</p>}
        {result?.status === 'blocked' && (
          <p className="muted">
            {t('vies.blocked', { number: display })}{' '}
            <a href={VIES_WEB_URL} target="_blank" rel="noreferrer">
              {t('vies.open')}
              <ArrowSquareOutIcon aria-hidden="true" style={{ verticalAlign: '-2px', marginLeft: 2 }} />
            </a>
          </p>
        )}
      </div>
    </div>
  )
}
