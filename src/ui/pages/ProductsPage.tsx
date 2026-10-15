import { CheckCircleIcon, PackageIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState } from 'react'
import { newId, type Product } from '../../domain'
import { useApp } from '../AppContext'
import { useConfirm } from '../components/Dialog'
import { NumberField, SelectField, TextField } from '../components/fields'
import { EmptyState, IconButton, SearchField } from '../components/ui'
import { formatUnitMoney } from '../../pdf/format'
import { UNIT_SUGGESTIONS, vatRates } from '../options'
import { useToast } from '../Toasts'
import { errorMessage, nowISO, roundTo } from '../util'
import { findProduct, normalizeText, useProducts } from './products'

function emptyProduct(unit: string): Product {
  const now = nowISO()
  return { id: newId(), description: '', unit, unitPrice: 0, createdAt: now, updatedAt: now }
}

/**
 * One catalogue item as a single row of fields: the quick-add row above the list (it clears itself after each
 * save, so several items can be entered in a row) and the inline editor of a list row (Escape cancels).
 */
function ProductForm({ initial, onDone, showVat }: { initial?: Product; onDone?: () => void; showVat: boolean }) {
  const { t, profile } = useApp()
  const { products, save } = useProducts()
  const toast = useToast()
  const editing = !!initial
  const defaultUnit = profile?.defaults.defaultUnit ?? 'tk'
  const defaultRate = profile?.defaults.defaultVatRate ?? 24
  const [product, setProduct] = useState<Product>(() => initial ?? emptyProduct(defaultUnit))
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  // Quick add: the new row shows up in the list; screen readers hear it here (no toast for every item).
  const [announce, setAnnounce] = useState('')
  const descId = useId()
  // The confirmation under the quick-add row fades after a few seconds.
  useEffect(() => {
    if (!announce) return
    const timer = setTimeout(() => setAnnounce(''), 4000)
    return () => clearTimeout(timer)
  }, [announce])
  // The unit field's suggestion list may be open: its first Escape only closes the list, not the whole edit.
  const unitSuggesting = useRef(false)
  const focusDescription = () => document.getElementById(descId)?.focus()
  const withVat = showVat || product.vatRate != null

  const duplicate = findProduct(
    products.filter((p) => p.id !== product.id),
    product.description,
  )
  const descriptionError = submitted && !product.description.trim() ? t('products.descriptionRequired') : submitted && duplicate ? t('products.duplicate') : undefined

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (!product.description.trim() || duplicate) {
      focusDescription()
      return
    }
    setSaving(true)
    try {
      const saved = { ...product, description: product.description.trim(), unit: product.unit.trim(), updatedAt: nowISO() }
      await save(saved)
      if (editing) {
        toast.success(t('common.saved'))
        onDone?.()
        return
      }
      setAnnounce(t('products.added', { name: saved.description }))
      setProduct(emptyProduct(defaultUnit))
      setSubmitted(false)
      setSaving(false)
      focusDescription()
    } catch (err) {
      toast.error(t('common.saveFailed') + ' ' + errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <form
      className={`product-form${editing ? ' product-form-edit' : ''}${withVat ? ' with-vat' : ''}`}
      onSubmit={submit}
      noValidate
      aria-label={editing ? t('products.editNamed', { name: initial.description }) : t('products.addTitle')}
      onKeyDown={(e) => {
        if (!editing || e.key !== 'Escape') return
        if (e.target instanceof HTMLInputElement && e.target.list && unitSuggesting.current) {
          unitSuggesting.current = false
          return
        }
        e.preventDefault()
        onDone?.()
      }}
    >
      <TextField
        id={descId}
        className="pf-desc"
        label={t('products.description')}
        value={product.description}
        onChange={(description) => {
          // A shown error is about what was submitted: it goes once the text changes.
          setSubmitted(false)
          setProduct({ ...product, description })
        }}
        onBlur={() => {
          if (!product.description.trim()) setSubmitted(false)
        }}
        error={descriptionError}
        autoComplete="off"
        autoFocus={editing}
      />
      <TextField
        className="pf-unit"
        label={t('products.unit')}
        value={product.unit}
        onChange={(unit) => {
          unitSuggesting.current = true
          setProduct({ ...product, unit })
        }}
        onMouseDown={() => {
          unitSuggesting.current = true
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') unitSuggesting.current = true
        }}
        onBlur={() => {
          unitSuggesting.current = false
        }}
        list="unit-suggestions-products"
        autoComplete="off"
      />
      <NumberField className="pf-price" label={t('products.unitPrice')} value={product.unitPrice} onChange={(v) => setProduct({ ...product, unitPrice: roundTo(v ?? 0, 4) })} />
      {withVat && (
        <SelectField<string>
          className="pf-vat"
          label={t('products.vatRate')}
          value={product.vatRate == null ? '' : String(product.vatRate)}
          onChange={(v) => setProduct({ ...product, vatRate: v === '' ? undefined : Number(v) })}
          options={[{ value: '', label: t('products.vatDefault', { rate: defaultRate }) }, ...vatRates(product.vatRate).map((r) => ({ value: String(r), label: `${r}%` }))]}
        />
      )}
      {!editing && (
        <span className="visually-hidden" aria-live="polite">
          {announce}
        </span>
      )}
      <div className="pf-actions">
        {/* Keeps the buttons level with the inputs, under the labels. */}
        <span className="label" aria-hidden="true">
          &nbsp;
        </span>
        <div className="btn-row">
          {editing ? (
            <>
              <button type="button" className="btn" onClick={onDone} disabled={saving}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <PlusIcon />
              {t('products.quickAdd')}
            </button>
          )}
        </div>
      </div>
      {!editing && announce && (
        <p className="pf-added small tone-success" aria-hidden="true">
          <CheckCircleIcon />
          {announce}
        </p>
      )}
    </form>
  )
}

export default function ProductsPage() {
  const { t, profile } = useApp()
  const { products, remove } = useProducts()
  const toast = useToast()
  const confirm = useConfirm()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const defaultRate = profile?.defaults.defaultVatRate ?? 24
  const showVat = profile?.vatRegistered !== false || products.some((p) => p.vatRate != null)
  const cols = showVat ? 5 : 4

  const q = normalizeText(query)
  const list = q ? products.filter((p) => normalizeText(`${p.description} ${p.unit}`).includes(q)) : products

  const onDelete = async (p: Product) => {
    const ok = await confirm({
      title: t('products.deleteTitle', { name: p.description }),
      message: t('products.deleteConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok) return
    try {
      await remove(p.id)
      toast.success(t('products.deleted'))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const stopEditing = (id: string) => {
    setEditing(null)
    requestAnimationFrame(() => document.getElementById(`product-edit-${id}`)?.focus())
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('products.title')}</h1>
          <p className="page-sub">{products.length > 0 ? t('products.count', { count: products.length }) : t('products.intro')}</p>
        </div>
      </div>

      <section className="panel product-quick" aria-labelledby="product-quick-title">
        <h2 id="product-quick-title" className="panel-title">
          {t('products.addTitle')}
        </h2>
        <ProductForm showVat={showVat} />
      </section>
      <datalist id="unit-suggestions-products">
        {UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      {products.length === 0 ? (
        <EmptyState icon={<PackageIcon size={28} />} title={t('products.emptyTitle')}>
          <p>{t('products.emptyText')}</p>
        </EmptyState>
      ) : (
        <>
          <div className="list-toolbar">
            <SearchField value={query} onChange={setQuery} label={t('products.search')} shortcutHint={t('common.searchShortcut')} />
            {q && <span className="toolbar-note">{t('list.shown', { count: list.length })}</span>}
          </div>
          {list.length === 0 ? (
            <div className="panel empty-filter">
              <p>{t('products.noMatches')}</p>
              <button type="button" className="btn btn-sm" onClick={() => setQuery('')}>
                {t('list.clearFilters')}
              </button>
            </div>
          ) : (
            <div className="panel table-panel">
              <table className="ledger product-table">
                <thead>
                  <tr>
                    <th scope="col">{t('products.description')}</th>
                    <th scope="col" className="col-unit">
                      {t('products.unit')}
                    </th>
                    <th scope="col" className="num col-price">
                      {t('lines.unitPrice')}
                    </th>
                    {showVat && (
                      <th scope="col" className="num col-vat">
                        {t('lines.vat')}
                      </th>
                    )}
                    <th scope="col" className="col-actions">
                      <span className="visually-hidden">{t('list.colActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) =>
                    editing === p.id ? (
                      <tr key={p.id} className="product-editing">
                        <td colSpan={cols}>
                          <ProductForm initial={p} showVat={showVat} onDone={() => stopEditing(p.id)} />
                        </td>
                      </tr>
                    ) : (
                      <tr key={p.id}>
                        <td className="col-name">
                          <button type="button" className="name-btn product-name" onClick={() => setEditing(p.id)} title={t('products.editNamed', { name: p.description })}>
                            {p.description}
                          </button>
                        </td>
                        <td className="col-unit">{p.unit}</td>
                        <td className="num col-price">{formatUnitMoney(p.unitPrice, 'EUR', 'et')}</td>
                        {showVat && (
                          <td className="num col-vat" title={p.vatRate == null ? t('products.vatDefault', { rate: defaultRate }) : undefined}>
                            {p.vatRate ?? defaultRate}%
                          </td>
                        )}
                        <td className="col-actions">
                          <div className="row-actions row-actions-visible">
                            <IconButton id={`product-edit-${p.id}`} label={t('products.editNamed', { name: p.description })} icon={<PencilSimpleIcon />} onClick={() => setEditing(p.id)} />
                            <IconButton className="icon-btn-danger" label={t('products.deleteNamed', { name: p.description })} icon={<TrashIcon />} onClick={() => void onDelete(p)} />
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
