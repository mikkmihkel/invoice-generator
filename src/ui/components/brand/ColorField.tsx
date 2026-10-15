import { useId, useState, type ReactNode } from 'react'
import { hexOr } from '../../../domain'
import { useApp } from '../../AppContext'
import { BRAND_PRESETS, parseHexInput } from './colors'

export interface ColorFieldProps {
  label: string
  /** Current colour; anything but `#rrggbb` is shown as `fallback`. */
  value: string | undefined
  /** Called with a valid lower-case `#rrggbb` only. */
  onChange: (hex: string) => void
  /** Swatches offered under the field (default BRAND_PRESETS; [] hides them). */
  presets?: readonly string[]
  /** Extra swatches, e.g. colours taken from the logo, shown first with `extraLabel`. */
  extraSwatches?: readonly string[]
  extraLabel?: string
  hint?: ReactNode
  /** Shown when `value` is not a valid colour. Default '#1f4e79'. */
  fallback?: string
  disabled?: boolean
  id?: string
}

function Swatches({ colors, current, onPick, disabled, label }: { colors: readonly string[]; current: string; onPick: (c: string) => void; disabled?: boolean; label?: string }) {
  const { t } = useApp()
  const safe = colors.map((c) => hexOr(c, undefined)).filter((c): c is string => !!c)
  if (!safe.length) return null
  return (
    <div className="swatch-row" role="group" aria-label={label}>
      {label && <span className="swatch-label">{label}</span>}
      {safe.map((c) => (
        <button
          key={c}
          type="button"
          className={`swatch${c === current ? ' selected' : ''}`}
          style={{ background: c }}
          aria-label={t('appearance.useColor', { color: c.toUpperCase() })}
          aria-pressed={c === current}
          title={c.toUpperCase()}
          onClick={() => onPick(c)}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

/** Colour input: native picker + `#RRGGBB` text field + preset (and optional extra) swatches. Hex only. */
export function ColorField({ label, value, onChange, presets = BRAND_PRESETS, extraSwatches, extraLabel, hint, fallback = '#1f4e79', disabled, id: idProp }: ColorFieldProps) {
  const { t } = useApp()
  const autoId = useId()
  const id = idProp ?? autoId
  const current = hexOr(value, fallback)
  const [text, setText] = useState(current.toUpperCase())
  const [invalid, setInvalid] = useState(false)
  const [shown, setShown] = useState(current)

  // Follow outside changes (picker, swatches, logo colours) unless the text already means the same colour.
  if (shown !== current) {
    setShown(current)
    if (parseHexInput(text) !== current) setText(current.toUpperCase())
    setInvalid(false)
  }

  const onText = (v: string) => {
    setText(v)
    const hex = parseHexInput(v)
    if (hex) {
      setInvalid(false)
      if (hex !== current) onChange(hex)
    }
  }

  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  return (
    <div className={`field color-field${invalid ? ' field-invalid' : ''}`}>
      <label htmlFor={id}>
        {label}
      </label>
      <div className="color-input-row">
        <input
          type="color"
          className="color-native"
          value={current}
          onChange={(e) => {
            const hex = hexOr(e.target.value, undefined)
            if (hex) onChange(hex)
          }}
          aria-label={t('appearance.picker', { label })}
          disabled={disabled}
        />
        <input
          id={id}
          className="color-hex"
          value={text}
          onChange={(e) => onText(e.target.value)}
          onBlur={() => {
            if (parseHexInput(text)) setText(parseHexInput(text)!.toUpperCase())
            else setInvalid(true)
          }}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={9}
          inputMode="text"
          aria-invalid={invalid || undefined}
          aria-describedby={[invalid ? errorId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined}
          disabled={disabled}
        />
      </div>
      {extraSwatches && extraSwatches.length > 0 && <Swatches colors={extraSwatches} current={current} onPick={onChange} disabled={disabled} label={extraLabel} />}
      {presets.length > 0 && <Swatches colors={presets} current={current} onPick={onChange} disabled={disabled} label={extraSwatches?.length ? t('appearance.presets') : undefined} />}
      {invalid && (
        <div id={errorId} className="field-error" role="alert">
          {t('appearance.hexInvalid')}
        </div>
      )}
      {hint && (
        <div id={hintId} className="field-hint">
          {hint}
        </div>
      )}
    </div>
  )
}
