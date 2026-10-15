import { ArrowDownIcon, ArrowUpIcon, PercentIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { newId, vatSchemeAllowsRates, type InvoiceLine, type InvoiceTotals, type VatScheme } from '../../../domain'
import { useApp } from '../../AppContext'
import { DecimalInput, fieldId } from '../../components/fields'
import { IconButton } from '../../components/ui'
import { formatMoney } from '../../format'
import { UNIT_SUGGESTIONS, vatRates } from '../../options'
import { roundTo } from '../../util'

// Same precision as the PDF prints (quantity 3, unit price 4 decimals), so printed qty × price matches the line total.
const QTY_DECIMALS = 3
const PRICE_DECIMALS = 4
const DISCOUNT_DECIMALS = 2

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

const focusById = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus())

/**
 * Spreadsheet-like line editor: Tab walks the cells in reading order, Enter in a cell of the last line adds
 * a new line (in other lines it moves down to the next description). Amounts are right-aligned tabular figures.
 */
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
    focusById(`line-${dir < 0 ? 'up' : 'down'}-${next[j].id}`)
  }
  const add = () => {
    const l = newLine(defaultUnit, showRates ? defaultVatRate : 0)
    onChange([...lines, l])
    focusById(fieldId(`lines.${lines.length}.description`))
  }
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i))

  const onCellKey = (i: number) => (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
    const target = e.target as HTMLElement
    if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return
    e.preventDefault()
    if (i === lines.length - 1) add()
    else focusById(fieldId(`lines.${i + 1}.description`))
  }

  const cls = `lines${showRates ? ' with-vat' : ''}${discountCol ? ' with-discount' : ''}${disabled ? ' lines-readonly' : ''}`

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
            <li key={l.id} className="line" aria-label={t('lines.lineN', { n: i + 1 })} onKeyDown={onCellKey(i)}>
              <div className="c-desc">
                <label className="line-label" htmlFor={fieldId(`${p}.description`)}>
                  {t('lines.description')} {i + 1}
                </label>
                <textarea
                  id={fieldId(`${p}.description`)}
                  className="cell"
                  rows={1}
                  value={l.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                  disabled={disabled}
                  placeholder={disabled ? undefined : t('lines.descriptionPlaceholder')}
                />
              </div>
              <div className="c-qty">
                <label className="line-label" htmlFor={fieldId(`${p}.quantity`)}>
                  {t('lines.quantity')}
                </label>
                <DecimalInput id={fieldId(`${p}.quantity`)} className="cell num" value={l.quantity} onChange={(v) => update(i, { quantity: roundTo(v ?? 0, QTY_DECIMALS) })} disabled={disabled} />
              </div>
              <div className="c-unit">
                <label className="line-label" htmlFor={fieldId(`${p}.unit`)}>
                  {t('lines.unit')}
                </label>
                <input id={fieldId(`${p}.unit`)} className="cell" type="text" list="unit-suggestions-lines" value={l.unit} onChange={(e) => update(i, { unit: e.target.value })} disabled={disabled} />
              </div>
              <div className="c-price">
                <label className="line-label" htmlFor={fieldId(`${p}.unitPrice`)}>
                  {t('lines.unitPrice')}
                </label>
                <DecimalInput id={fieldId(`${p}.unitPrice`)} className="cell num" value={l.unitPrice} onChange={(v) => update(i, { unitPrice: roundTo(v ?? 0, PRICE_DECIMALS) })} disabled={disabled} />
              </div>
              {discountCol && (
                <div className="c-disc">
                  <label className="line-label" htmlFor={fieldId(`${p}.discountPercent`)}>
                    {t('lines.discount')}
                  </label>
                  <DecimalInput
                    id={fieldId(`${p}.discountPercent`)}
                    className="cell num"
                    value={l.discountPercent}
                    allowEmpty
                    onChange={(v) => update(i, { discountPercent: v == null || v === 0 ? undefined : roundTo(Math.min(100, Math.max(0, v)), DISCOUNT_DECIMALS) })}
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
                  <select id={fieldId(`${p}.vatRate`)} className="cell num" value={String(l.vatRate)} onChange={(e) => update(i, { vatRate: Number(e.target.value) })} disabled={disabled}>
                    {vatRates(l.vatRate).map((r) => (
                      <option key={r} value={String(r)}>
                        {r}%
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="c-total">
                <span className="line-label">{t('lines.total')} </span>
                <span className="amount">{formatMoney(lt ? lt.net : 0, currency)}</span>
              </div>
              {!disabled && (
                <div className="c-tools">
                  <IconButton id={`line-up-${l.id}`} className="icon-btn-sm" onClick={() => move(i, -1)} disabled={i === 0} label={t('lines.moveUp', { n: i + 1 })} icon={<ArrowUpIcon size={14} />} />
                  <IconButton id={`line-down-${l.id}`} className="icon-btn-sm" onClick={() => move(i, 1)} disabled={i === lines.length - 1} label={t('lines.moveDown', { n: i + 1 })} icon={<ArrowDownIcon size={14} />} />
                  <IconButton className="icon-btn-sm icon-btn-danger" onClick={() => remove(i)} label={t('lines.remove', { n: i + 1 })} icon={<XIcon size={14} />} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <datalist id="unit-suggestions-lines">
        {UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <div className="lines-foot">
        {!disabled && (
          <div className="lines-actions">
            <button type="button" className="ed-text-btn" onClick={add} title={t('lines.enterHint')}>
              <PlusIcon />
              {t('lines.add')}
            </button>
            {!discountCol && (
              <button type="button" className="ed-text-btn ed-text-btn-quiet" onClick={() => setShowDiscount(true)}>
                <PercentIcon />
                {t('lines.addDiscount')}
              </button>
            )}
          </div>
        )}
        <TotalsTable totals={totals} currency={currency} />
      </div>
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
