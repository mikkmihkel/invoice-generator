import { PackageIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { newId, type Product } from '../../domain'
import { useApp } from '../AppContext'
import { Dialog, useConfirm } from '../components/Dialog'
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

/** Add or edit one catalogue item. */
export function ProductDialog({ initial, onClose }: { initial?: Product; onClose: () => void }) {
  const { t, profile } = useApp()
  const { products, save } = useProducts()
  const toast = useToast()
  const defaultRate = profile?.defaults.defaultVatRate ?? 24
  const [product, setProduct] = useState<Product>(() => initial ?? emptyProduct(profile?.defaults.defaultUnit ?? 'tk'))
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const showVat = profile?.vatRegistered !== false || product.vatRate != null

  const duplicate = findProduct(
    products.filter((p) => p.id !== product.id),
    product.description,
  )
  const descriptionError = submitted && !product.description.trim() ? t('products.descriptionRequired') : submitted && duplicate ? t('products.duplicate') : undefined

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (!product.description.trim() || duplicate) return
    setSaving(true)
    try {
      await save({ ...product, description: product.description.trim(), unit: product.unit.trim() })
      toast.success(t('common.saved'))
      onClose()
    } catch (err) {
      toast.error(t('common.saveFailed') + ' ' + errorMessage(err))
      setSaving(false)
    }
  }

  const formId = 'product-form-' + product.id
  return (
    <Dialog
      title={initial ? t('products.editTitle') : t('products.addTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      dismissible={!saving}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="stack-sm">
        <TextField
          label={t('products.description')}
          value={product.description}
          onChange={(description) => setProduct({ ...product, description })}
          error={descriptionError}
          required
          data-autofocus
          autoComplete="off"
        />
        <div className="grid product-grid">
          <TextField label={t('products.unit')} value={product.unit} onChange={(unit) => setProduct({ ...product, unit })} list="unit-suggestions-products" autoComplete="off" />
          <NumberField
            label={t('products.unitPrice')}
            value={product.unitPrice}
            onChange={(v) => setProduct({ ...product, unitPrice: roundTo(v ?? 0, 4) })}
            hint={t('products.unitPriceHint')}
          />
          {showVat && (
            <SelectField<string>
              label={t('products.vatRate')}
              value={product.vatRate == null ? '' : String(product.vatRate)}
              onChange={(v) => setProduct({ ...product, vatRate: v === '' ? undefined : Number(v) })}
              options={[{ value: '', label: t('products.vatDefault', { rate: defaultRate }) }, ...vatRates(product.vatRate).map((r) => ({ value: String(r), label: `${r}%` }))]}
            />
          )}
        </div>
        <datalist id="unit-suggestions-products">
          {UNIT_SUGGESTIONS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </form>
    </Dialog>
  )
}

export default function ProductsPage() {
  const { t, profile } = useApp()
  const { products, remove } = useProducts()
  const toast = useToast()
  const confirm = useConfirm()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ product?: Product } | null>(null)
  const defaultRate = profile?.defaults.defaultVatRate ?? 24
  const showVat = profile?.vatRegistered !== false || products.some((p) => p.vatRate != null)

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

  const addButton = (
    <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
      <PlusIcon />
      {t('products.add')}
    </button>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('products.title')}</h1>
          <p className="page-sub">{products.length > 0 ? t('products.count', { count: products.length }) : t('products.intro')}</p>
        </div>
        {products.length > 0 && <div className="btn-row">{addButton}</div>}
      </div>

      {products.length === 0 ? (
        <EmptyState icon={<PackageIcon size={28} />} title={t('products.emptyTitle')} actions={addButton}>
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
                  {list.map((p) => (
                    <tr key={p.id}>
                      <td className="col-name">
                        <span className="product-name">{p.description}</span>
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
                          <IconButton label={t('products.editNamed', { name: p.description })} icon={<PencilSimpleIcon />} onClick={() => setEditing({ product: p })} />
                          <IconButton className="icon-btn-danger" label={t('products.deleteNamed', { name: p.description })} icon={<TrashIcon />} onClick={() => void onDelete(p)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {editing && <ProductDialog initial={editing.product} onClose={() => setEditing(null)} />}
    </div>
  )
}
