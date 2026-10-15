import { useId, useState } from 'react'
import {
  formatInvoiceNumber,
  matchPreset,
  nextSequence,
  numberingFloor,
  NUMBERING_RESETS,
  prefixCoversPeriod,
  raiseNumbering,
  resetOf,
  restartBelowUsed,
  setNextSequence,
  unknownTokens,
  upcomingNumbers,
  type ISODate,
  type Invoice,
  type NumberingPreset,
  type NumberingPresetId,
  type NumberingReset,
  type NumberingSettings,
} from '../../domain'
import { useApp } from '../AppContext'
import { NumberField, SelectField, TextField } from '../components/fields'
import { formatDate } from '../format'

const PERIOD_TOKEN: Record<NumberingReset, string> = { never: '', yearly: '{YYYY}', monthly: '{YYYY}-{MM}', daily: '{YYYYMMDD}' }

function periodLabel(reset: NumberingReset, date: ISODate): string {
  if (reset === 'yearly') return date.slice(0, 4)
  if (reset === 'monthly') return `${date.slice(5, 7)}.${date.slice(0, 4)}`
  return formatDate(date)
}

/**
 * Number series settings: preset formats, custom prefix / length / reset, the next number of the current period
 * and a preview of the next numbers for today. Warns (does not block) when numbers would restart below used ones.
 */
export function NumberingEditor({
  value,
  onChange,
  presets,
  documents,
  usedNumbers,
  today,
  idPrefix,
}: {
  value: NumberingSettings
  onChange: (v: NumberingSettings) => void
  presets: readonly NumberingPreset[]
  /** Numbered documents of this series. */
  documents: Invoice[]
  /** Every number in use (any series); issuing skips them. */
  usedNumbers: ReadonlySet<string>
  today: ISODate
  /** Distinguishes field ids when two editors are on the page. */
  idPrefix: string
}) {
  const { t } = useApp()
  const name = useId()
  const matched = matchPreset(value, presets)
  const [customOpen, setCustomOpen] = useState(matched === 'custom')
  const selected: NumberingPresetId | 'custom' = customOpen ? 'custom' : matched
  const reset = resetOf(value)
  const next = nextSequence(value, today).n
  const lastUsed = restartBelowUsed(value, today, documents)
  const unknown = unknownTokens(value.prefix)
  const preview = upcomingNumbers(value, today, usedNumbers)

  const choosePreset = (p: NumberingPreset) => {
    setCustomOpen(false)
    const base: NumberingSettings = { ...value, prefix: p.prefix, padding: p.padding, reset: p.reset }
    // Continue after numbers already used in the chosen format instead of starting below them.
    onChange(raiseNumbering(base, numberingFloor(base, documents)))
  }

  const options: { id: NumberingPresetId | 'custom'; name: string; desc: string; onPick: () => void }[] = [
    ...presets.map((p) => ({
      id: p.id,
      name: formatInvoiceNumber({ ...p, nextNumber: 1 }, 1, today),
      desc: t(`numbering.preset.${p.id}`),
      onPick: () => choosePreset(p),
    })),
    { id: 'custom', name: t('numbering.preset.custom'), desc: t('numbering.preset.customHint'), onPick: () => setCustomOpen(true) },
  ]

  return (
    <div className="numbering-editor">
      <fieldset className="template-picker">
        <legend className="label">{t('numbering.format')}</legend>
        <div className="template-list">
          {options.map((o) => {
            const nameId = `${name}-${o.id}-name`
            const descId = `${name}-${o.id}-desc`
            return (
              <label key={o.id} className={`template-option${selected === o.id ? ' selected' : ''}`}>
                <input type="radio" name={name} value={o.id} checked={selected === o.id} onChange={o.onPick} aria-labelledby={nameId} aria-describedby={descId} />
                <span className="tpl-text">
                  <span className={`tpl-name${o.id === 'custom' ? '' : ' numbering-example'}`} id={nameId}>
                    {o.name}
                  </span>
                  <span className="tpl-desc" id={descId}>
                    {o.desc}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {selected === 'custom' && (
        <>
          <div className="grid">
            <TextField id={`${idPrefix}-prefix`} label={t('numbering.prefix')} value={value.prefix} onChange={(prefix) => onChange({ ...value, prefix })} spellCheck={false} autoComplete="off" />
            <NumberField
              id={`${idPrefix}-padding`}
              label={t('numbering.padding')}
              hint={t('numbering.paddingHint')}
              value={value.padding}
              onChange={(v) => onChange({ ...value, padding: Math.min(10, Math.max(0, Math.round(v ?? 0))) })}
            />
            <SelectField<NumberingReset>
              id={`${idPrefix}-reset`}
              label={t('numbering.reset')}
              value={reset}
              onChange={(r) => onChange({ ...value, reset: r })}
              options={NUMBERING_RESETS.map((r) => ({ value: r, label: t(`numbering.reset.${r}`) }))}
            />
          </div>
          <p className="field-hint">{t('numbering.tokens')}</p>
          {unknown.length > 0 && <p className="notice notice-warn">{t('numbering.unknownTokens', { tokens: unknown.join(', ') })}</p>}
          {!prefixCoversPeriod(value.prefix, reset) && <p className="notice notice-warn">{t('numbering.periodMissing', { token: PERIOD_TOKEN[reset] })}</p>}
        </>
      )}

      <div className="grid">
        <NumberField
          id={`${idPrefix}-next`}
          label={t('numbering.next')}
          hint={reset === 'never' ? t('numbering.nextHint.never') : t('numbering.nextHint.period', { period: periodLabel(reset, today) })}
          value={next}
          onChange={(v) => onChange(setNextSequence(value, today, Math.max(1, Math.round(v ?? 1))))}
        />
      </div>

      {lastUsed !== null && (
        <div className="notice notice-warn numbering-warning" role="status">
          <span>{t('numbering.usedWarning', { last: formatInvoiceNumber(value, lastUsed, today) })}</span>
          <button type="button" className="btn btn-sm" onClick={() => onChange(setNextSequence(value, today, lastUsed + 1))}>
            {t('numbering.continueFrom', { n: lastUsed + 1 })}
          </button>
        </div>
      )}

      <div>
        <p className="numbering-preview">
          {t('numbering.preview')} <strong>{preview.join(', ')}</strong>
        </p>
        <p className="field-hint">{t('numbering.previewHint')}</p>
      </div>
    </div>
  )
}
