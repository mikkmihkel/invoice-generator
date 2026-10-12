import { useId } from 'react'
import type { TemplateId } from '../../domain'
import { useApp } from '../AppContext'
import { ACCENT_PRESETS, templates } from '../options'
import { accentColor } from '../util'

/** Template cards with a tiny schematic thumbnail in the chosen accent colour. */
export function TemplatePicker({ value, onChange, accent, disabled, compact }: { value: TemplateId; onChange: (v: TemplateId) => void; accent: string; disabled?: boolean; compact?: boolean }) {
  const { t, lang } = useApp()
  const name = useId()
  return (
    <fieldset className={`template-picker${compact ? ' template-compact' : ''}`} disabled={disabled}>
      <legend className="label">{t('appearance.template')}</legend>
      <div className="template-grid">
        {templates().map((tpl) => (
          <label key={tpl.id} className={`template-card${value === tpl.id ? ' selected' : ''}`} title={compact ? tpl.description[lang] : undefined}>
            <input type="radio" name={name} value={tpl.id} checked={value === tpl.id} onChange={() => onChange(tpl.id)} className="visually-hidden" />
            <span className={`tpl-thumb tpl-${tpl.id}`} style={{ ['--tpl-accent' as string]: accentColor(accent) }} aria-hidden="true">
              <span className="tpl-head" />
              <span className="tpl-line" />
              <span className="tpl-line short" />
              <span className="tpl-table" />
              <span className="tpl-total" />
            </span>
            <span className="tpl-name">{tpl.name[lang]}</span>
            {!compact && <span className="tpl-desc">{tpl.description[lang]}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function AccentPicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { t } = useApp()
  const id = useId()
  return (
    <div className="field accent-picker">
      <label htmlFor={id}>{t('appearance.accent')}</label>
      <div className="accent-row">
        <input id={id} type="color" value={accentColor(value)} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
        {ACCENT_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch${c.toLowerCase() === value.toLowerCase() ? ' selected' : ''}`}
            style={{ background: c }}
            aria-label={t('appearance.useColor', { color: c })}
            aria-pressed={c.toLowerCase() === value.toLowerCase()}
            onClick={() => onChange(c)}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  )
}
