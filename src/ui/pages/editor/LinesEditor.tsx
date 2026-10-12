import { useState } from 'react'
import { newId, vatSchemeAllowsRates, type InvoiceLine, type InvoiceTotals, type VatScheme } from '../../../domain'
import { useApp } from '../../AppContext'
import { DecimalInput, fieldId } from '../../components/fields'
import { formatMoney } from '../../format'
import { vatRates } from '../../options'

export function newLine(unit: string, vatRate: number): InvoiceLine {
  return { id: newId(), description: '', quantity: 1, unit, unitPrice: 0, vatRate }
}

interface Props {
  lines: InvoiceLine[]
  onChange: (lines: InvoiceLine[]) => void
  vatScheme: VatScheme
  currency: string
  totals: InvoiceTotals
  defaultUnit: string
  defaultVatRate: number
  disabled?: boolean
}

export function LinesEditor({ lines, onChange, vatScheme, currency, totals, defaultUnit, defaultVatRate, disabled }: Props) {
  const { t } = useApp()
  const showRates = vatSchemeAllowsRates(vatScheme)
  const [showDiscount, setShowDiscount] = useState(() => lines.some((l) => l.discountPercent))
  const discountCol = showDiscount || lines.some((l) => l.discountPercent)
  const lineTotal = new Map(totals.lines.map((l) => [l.lineId, l]))

  const update = (i: number, patch: Partial<InvoiceLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= lines.length) return
    const next = [...lines]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
    requestAnimationFrame(() => document.getElementById(`line-${dir < 0 ? 'up' : 'down'}-${next[j].id}`)?.focus())
  }
  const add = () => {
    const l = newLine(defaultUnit, showRates ? defaultVatRate : 0)
    onChange([...lines, l])
    requestAnimationFrame(() => document.getElementById(fieldId(`lines.${lines.length}.description`))?.focus())
  }
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i))

  const cls = `lines${showRates ? ' with-vat' : ''}${discountCol ? ' with-discount' : ''}`

  return (
    <div className={cls}>
      <div className="line line-header" aria-hidden="true">
        <span className="c-desc">{t('lines.description')}</span>
        <span className="c-qty">{t('lines.quantity')}</span>
        <span className="c-unit">{t('lines.unit')}</span>
        <span className="c-price">{t('lines.unitPrice')}</span>
        {discountCol && <span className="c-disc">{t('lines.discount')}</span>}
        {showRates && <span className="c-vat">{t('lines.vat')}</span>}
        <span className="c-total">{t('lines.total')}</span>
        <span className="c-tools" />
      </div>
      <ol className="line-list">
        {lines.map((l, i) => {
          const lt = lineTotal.get(l.id)
          const p = `lines.${i}`
          return (
            <li key={l.id} className="line" aria-label={t('lines.lineN', { n: i + 1 })}>
              <div className="c-desc">
                <label className="line-label" htmlFor={fieldId(`${p}.description`)}>
                  {t('lines.description')} {i + 1}
                </label>
                <textarea
                  id={fieldId(`${p}.description`)}
                  rows={1}
                  value={l.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                  disabled={disabled}
                  placeholder={t('lines.descriptionPlaceholder')}
                />
              </div>
              <div className="c-qty">
                <label className="line-label" htmlFor={fieldId(`${p}.quantity`)}>
                  {t('lines.quantity')}
                </label>
                <DecimalInput id={fieldId(`${p}.quantity`)} value={l.quantity} onChange={(v) => update(i, { quantity: v ?? 0 })} disabled={disabled} />
              </div>
              <div className="c-unit">
                <label className="line-label" htmlFor={fieldId(`${p}.unit`)}>
                  {t('lines.unit')}
                </label>
                <input id={fieldId(`${p}.unit`)} type="text" list="unit-suggestions-lines" value={l.unit} onChange={(e) => update(i, { unit: e.target.value })} disabled={disabled} />
              </div>
              <div className="c-price">
                <label className="line-label" htmlFor={fieldId(`${p}.unitPrice`)}>
                  {t('lines.unitPrice')}
                </label>
                <DecimalInput id={fieldId(`${p}.unitPrice`)} value={l.unitPrice} onChange={(v) => update(i, { unitPrice: v ?? 0 })} disabled={disabled} />
              </div>
              {discountCol && (
                <div className="c-disc">
                  <label className="line-label" htmlFor={fieldId(`${p}.discountPercent`)}>
                    {t('lines.discount')}
                  </label>
                  <DecimalInput
                    id={fieldId(`${p}.discountPercent`)}
                    value={l.discountPercent}
                    allowEmpty
                    onChange={(v) => update(i, { discountPercent: v == null || v === 0 ? undefined : Math.min(100, Math.max(0, v)) })}
                    disabled={disabled}
                    placeholder="0"
                  />
                </div>
              )}
              {showRates && (
                <div className="c-vat">
                  <label className="line-label" htmlFor={fieldId(`${p}.vatRate`)}>
                    {t('lines.vat')}
                  </label>
                  <select id={fieldId(`${p}.vatRate`)} value={String(l.vatRate)} onChange={(e) => update(i, { vatRate: Number(e.target.value) })} disabled={disabled}>
                    {vatRates(l.vatRate).map((r) => (
                      <option key={r} value={String(r)}>
                        {r}%
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="c-total num">
                <span className="line-label">{t('lines.total')} </span>
                {formatMoney(lt ? lt.net : 0, currency)}
              </div>
              {!disabled && (
                <div className="c-tools">
                  <button type="button" id={`line-up-${l.id}`} className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('lines.moveUp', { n: i + 1 })}>
                    ↑
                  </button>
                  <button type="button" id={`line-down-${l.id}`} className="icon-btn" onClick={() => move(i, 1)} disabled={i === lines.length - 1} aria-label={t('lines.moveDown', { n: i + 1 })}>
                    ↓
                  </button>
                  <button type="button" className="icon-btn icon-danger" onClick={() => remove(i)} aria-label={t('lines.remove', { n: i + 1 })}>
                    ×
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <datalist id="unit-suggestions-lines">
        {['tk', 'h', 'päev', 'kuu', 'km', 'kg', 'komplekt', 'teenus'].map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      {!disabled && (
        <div className="btn-row lines-actions">
          <button type="button" className="btn" onClick={add}>
            + {t('lines.add')}
          </button>
          {!discountCol && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowDiscount(true)}>
              {t('lines.addDiscount')}
            </button>
          )}
        </div>
      )}
      <TotalsTable totals={totals} currency={currency} />
    </div>
  )
}

export function TotalsTable({ totals, currency }: { totals: InvoiceTotals; currency: string }) {
  const { t } = useApp()
  return (
    <dl className="totals" aria-label={t('totals.title')}>
      {totals.showVat && (
        <>
          <div>
            <dt>{t('totals.net')}</dt>
            <dd data-testid="total-net">{formatMoney(totals.net, currency)}</dd>
          </div>
          {totals.vatBreakdown.map((row) => (
            <div key={row.rate}>
              <dt>{t('totals.vatRow', { rate: row.rate, taxable: formatMoney(row.taxable, currency) })}</dt>
              <dd>{formatMoney(row.vat, currency)}</dd>
            </div>
          ))}
        </>
      )}
      <div className="grand">
        <dt>{t('totals.gross')}</dt>
        <dd data-testid="total-gross">{formatMoney(totals.gross, currency)}</dd>
      </div>
    </dl>
  )
}
