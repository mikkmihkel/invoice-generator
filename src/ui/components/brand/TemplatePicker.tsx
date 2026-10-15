import { useId } from 'react'
import { hexOr, type ColorMode, type TemplateId } from '../../../domain'
import { useApp } from '../../AppContext'
import { templates } from '../../options'
import { accentColor } from '../../util'

const MONO_INK = '#2b3036'

export interface TemplatePickerProps {
  value: TemplateId
  onChange: (v: TemplateId) => void
  /** Primary colour for the thumbnails. */
  accent: string
  /** Secondary colour, used by the thumbnails in 'duo' mode. */
  secondary?: string
  /** Colour scheme for the thumbnails (default 'accent'). */
  mode?: ColorMode
  disabled?: boolean
  /** Small cards without descriptions (names stay visible; descriptions become tooltips). */
  compact?: boolean
  /** Visible legend; default "Kujundus". */
  legend?: string
}

/** Template cards with a tiny schematic thumbnail in the chosen colours. */
export function TemplatePicker({ value, onChange, accent, secondary, mode = 'accent', disabled, compact, legend }: TemplatePickerProps) {
  const { t, lang } = useApp()
  const name = useId()
  const primary = mode === 'mono' ? MONO_INK : accentColor(accent)
  const second = mode === 'duo' ? hexOr(secondary, undefined) : undefined
  const vars: Record<string, string> = { '--tpl-accent': primary }
  if (second) vars['--tpl-second'] = second
  return (
    <fieldset className={`template-picker${compact ? ' template-compact' : ''}`} disabled={disabled}>
      <legend className="label">{legend ?? t('appearance.template')}</legend>
      <div className="template-grid">
        {templates().map((tpl) => (
          <label key={tpl.id} className={`template-card${value === tpl.id ? ' selected' : ''}`} title={compact ? tpl.description[lang] : undefined}>
            <input type="radio" name={name} value={tpl.id} checked={value === tpl.id} onChange={() => onChange(tpl.id)} className="visually-hidden" />
            <span className={`tpl-thumb tpl-${tpl.id}${second ? ' tpl-duo' : ''}`} style={vars} aria-hidden="true">
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
