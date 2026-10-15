import { ArrowDownIcon, ArrowsClockwiseIcon, ArrowUpIcon, BookmarkSimpleIcon, CopyIcon, PackageIcon, PercentIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { newId, vatSchemeAllowsRates, type InvoiceLine, type InvoiceTotals, type Product, type VatScheme } from '../../../domain'
import { formatUnitMoney } from '../../../pdf/format'
import { useApp } from '../../AppContext'
import { useConfirm } from '../../components/Dialog'
import { DecimalInput, fieldId } from '../../components/fields'
import { MIN_POPUP_HEIGHT, verticalPlacement, visibleArea } from '../../components/menuPlacement'
import { IconButton, Menu, type MenuItem } from '../../components/ui'
import { formatDate, formatMoney } from '../../format'
import { UNIT_SUGGESTIONS, vatRates } from '../../options'
import { useToast } from '../../Toasts'
import { errorMessage, roundTo } from '../../util'
import { findProduct, invoicedLinesFor, lineMatches, lineSuggestions, productFromLine, productMatchesLine, useProducts, type BuyerRef, type LineSuggestion } from '../products'
import { CataloguePicker, type CataloguePick } from './CataloguePicker'

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
  /** Label of the grand total ("Krediteeritav summa" on credit notes). */
  grossLabel?: string
  /** The invoice's buyer: lines invoiced to them before are suggested with their last price. */
  buyer?: BuyerRef
  /**
   * Offer the catalogue actions ("Lisa kataloogist", saving lines as products). Default true; credit notes
   * pass false (their lines are negative copies of the credited invoice).
   */
  catalogue?: boolean
}

const PRODUCTS_HREF = '#/products'

/** A line with nothing typed in it yet (the empty line a new invoice starts with). */
const isBlank = (l: InvoiceLine) => !l.description.trim() && !l.unitPrice && !l.discountPercent

const focusById = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus())

/**
 * Spreadsheet-like line editor: Tab walks the cells in reading order, Enter in a cell of the last line adds
 * a new line (in other lines it moves down to the next description). Amounts are right-aligned tabular figures.
 */
