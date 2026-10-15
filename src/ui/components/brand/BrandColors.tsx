import { EyedropperIcon, InfoIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { hexOr, type ColorMode } from '../../../domain'
import { useApp } from '../../AppContext'
import { Segmented } from '../ui'
import { ColorField } from './ColorField'
import { DEFAULT_SECONDARY, isLowContrast, suggestSecondary } from './colors'
import { logoColors } from './logoColors'

/** The colour fields shared by `InvoiceDefaults` and `Invoice`. */
export interface BrandColorsValue {
  accentColor: string
  secondaryColor?: string
  colorMode?: ColorMode
}

export interface BrandColorsProps {
  value: BrandColorsValue
  /** Receives only the changed fields; colours are always valid `#rrggbb`. */
  onChange: (patch: Partial<BrandColorsValue>) => void
  /** Embedded logo; enables "Võta värvid logost". */
  logoDataUrl?: string
  disabled?: boolean
  /** Tighter layout without the mode explanation (onboarding, invoice editor). */
  compact?: boolean
}

const MODES: ColorMode[] = ['mono', 'accent', 'duo']

/** Colour scheme (mono / accent / duo), primary and secondary colour, logo colours and contrast guidance. */
export function BrandColors({ value, onChange, logoDataUrl, disabled, compact }: BrandColorsProps) {
  const { t } = useApp()
  const mode: ColorMode = value.colorMode ?? 'accent'
  // Swatches (or an error) belong to the logo they were taken from.
  const [extracted, setExtracted] = useState<{ logo: string | undefined; colors: string[] | null; failed: boolean }>({ logo: undefined, colors: null, failed: false })
  const [extracting, setExtracting] = useState(false)
  const current = extracted.logo === logoDataUrl ? extracted : { colors: null, failed: false }
  const fromLogo = current.colors
  const extractError = current.failed

  const extract = async () => {
    const logo = logoDataUrl
    setExtracting(true)
    try {
      setExtracted({ logo, colors: await logoColors(logo), failed: false })
    } catch (e) {
      console.warn('Logo colours failed', e)
      setExtracted({ logo, colors: null, failed: true })
    } finally {
      setExtracting(false)
    }
  }

  const setMode = (colorMode: ColorMode) => {
    if (colorMode === 'duo' && !hexOr(value.secondaryColor, undefined)) onChange({ colorMode, secondaryColor: suggestSecondary(value.accentColor, fromLogo ?? []) })
    else onChange({ colorMode })
  }

  const swatches = fromLogo ?? undefined
  return (
    <div className={`brand-colors${compact ? ' brand-colors-compact' : ''}`}>
      <div className="field brand-mode">
        <span className="label">
          {t('appearance.mode')}
        </span>
        <Segmented label={t('appearance.mode')} value={mode} onChange={setMode} disabled={disabled} options={MODES.map((m) => ({ value: m, label: t(`appearance.mode.${m}`) }))} />
        {!compact && <div className="field-hint">{t(`appearance.modeHint.${mode}`)}</div>}
        {compact && mode === 'mono' && <div className="field-hint">{t('appearance.modeHint.mono')}</div>}
      </div>

      {mode !== 'mono' && (
        <div className="brand-color-grid">
          <ColorField
            label={t('appearance.primary')}
            value={value.accentColor}
            onChange={(accentColor) => onChange({ accentColor })}
            extraSwatches={swatches}
            extraLabel={t('appearance.logoColors')}
            disabled={disabled}
          />
          {mode === 'duo' && (
            <ColorField
              label={t('appearance.secondary')}
              value={value.secondaryColor}
              fallback={DEFAULT_SECONDARY}
              onChange={(secondaryColor) => onChange({ secondaryColor })}
              extraSwatches={swatches}
              extraLabel={t('appearance.logoColors')}
              disabled={disabled}
            />
          )}
        </div>
      )}

      {mode !== 'mono' && isLowContrast(value.accentColor) && (
        <p className="brand-note" role="status">
          <InfoIcon aria-hidden="true" />
          <span>{t('appearance.lowContrast')}</span>
        </p>
      )}

      {logoDataUrl && mode !== 'mono' && (
        <div className="brand-logo-colors">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void extract()} disabled={disabled || extracting}>
            <EyedropperIcon aria-hidden="true" />
            {extracting ? t('common.loading') : t('appearance.fromLogo')}
          </button>
          {fromLogo && fromLogo.length === 0 && <span className="field-hint">{t('appearance.noLogoColors')}</span>}
          {extractError && <span className="field-hint">{t('appearance.logoColorsFailed')}</span>}
        </div>
      )}
    </div>
  )
}
