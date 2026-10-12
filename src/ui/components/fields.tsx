import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { formatNumber, parseDecimal } from '../format'

/** Stable DOM id for a model field path, so the validation panel can focus it. */
export function fieldId(path: string): string {
  return 'f-' + path.replace(/[^a-zA-Z0-9_-]/g, '-')
}

interface FieldShellProps {
  id: string
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children: ReactNode
  required?: boolean
}

export function FieldShell({ id, label, hint, error, className, children, required }: FieldShellProps) {
  return (
    <div className={`field${error ? ' field-invalid' : ''}${className ? ' ' + className : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? (
        <div className="field-error" id={id + '-err'}>
          {error}
        </div>
      ) : hint ? (
        <div className="field-hint" id={id + '-hint'}>
          {hint}
        </div>
      ) : null}
    </div>
  )
}

type BaseProps = {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  /** Model path used for the DOM id (see fieldId). */
  path?: string
}

function describedBy(id: string, hint?: ReactNode, error?: ReactNode) {
  return error ? id + '-err' : hint ? id + '-hint' : undefined
}

export function TextField({
  label,
  hint,
  error,
  className,
  path,
  value,
  onChange,
  ...rest
}: BaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string | undefined; onChange: (v: string) => void }) {
  const auto = useId()
  const id = rest.id ?? (path ? fieldId(path) : auto)
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className} required={rest.required}>
      <input
        type="text"
        {...rest}
        id={id}
        value={value ?? ''}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  )
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  path,
  value,
  onChange,
  ...rest
}: BaseProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & { value: string | undefined; onChange: (v: string) => void }) {
  const auto = useId()
  const id = rest.id ?? (path ? fieldId(path) : auto)
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className} required={rest.required}>
      <textarea
        rows={3}
        {...rest}
        id={id}
        value={value ?? ''}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  )
}

export function SelectField<T extends string>({
  label,
  hint,
  error,
  className,
  path,
  value,
  onChange,
  options,
  ...rest
}: BaseProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
    value: T
    onChange: (v: T) => void
    options: { value: T; label: string }[]
  }) {
  const auto = useId()
  const id = rest.id ?? (path ? fieldId(path) : auto)
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <select {...rest} id={id} value={value} aria-describedby={describedBy(id, hint, error)} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}

export function CheckboxField({ label, hint, checked, onChange, disabled, id: idProp }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; id?: string }) {
  const auto = useId()
  const id = idProp ?? auto
  return (
    <div className="field field-check">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? id + '-hint' : undefined} />
      <label htmlFor={id}>{label}</label>
      {hint && (
        <div className="field-hint" id={id + '-hint'}>
          {hint}
        </div>
      )}
    </div>
  )
}

/**
 * Decimal input that accepts "1,5" or "1.5" and keeps the raw text while typing.
 * Emits null when empty (use `allowEmpty`) and ignores invalid text until it parses.
 */
export function DecimalInput({
  value,
  onChange,
  allowEmpty,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | undefined | null
  onChange: (v: number | null) => void
  allowEmpty?: boolean
}) {
  const [text, setText] = useState(() => (value == null ? '' : formatNumber(value)))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (focused) return
    setText(value == null ? '' : formatNumber(value))
  }, [value, focused])

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      {...rest}
      value={text}
      onFocus={(e) => {
        setFocused(true)
        rest.onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        const n = parseDecimal(text)
        if (n == null && !allowEmpty) setText(value == null ? '' : formatNumber(value))
        rest.onBlur?.(e)
      }}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        const n = parseDecimal(raw)
        if (n != null) onChange(n)
        else if (raw.trim() === '' && allowEmpty) onChange(null)
      }}
    />
  )
}

export function NumberField({
  label,
  hint,
  error,
  className,
  path,
  value,
  onChange,
  allowEmpty,
  suffix,
  ...rest
}: BaseProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
    value: number | undefined | null
    onChange: (v: number | null) => void
    allowEmpty?: boolean
    suffix?: string
  }) {
  const auto = useId()
  const id = rest.id ?? (path ? fieldId(path) : auto)
  const input = (
    <DecimalInput {...rest} id={id} value={value} onChange={onChange} allowEmpty={allowEmpty} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} />
  )
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className} required={rest.required}>
      {suffix ? (
        <div className="input-suffix">
          {input}
          <span aria-hidden="true">{suffix}</span>
        </div>
      ) : (
        input
      )}
    </FieldShell>
  )
}
