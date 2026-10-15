import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useId, useMemo, useRef, useState } from 'react'
import type { Product } from '../../../domain'
import { formatUnitMoney } from '../../../pdf/format'
import { useApp } from '../../AppContext'
import { Dialog } from '../../components/Dialog'
import { DecimalInput } from '../../components/fields'
import { roundTo } from '../../util'
import { normalizeText, searchProducts } from '../products'

export interface CataloguePick {
  product: Product
  quantity: number
}

interface Props {
  products: readonly Product[]
  currency: string
  /** Show VAT rates (domestic invoices); `defaultVatRate` stands in for items without their own rate. */
  showVat: boolean
  defaultVatRate: number
  /** Descriptions already on the invoice (marked in the list). */
  onInvoice: readonly string[]
  onAdd: (picks: CataloguePick[]) => void
  onClose: () => void
}

/**
 * Choose one or several catalogue items and add them as invoice lines in one go. The search field filters;
 * Arrow keys move between items, Space selects, Enter adds the selection (or the focused / best match when
 * nothing is selected yet). A dialog on wide screens, a bottom sheet on phones.
 */
export function CataloguePicker({ products, currency, showVat, defaultVatRate, onInvoice, onAdd, onClose }: Props) {
  const { t } = useApp()
  const [query, setQuery] = useState('')
  // Insertion order = the order of the new lines.
  const [selected, setSelected] = useState<Map<string, number>>(() => new Map())
  const listRef = useRef<HTMLUListElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const formId = useId()
  const list = useMemo(() => searchProducts(products, query), [products, query])
  const used = useMemo(() => new Set(onInvoice.map(normalizeText)), [onInvoice])
  const cur = currency || 'EUR'

  const toggle = (p: Product, on: boolean) =>
    setSelected((m) => {
      const next = new Map(m)
      if (on) next.set(p.id, next.get(p.id) ?? 1)
      else next.delete(p.id)
      return next
    })
  const setQty = (id: string, q: number) => setSelected((m) => new Map(m).set(id, q))

  const add = (fallback?: Product) => {
    const byId = new Map(products.map((p) => [p.id, p]))
    const picks: CataloguePick[] = [...selected].flatMap(([id, quantity]) => {
      const product = byId.get(id)
      return product ? [{ product, quantity: quantity > 0 ? quantity : 1 }] : []
    })
    if (picks.length === 0 && fallback) picks.push({ product: fallback, quantity: 1 })
    if (picks.length > 0) onAdd(picks)
  }

  const boxes = () => Array.from(listRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      boxes()[0]?.focus()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      add(list[0])
    }
  }

  const onListKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const target = e.target as HTMLInputElement
    const all = boxes()
    const i = all.indexOf(target)
    if (e.key === 'Enter') {
      e.preventDefault()
      const product = i >= 0 ? list[i] : undefined
      add(product)
      return
    }
    if (i < 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      all[Math.min(i + 1, all.length - 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (i === 0) searchRef.current?.focus()
      else all[i - 1]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      all[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      all[all.length - 1]?.focus()
    }
  }

  const count = selected.size

  return (
    <Dialog
      title={t('catalogue.pickTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <span className="pick-count" aria-live="polite">
            {count > 0 ? t('catalogue.selected', { count }) : <span className="pick-keys">{t('catalogue.keyboardHint')}</span>}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={count === 0}>
            {count > 0 ? t('catalogue.addSelectedN', { count }) : t('catalogue.addSelected')}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="pick"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <div className="pick-search">
          <div className="search-field">
            <MagnifyingGlassIcon className="search-icon" />
            <input
              ref={searchRef}
              type="search"
              aria-label={t('catalogue.search')}
              placeholder={t('catalogue.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              autoComplete="off"
              data-autofocus
            />
          </div>
          {cur.toUpperCase() !== 'EUR' && <p className="pick-note">{t('catalogue.pricesAsIs', { currency: cur.toUpperCase() })}</p>}
        </div>
        {list.length === 0 ? (
          <p className="pick-empty">{t('products.noMatches')}</p>
        ) : (
          <ul ref={listRef} className="pick-list" aria-label={t('catalogue.listLabel')} onKeyDown={onListKey}>
            {list.map((p) => {
              const qty = selected.get(p.id)
              const checked = qty != null
              const rate = p.vatRate ?? defaultVatRate
              return (
                <li key={p.id} className={checked ? 'pick-item selected' : 'pick-item'}>
                  <label className="pick-main">
                    <input type="checkbox" checked={checked} onChange={(e) => toggle(p, e.target.checked)} />
                    <span className="pick-text">
                      <span className="pick-name">{p.description}</span>
                      <span className="pick-meta">
                        {p.unit && <span>{p.unit}</span>}
                        {showVat && <span>{t('products.vatShort', { rate })}</span>}
                        {used.has(normalizeText(p.description)) && <span className="pick-used">{t('catalogue.onInvoice')}</span>}
                      </span>
                    </span>
                    <span className="pick-price amount">{formatUnitMoney(p.unitPrice, cur, 'et')}</span>
                  </label>
                  {checked && (
                    <div className="pick-qty">
                      <DecimalInput
                        className="num"
                        value={qty}
                        onChange={(v) => setQty(p.id, roundTo(v ?? 0, 3))}
                        aria-label={t('catalogue.quantityFor', { name: p.description })}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          e.stopPropagation()
                          add()
                        }}
                      />
                      {p.unit && <span className="pick-unit">{p.unit}</span>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </form>
    </Dialog>
  )
}