export function LinesEditor({ lines, onChange, vatScheme, currency, totals, defaultUnit, defaultVatRate, disabled, grossLabel, buyer, catalogue = true }: Props) {
  const { t, invoices } = useApp()
  const { products, save: saveProduct } = useProducts()
  const toast = useToast()
  const confirm = useConfirm()
  const [picking, setPicking] = useState(false)
  const showRates = vatSchemeAllowsRates(vatScheme)
  const withCatalogue = catalogue && !disabled
  const { clientId, registryCode, name } = buyer ?? {}
  const history = useMemo(() => (disabled ? [] : invoicedLinesFor(invoices, { clientId, registryCode, name: name ?? '' }, currency)), [disabled, invoices, clientId, registryCode, name, currency])
  const [showDiscount, setShowDiscount] = useState(() => lines.some((l) => l.discountPercent))
  const addBtn = useRef<HTMLButtonElement>(null)
  const discountCol = showDiscount || lines.some((l) => l.discountPercent)
  const lineTotal = new Map(totals.lines.map((l) => [l.lineId, l]))

  const update = (i: number, patch: Partial<InvoiceLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= lines.length) return
    const next = [...lines]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
    focusById(`line-menu-${next[j].id}`)
  }
  const add = () => {
    const l = newLine(defaultUnit, showRates ? defaultVatRate : 0)
    onChange([...lines, l])
    focusById(fieldId(`lines.${lines.length}.description`))
  }
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i))
  const duplicate = (i: number) => {
    const copy = { ...lines[i], id: newId() }
    onChange([...lines.slice(0, i + 1), copy, ...lines.slice(i + 1)])
    focusById(fieldId(`lines.${i + 1}.description`))
  }

  /** New lines from the catalogue replace blank lines, so a new invoice does not keep its empty first line. */
  const addFromCatalogue = (picks: CataloguePick[]) => {
    const kept = lines.filter((l) => !isBlank(l))
    const added = picks.map(({ product, quantity }) => ({
      id: newId(),
      description: product.description,
      quantity,
      unit: product.unit || defaultUnit,
      unitPrice: product.unitPrice,
      vatRate: showRates ? (product.vatRate ?? defaultVatRate) : 0,
    }))
    onChange([...kept, ...added])
    setPicking(false)
    focusById(fieldId(`lines.${kept.length}.quantity`))
  }

  const pick = (i: number, s: LineSuggestion) => {
    const vatRate = showRates ? (s.vatRate ?? (s.source === 'catalogue' ? defaultVatRate : lines[i].vatRate)) : lines[i].vatRate
    update(i, { description: s.description, unit: s.unit || lines[i].unit, unitPrice: s.unitPrice, vatRate })
  }

  const describe = (p: Pick<Product, 'unit' | 'unitPrice' | 'vatRate'>) =>
    [formatUnitMoney(p.unitPrice, 'EUR', 'et') + (p.unit ? ` / ${p.unit}` : ''), showRates ? t('products.vatShort', { rate: p.vatRate ?? defaultVatRate }) : ''].filter(Boolean).join(', ')

  /** Save the line as a catalogue item; replacing an existing item with different details asks first. */
  const saveToCatalogue = async (l: InvoiceLine) => {
    if (!l.description.trim()) {
      toast.info(t('products.lineEmpty'))
      return
    }
    const existing = findProduct(products, l.description)
    if (existing && productMatchesLine(existing, l, showRates ? defaultVatRate : null)) {
      toast.info(t('catalogue.alreadySaved', { name: existing.description }))
      return
    }
    if (existing) {
      const ok = await confirm({
        title: t('products.updateTitle', { name: existing.description }),
        message: t('products.updateConfirm', { old: describe(existing), new: describe(l) }),
        confirmLabel: t('products.updateAction'),
        cancelLabel: t('common.cancel'),
      })
      if (!ok) return
    }
    try {
      const product = productFromLine(l, existing, showRates)
      await saveProduct(product)
      const action = { label: t('catalogue.openProducts'), onClick: () => void (window.location.hash = PRODUCTS_HREF) }
      toast.success(t(existing ? 'products.updatedInCatalogue' : 'products.savedToCatalogue', { name: product.description }), action)
    } catch (e) {
      toast.error(t('common.saveFailed') + ' ' + errorMessage(e))
    }
  }

  const lineMenu = (l: InvoiceLine, i: number, product: Product | undefined): MenuItem[] => {
    const items: MenuItem[] = []
    if (withCatalogue) {
      const same = product && productMatchesLine(product, l, showRates ? defaultVatRate : null)
      if (!same)
        items.push({
          key: 'catalogue',
          label: product ? t('products.updateInCatalogue') : t('products.saveToCatalogue'),
          icon: product ? <ArrowsClockwiseIcon /> : <BookmarkSimpleIcon />,
          onSelect: () => void saveToCatalogue(l),
          disabled: !l.description.trim(),
        })
    }
    items.push(
      { key: 'duplicate', label: t('lines.duplicate'), icon: <CopyIcon />, onSelect: () => duplicate(i) },
      { key: 'up', label: t('lines.moveUpShort'), icon: <ArrowUpIcon />, onSelect: () => move(i, -1), disabled: i === 0, separatorBefore: true },
      { key: 'down', label: t('lines.moveDownShort'), icon: <ArrowDownIcon />, onSelect: () => move(i, 1), disabled: i === lines.length - 1 },
    )
    return items
  }

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
          const product = withCatalogue && l.description.trim() ? findProduct(products, l.description) : undefined
          return (
            <li key={l.id} className="line" aria-label={t('lines.lineN', { n: i + 1 })} onKeyDown={onCellKey(i)}>
              <div className="c-desc">
                <label className="line-label" htmlFor={fieldId(`${p}.description`)}>
                  {/* Each read-only card is already labelled with its row ("Rida 1"). */}
                  {disabled ? t('lines.description') : `${t('lines.description')} ${i + 1}`}
                </label>
                <DescriptionCell
                  id={fieldId(`${p}.description`)}
                  line={l}
                  currency={currency}
                  onChange={(description) => update(i, { description })}
                  onPick={(s) => pick(i, s)}
                  suggest={(q) => lineSuggestions(q, history, products)}
                  disabled={disabled}
                  placeholder={disabled ? undefined : t('lines.descriptionPlaceholder')}
                  marker={product && <CatalogueMarker line={l} product={product} details={describe(product)} defaultVatRate={showRates ? defaultVatRate : null} />}
                />
                {withCatalogue && !product && isSaveable(l) && (
                  <button type="button" className="line-cat-save" onClick={() => void saveToCatalogue(l)}>
                    <BookmarkSimpleIcon size={12} />
                    {t('catalogue.saveAsProduct')}
                  </button>
                )}
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
                {disabled ? (
                  <output id={fieldId(`${p}.unitPrice`)} className="cell num cell-ro">
                    {formatUnitMoney(l.unitPrice, currency || 'EUR', 'et')}
                  </output>
                ) : (
                  <DecimalInput id={fieldId(`${p}.unitPrice`)} className="cell num" value={l.unitPrice} onChange={(v) => update(i, { unitPrice: roundTo(v ?? 0, PRICE_DECIMALS) })} />
                )}
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
                  <Menu id={`line-menu-${l.id}`} small label={t('lines.menu', { n: i + 1 })} items={lineMenu(l, i, product)} />
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
          <div className="lines-foot-main">
            <div className="lines-actions">
              <button ref={addBtn} type="button" className="ed-text-btn" onClick={add} title={t('lines.enterHint')}>
                <PlusIcon />
                {t('lines.add')}
              </button>
              {withCatalogue && products.length > 0 && (
                <button type="button" className="ed-text-btn" onClick={() => setPicking(true)} aria-haspopup="dialog">
                  <PackageIcon />
                  {t('catalogue.add')}
                </button>
              )}
              {!discountCol && (
                <button
                  type="button"
                  className="ed-text-btn ed-text-btn-quiet"
                  onClick={() => {
                    // The button disappears with the click: move focus to the first discount field instead of <body>.
                    setShowDiscount(true)
                    requestAnimationFrame(() => (document.getElementById(fieldId('lines.0.discountPercent')) ?? addBtn.current)?.focus())
                  }}
                >
                  <PercentIcon />
                  {t('lines.addDiscount')}
                </button>
              )}
            </div>
            {withCatalogue && products.length === 0 && (
              <p className="lines-hint">
                {t('catalogue.emptyHint')} <a href={PRODUCTS_HREF}>{t('catalogue.openProducts')}</a>
              </p>
            )}
          </div>
        )}
        <TotalsTable totals={totals} currency={currency} grossLabel={grossLabel} />
      </div>
      {picking && (
        <CataloguePicker
          products={products}
          currency={currency}
          showVat={showRates}
          defaultVatRate={defaultVatRate}
          onInvoice={lines.map((l) => l.description)}
          onAdd={addFromCatalogue}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}

/** Filled enough to be worth keeping in the catalogue (credit note lines are negative and never qualify). */
const isSaveable = (l: InvoiceLine) => !!l.description.trim() && l.unitPrice > 0 && l.quantity > 0

/**
 * Inside the description field: the line is in the catalogue, with a visible "differs" when its details are not the
 * catalogue's. A toggletip: focusing or tapping it shows the catalogue's values, Escape or leaving it hides them.
 */
function CatalogueMarker({ line, product, details, defaultVatRate }: { line: InvoiceLine; product: Product; details: string; defaultVatRate: number | null }) {
  const { t } = useApp()
  const [open, setOpen] = useState(false)
  const tipId = useId()
  const differs = !productMatchesLine(product, line, defaultVatRate)
  const label = differs ? t('catalogue.inCatalogueDiffers') : t('catalogue.inCatalogue')
  return (
    <span className={`line-cat-mark${differs ? ' differs' : ''}`}>
      <button
        type="button"
        className="line-cat-btn"
        aria-expanded={open}
        aria-controls={tipId}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      >
        <PackageIcon size={14} aria-hidden="true" />
        <span className="visually-hidden">{label}</span>
        {differs && (
          <span className="line-cat-differs" aria-hidden="true">
            {t('catalogue.differsShort')}
          </span>
        )}
      </button>
      <span id={tipId} role="status" className="line-cat-tip" hidden={!open}>
        {open && t('catalogue.catalogueValues', { details })}
      </span>
    </span>
  )
}

interface DescriptionCellProps {
  id: string
  line: InvoiceLine
  currency: string
  onChange: (description: string) => void
  onPick: (s: LineSuggestion) => void
  suggest: (query: string) => LineSuggestion[]
  disabled?: boolean
  /** Shown at the field's end, e.g. the catalogue marker. */
  marker?: React.ReactNode
  placeholder?: string
}

/**
 * Line description with suggestions (the buyer's earlier lines and the catalogue). The textarea keeps its
 * textbox role (descriptions may span lines) and drives a listbox through aria-activedescendant: Arrow keys
 * move, Enter chooses, Escape closes. Enter without an active suggestion behaves as before.
 */
function DescriptionCell({ id, line, currency, onChange, onPick, suggest, disabled, placeholder, marker }: DescriptionCellProps) {
  const { t } = useApp()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = id + '-suggestions'
  const items = useMemo(() => (open && !disabled ? suggest(line.description).filter((s) => !lineMatches(line, s)) : []), [open, disabled, suggest, line])
  const shown = items.length > 0
  const current = active < items.length ? active : -1
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // On phones the editor's summary bar and the tab bar are pinned to the bottom: open the list above the field
  // when it would otherwise end up behind them.
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const list = listRef.current
    if (!shown || !wrap || !list) return
    const place = () => {
      list.removeAttribute('data-side')
      list.style.maxHeight = ''
      const { above, maxHeight } = verticalPlacement(wrap.getBoundingClientRect(), visibleArea(), list.getBoundingClientRect().height)
      if (above) list.setAttribute('data-side', 'above')
      list.style.maxHeight = `min(360px, ${maxHeight}px)`
    }
    place()
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [shown, items.length])

  /** Bring the field up from behind the bottom bars, with room for a few suggestions below it. */
  const onFocus = () => {
    const wrap = wrapRef.current
    if (!wrap) return
    const area = visibleArea()
    const r = wrap.getBoundingClientRect()
    if (r.top < area.top || r.bottom + Math.min(MIN_POPUP_HEIGHT, (area.bottom - area.top) / 3) > area.bottom) wrap.scrollIntoView?.({ block: 'center' })
  }

  const close = () => {
    setOpen(false)
    setActive(-1)
  }
  const choose = (s: LineSuggestion) => {
    onPick(s)
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      return
    }
    if (!shown) {
      // A single-line description: ArrowDown opens the list (in multi-line text it keeps moving the caret).
      if (e.key === 'ArrowDown' && !e.shiftKey && !line.description.includes('\n') && suggest(line.description).some((s) => !lineMatches(line, s))) {
        e.preventDefault()
        setOpen(true)
        setActive(0)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1 >= items.length ? 0 : a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1))
    } else if (e.key === 'Enter' && !e.shiftKey && current >= 0) {
      e.preventDefault()
      e.stopPropagation()
      choose(items[current])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') close()
  }

  const firstCatalogue = items.findIndex((s) => s.source === 'catalogue')
  // Catalogue prices have no currency and are used as they are, also on a foreign-currency invoice.
  const catalogueHeading = (currency || 'EUR').toUpperCase() === 'EUR' ? t('products.fromCatalogue') : t('products.fromCatalogueAsIs')

  return (
    <div className="line-desc" ref={wrapRef}>
      <textarea
        id={id}
        className="cell"
        rows={1}
        value={line.description}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(e.target.value.trim() !== '')
          setActive(-1)
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
        onFocus={disabled ? undefined : onFocus}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete={disabled ? undefined : 'list'}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && current >= 0 ? `${listId}-${current}` : undefined}
      />
      {marker}
      {shown && (
        <ul ref={listRef} id={listId} role="listbox" className="combo-list line-suggestions" aria-label={t('products.suggestions')}>
          {items.map((s, i) => (
            <SuggestionOption
              key={s.key}
              id={`${listId}-${i}`}
              s={s}
              currency={currency}
              active={i === current}
              heading={i === 0 && s.source === 'history' ? t('products.fromHistory') : i === firstCatalogue ? catalogueHeading : undefined}
              onHover={() => setActive(i)}
              onChoose={() => choose(s)}
            />
          ))}
        </ul>
      )}
      <span className="visually-hidden" aria-live="polite">
        {shown ? t('products.suggestionsCount', { count: items.length }) : ''}
      </span>
    </div>
  )
}

