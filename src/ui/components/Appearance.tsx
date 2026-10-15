import { useId } from 'react'
import { useApp } from '../AppContext'
import { ACCENT_PRESETS } from '../options'
import { accentColor } from '../util'

// Brand components (colour fields, colour scheme, live design preview) live in ./brand; helpers via ./brand/index.
export { BrandColors, type BrandColorsProps, type BrandColorsValue } from './brand/BrandColors'
export { ColorField, type ColorFieldProps } from './brand/ColorField'
export { DesignPreview, InvoiceDesign, type DesignPreviewProps, type InvoiceDesignProps } from './brand/InvoiceDesign'
export { PdfPagePreview, type PdfPagePreviewProps } from './brand/PdfPagePreview'
export { TemplatePicker, type TemplatePickerProps } from './brand/TemplatePicker'

/** Single accent colour with presets (kept for older screens; new screens use `BrandColors` / `ColorField`). */
export function AccentPicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { t } = useApp()
  const id = useId()
  const current = accentColor(value)
  return (
    <div className="field accent-picker">
      <label htmlFor={id}>{t('appearance.accent')}</label>
      <div className="accent-row">
        <input id={id} type="color" value={current} onChange={(e) => onChange(accentColor(e.target.value))} disabled={disabled} />
        {ACCENT_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch${c.toLowerCase() === current.toLowerCase() ? ' selected' : ''}`}
            style={{ background: c }}
            aria-label={t('appearance.useColor', { color: c })}
            aria-pressed={c.toLowerCase() === current.toLowerCase()}
            onClick={() => onChange(c)}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  )
}
