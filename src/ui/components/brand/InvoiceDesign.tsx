import { useMemo } from 'react'
import type { CompanyProfile, InvoiceDefaults } from '../../../domain'
import { useApp } from '../../AppContext'
import { templateName } from '../../options'
import { LogoInput } from '../misc'
import { BrandColors, type BrandColorsValue } from './BrandColors'
import { PdfPagePreview } from './PdfPagePreview'
import { TemplatePicker } from './TemplatePicker'
import { designSampleInvoice, type DesignChoice } from './sampleInvoice'

export interface DesignPreviewProps {
  profile: CompanyProfile
  design: DesignChoice
  /** Image width in CSS pixels. Default 340. */
  width?: number
}

/** Live preview of a sample invoice (the real PDF, page 1) with the profile's details and the given design. */
export function DesignPreview({ profile, design, width = 340 }: DesignPreviewProps) {
  const { t, lang } = useApp()
  const { templateId, accentColor, secondaryColor, colorMode } = design
  const invoice = useMemo(() => designSampleInvoice(profile, { templateId, accentColor, secondaryColor, colorMode }), [profile, templateId, accentColor, secondaryColor, colorMode])
  return <PdfPagePreview invoice={invoice} width={width} alt={t('appearance.previewAlt', { template: templateName(templateId, lang) })} />
}

export interface InvoiceDesignProps {
  value: CompanyProfile
  onChange: (p: CompanyProfile) => void
  /** Onboarding: compact template cards, no logo field (it has its own step), smaller preview. */
  compact?: boolean
  /** Show the logo upload (default: not compact). */
  showLogo?: boolean
}

/** "Arve kujundus": logo, default template, colours and a live preview of a sample invoice. */
export function InvoiceDesign({ value, onChange, compact, showLogo = !compact }: InvoiceDesignProps) {
  const { t } = useApp()
  const d = value.defaults
  const setDefaults = (patch: Partial<InvoiceDefaults>) => onChange({ ...value, defaults: { ...value.defaults, ...patch } })
  const colors: BrandColorsValue = { accentColor: d.accentColor, secondaryColor: d.secondaryColor, colorMode: d.colorMode }
  return (
    <div className={`invoice-design${compact ? ' invoice-design-compact' : ''}`}>
      <div className="design-controls">
        {showLogo && <LogoInput value={value.logoDataUrl} onChange={(logoDataUrl) => onChange({ ...value, logoDataUrl })} />}
        <TemplatePicker value={d.templateId} onChange={(templateId) => setDefaults({ templateId })} accent={d.accentColor} secondary={d.secondaryColor} mode={d.colorMode} compact={compact} />
        <BrandColors value={colors} onChange={setDefaults} logoDataUrl={value.logoDataUrl} compact={compact} />
      </div>
      <div className="design-preview">
        <div className="design-preview-head">
          <span className="label">{t('appearance.preview')}</span>
          <span className="field-hint">{t('appearance.previewHint')}</span>
        </div>
        <DesignPreview profile={value} design={d} width={compact ? 280 : 340} />
      </div>
    </div>
  )
}
