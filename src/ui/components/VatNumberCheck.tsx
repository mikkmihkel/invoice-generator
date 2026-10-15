import { ArrowSquareOutIcon, CheckCircleIcon, CopyIcon, SealCheckIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { checkVatNumber, splitVatNumber, viesBlockedInSession, viesWebUrl, type ViesResult } from '../../integrations/vies'
import { useApp } from '../AppContext'

/**
 * Checks an EU VAT number in VIES and shows valid / invalid / service unavailable, with the registered name when
 * the member state discloses it. When the browser cannot read VIES, it says so and offers to copy the number and
 * open the official VIES page; later checks in the same session offer that page straight away.
 * Renders nothing for numbers without an EU prefix.
 */
export function VatNumberCheck({ vatNumber, onResult }: { vatNumber: string | undefined; onResult?: (result: ViesResult) => void }) {
  const { t, lang } = useApp()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ViesResult | null>(null)
  const [copied, setCopied] = useState(false)
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
    setCopied(false)
  }

  const parts = vatNumber ? splitVatNumber(vatNumber) : null
  if (!parts) return null

  const run = async () => {
    setBusy(true)
    setResult(null)
    setCopied(false)
    const r = await checkVatNumber(parts.countryCode, parts.number)
    if (!alive.current) return
    setBusy(false)
    setResult(r)
    onResult?.(r)
  }

  const display = parts.countryCode + parts.number
  const pageUrl = viesWebUrl(parts.countryCode, parts.number, lang)
  // Runs in the click that follows the link, so the clipboard write still has the user gesture.
  const copyNumber = () => {
    void navigator.clipboard?.writeText(display).then(
      () => alive.current && setCopied(true),
      () => undefined,
    )
  }
  const manualOnly = result?.status === 'blocked' || (!result && viesBlockedInSession())

  const openLink = (className: string, label: string) => (
    <a className={className} href={pageUrl} target="_blank" rel="noreferrer" onClick={copyNumber}>
      <CopyIcon aria-hidden="true" />
      {label}
      <ArrowSquareOutIcon aria-hidden="true" />
    </a>
  )

  return (
    <div className="vies-check">
      {manualOnly ? (
        openLink('btn btn-sm', t('vies.open'))
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => void run()} disabled={busy}>
          <SealCheckIcon />
          {busy ? t('vies.checking') : t('vies.check')}
        </button>
      )}
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
        {result?.status === 'unavailable' && (
          <p className="tone-warn">
            {t('vies.unavailable')}{' '}
            <a href={pageUrl} target="_blank" rel="noreferrer" onClick={copyNumber}>
              {t('vies.openPage')}
              <ArrowSquareOutIcon aria-hidden="true" className="vies-ext" />
            </a>
          </p>
        )}
        {result?.status === 'offline' && <p className="tone-warn">{t('vies.offline')}</p>}
        {result?.status === 'blocked' && <p className="muted">{t('vies.blocked', { number: display })}</p>}
        {copied && <p className="muted">{t('vies.copied', { number: display })}</p>}
      </div>
    </div>
  )
}