function SuggestionOption({ id, s, currency, active, heading, onHover, onChoose }: { id: string; s: LineSuggestion; currency: string; active: boolean; heading?: string; onHover: () => void; onChoose: () => void }) {
  const { t } = useApp()
  return (
    <>
      {heading && (
        <li role="presentation" className="combo-group">
          {heading}
        </li>
      )}
      <li
        id={id}
        role="option"
        aria-selected={active}
        className={active ? 'combo-opt active' : 'combo-opt'}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={onHover}
        onClick={onChoose}
      >
        <span className="opt-name">{s.description}</span>
        <span className="opt-meta">
          <span className="amount">
            {formatUnitMoney(s.unitPrice, currency || 'EUR', 'et')}
            {s.unit ? ` / ${s.unit}` : ''}
          </span>
          {s.vatRate != null && <span>{t('products.vatShort', { rate: s.vatRate })}</span>}
          {s.invoiceNumber && <span>{t('products.lastInvoiced', { number: s.invoiceNumber, date: formatDate(s.issueDate) })}</span>}
        </span>
      </li>
    </>
  )
}

export function TotalsTable({ totals, currency, grossLabel }: { totals: InvoiceTotals; currency: string; grossLabel?: string }) {
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
        <dt>{grossLabel ?? t('totals.gross')}</dt>
        <dd data-testid="total-gross">{formatMoney(totals.gross, currency)}</dd>
      </div>
    </dl>
  )
}
