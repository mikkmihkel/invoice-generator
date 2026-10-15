import { useId } from 'react'
import type { ColorMode, TemplateId } from '../../../domain'
import { useApp } from '../../AppContext'
import { templates } from '../../options'

export interface TemplatePickerProps {
  value: TemplateId
  onChange: (v: TemplateId) => void
  /** Kept for compatibility; the list draws no thumbnails, the live PDF preview shows the colours. */
  accent?: string
  /** Kept for compatibility (see `accent`). */
  secondary?: string
  /** Kept for compatibility (see `accent`). */
  mode?: ColorMode
  disabled?: boolean
  /** Tighter rows (onboarding, editor sidebar). */
  compact?: boolean
  /** Visible legend; default "Kujundus". */
  legend?: string
}

/**
 * Template choice as a compact radio list: name and a one-line description per template. No drawn layout images:
 * the real PDF preview next to it shows the result. Native radios, so arrow keys move through the list.
 */
export function TemplatePicker({ value, onChange, disabled, compact, legend }: TemplatePickerProps) {
  const { t, lang } = useApp()
  const name = useId()
  return (
    <fieldset className={`template-picker${compact ? ' template-compact' : ''}`} disabled={disabled}>
      <legend className="label">{legend ?? t('appearance.template')}</legend>
      <div className="template-list">
        {templates().map((tpl) => {
          const nameId = `${name}-${tpl.id}-name`
          const descId = `${name}-${tpl.id}-desc`
          return (
            <label key={tpl.id} className={`template-option${value === tpl.id ? ' selected' : ''}`}>
              <input type="radio" name={name} value={tpl.id} checked={value === tpl.id} onChange={() => onChange(tpl.id)} aria-labelledby={nameId} aria-describedby={descId} />
              <span className="tpl-text">
                <span className="tpl-name" id={nameId}>
                  {tpl.name[lang]}
                </span>
                <span className="tpl-desc" id={descId}>
                  {tpl.description[lang]}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
