import { ArrowsClockwiseIcon, FileTextIcon, PlusIcon, ReceiptIcon, UserPlusIcon } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { computeTotals, isVoided, nextRecurring, quoteStatus, recurringOverview, type Invoice, type QuoteStatus } from '../../domain'
import { useApp } from '../AppContext'
import type { MessageKey } from '../i18n'
import { EmptyState, SearchField, Segmented } from '../components/ui'
import { formatDate, formatMoney } from '../format'
import { daysBetween, displayStatus, getLastBackupAt, isUnpaid, localTodayISO, normalizeInvoice, sumByCurrency, type DisplayStatus } from '../util'
import { InvoiceDetail } from './invoice-detail/InvoiceDetail'
import { rowStatus, settlementOf, type Settlement } from './invoice-detail/status'
import { interpolate, joinSums } from './invoice-detail/text'
import { attentionGroups, type AttentionGroup, type AttentionKey } from './list/attention'
import { AttentionStrip } from './list/AttentionStrip'
import { Highlight } from './list/Highlight'
import { RecurringPanel } from './list/RecurringPanel'
import { searchInvoice, type SearchField as HitField, type SearchHit } from './list/search'

type Kind = 'invoices' | 'quotes'
type MainFilter = 'all' | 'unpaid' | 'overdue' | 'draft'
type ExtraFilter = 'overdue' | 'paid' | 'cancelled' | 'recurring'
type QuoteMain = 'all' | 'sent' | 'draft'
type QuoteExtra = 'accepted' | 'expired' | 'cancelled'
/** Filters set from the "needs attention" strip (drafts use the ordinary drafts filter). */
type AttentionFilter = 'remind' | 'unsent' | 'expiring'
type StatusFilter = MainFilter | ExtraFilter | QuoteMain | QuoteExtra | AttentionFilter
const ATTENTION_FILTER: Record<AttentionKey, StatusFilter> = { overdue: 'remind', unsent: 'unsent', quotes: 'expiring', drafts: 'draft' }
const ATTENTION_FILTERS: readonly StatusFilter[] = ['remind', 'unsent', 'expiring']
const EXTRA: ExtraFilter[] = ['overdue', 'paid', 'cancelled']
const QUOTE_EXTRA: QuoteExtra[] = ['accepted', 'expired', 'cancelled']

/** Fields not visible in a row: a search hit in one of them is shown under the row with this label. */
const HIDDEN_FIELD: Partial<Record<HitField, MessageKey>> = {
  registryCode: 'field.registryCode',
  reference: 'field.referenceNumber',
  orderReference: 'field.orderReference',
  email: 'field.email',
  line: 'search.line',
  net: 'totals.net',
}

interface Row {
  inv: Invoice
  status: DisplayStatus
  /** Quotes only. */
  quote?: QuoteStatus
  gross: number
  net: number
  /** Credit notes against the row's invoice and what is still owed after them. */
  settle: Settlement
  unpaid: boolean
}

function matches(r: Row, status: StatusFilter): boolean {
  if (status === 'all') return true
  if (r.quote) return r.quote === status
  if (status === 'unpaid') return r.unpaid
  return r.status === status
}

/** Status word of a quote row: "Kehtib kuni 26.10.2026", "Aegunud", "Aktsepteeritud"… */
function quoteRowStatus(r: Row, t: ReturnType<typeof useApp>['t']): { text: string; tone: string } {
  switch (r.quote) {
    case 'sent':
      return { text: r.inv.validUntil ? t('quote.validTill', { date: formatDate(r.inv.validUntil) }) : t('quote.status.issued'), tone: 'neutral' }
    case 'accepted':
      return { text: t('quote.status.accepted'), tone: 'success' }
    case 'expired':
      return { text: t('quote.status.expired'), tone: 'warn' }
    default:
      return { text: t(`quote.status.${r.quote ?? 'draft'}`), tone: 'muted' }
  }
}

/** "oktoober 2026" → "Oktoober 2026". */
function monthLabel(ym: string, lang: 'et' | 'en'): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ''
  const s = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'et-EE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ym + '-01T00:00:00Z'))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const PHONE_QUERY = '(max-width: 767px)'
const isPhone = () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches

function usePhone(): boolean {
  const [phone, setPhone] = useState(isPhone)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(PHONE_QUERY)
    const on = () => setPhone(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return phone
}

/** Arved: the receivables sentence, a quiet filter, month-grouped rows and the selected invoice beside them. */
export default function InvoiceList() {
  const { t, lang, invoices, invoiceEvents, recurringRules } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const today = localTodayISO()
  const thisYear = today.slice(0, 4)
  const [kindChoice, setKind] = useState<Kind | null>(params.get('kind') === 'quotes' ? 'quotes' : null)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [year, setYear] = useState<string>('all')
  const [query, setQuery] = useState('')
  const detailRef = useRef<HTMLDivElement>(null)
  const [focusId, setFocusId] = useState<string | null>(null)

  // Normalized so a malformed stored record (old / hand-edited backup) still renders as a row.
  const rows = useMemo<Row[]>(() => {
    const all = invoices.map(normalizeInvoice)
    return all.map((inv) => ({
      inv,
      status: displayStatus(inv, today, all),
      quote: inv.type === 'quote' ? quoteStatus(inv, today, all) : undefined,
      ...(({ gross, net }) => ({ gross, net }))(computeTotals(inv)),
      settle: settlementOf(inv, all),
      unpaid: isUnpaid(inv, all),
    }))
  }, [invoices, today])

  const explicitId = params.get('id')
  const explicit = explicitId ? rows.find((r) => r.inv.id === explicitId) : undefined
  // A selected quote opens the quotes view; otherwise the user's choice, invoices by default.
  const kind: Kind = kindChoice ?? (explicit?.quote ? 'quotes' : 'invoices')
  const hasQuotes = rows.some((r) => r.quote)
  const kindRows = useMemo(() => rows.filter((r) => (kind === 'quotes') === !!r.quote), [rows, kind])
  const invoiceRows = useMemo(() => rows.filter((r) => !r.quote), [rows])

  const recurring = useMemo(() => recurringOverview(recurringRules, invoices), [recurringRules, invoices])
  const nextRule = useMemo(() => nextRecurring(recurringRules, invoices), [recurringRules, invoices])
  const recurringIds = useMemo(() => new Set([...recurring.active, ...recurring.paused].map((e) => e.source.id)), [recurring])
  const attention = useMemo(() => attentionGroups(rows.map((r) => r.inv), invoiceEvents, today), [rows, invoiceEvents, today])
  const attentionIdsBy = useMemo(() => new Map(attention.map((g) => [ATTENTION_FILTER[g.key], new Set(g.docs.map((d) => d.id))])), [attention])

  const years = useMemo(() => [...new Set(kindRows.map((r) => r.inv.issueDate.slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort().reverse(), [kindRows])

  const summary = useMemo(() => {
    // Receivables count what is still owed after credit notes; the year total is invoices and credit notes net
    // (an invoice cancelled with a credit note counts, so the two make zero; one cancelled without does not).
    const owed = (rs: Row[]) => sumByCurrency(rs.map((r) => ({ amount: r.settle.outstanding, currency: r.inv.currency })))
    const all = invoiceRows.map((r) => r.inv)
    const billed = invoiceRows.filter((r) => r.status !== 'draft' && !isVoided(r.inv, all) && r.inv.issueDate.startsWith(thisYear))
    const openQuotes = rows.filter((r) => r.quote === 'sent')
    return {
      unpaid: owed(invoiceRows.filter((r) => r.unpaid)),
      overdue: owed(invoiceRows.filter((r) => r.status === 'overdue')),
      overdueCount: invoiceRows.filter((r) => r.status === 'overdue').length,
      year: sumByCurrency(billed.map((r) => ({ amount: r.gross, currency: r.inv.currency }))),
      yearCount: billed.length,
      issued: invoiceRows.some((r) => r.status !== 'draft'),
      quotesOpen: sumByCurrency(openQuotes.map((r) => ({ amount: r.gross, currency: r.inv.currency }))),
    }
  }, [rows, invoiceRows, thisYear])

  // The rows shown, and which field each one matched the search in (to show it under the row).
  const { filtered, hits } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hits = new Map<string, SearchHit>()
    const filtered = kindRows.filter((r) => {
      if (year !== 'all' && !r.inv.issueDate.startsWith(year)) return false
      if (q) {
        const hit = searchInvoice(r.inv, q, r)
        if (!hit) return false
        hits.set(r.inv.id, hit)
      }
      if (ATTENTION_FILTERS.includes(status)) return !!attentionIdsBy.get(status)?.has(r.inv.id)
      // The recurring overview: its invoices, for the selection beside it.
      if (status === 'recurring') return recurringIds.has(r.inv.id)
      return matches(r, status)
    })
    return { filtered, hits }
  }, [kindRows, year, query, status, attentionIdsBy, recurringIds])

  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: Row[] }[] = []
    for (const r of filtered) {
      const key = r.inv.issueDate.slice(0, 7)
      const last = out[out.length - 1]
      if (last && last.key === key) last.rows.push(r)
      else out.push({ key, label: monthLabel(key, lang), rows: [r] })
    }
    return out
  }, [filtered, lang])

  // Wide screens always show an invoice; phones show the list until one is tapped (and never render a hidden
  // detail, which would download pdfmake and rasterise a page nobody sees).
  const phone = usePhone()
  const selected = explicit ?? (phone ? undefined : filtered[0])

  useEffect(() => {
    detailRef.current?.scrollTo?.({ top: 0 })
    if (explicitId && isPhone()) window.scrollTo({ top: 0 })
  }, [explicitId])

  if (invoices.length === 0) {
    return (
      <div className="page page-empty">
        <EmptyState
          headingLevel={1}
          icon={<ReceiptIcon size={28} />}
          title={t('list.emptyTitle')}
          actions={
            <>
              <Link to="/invoices/new" className="btn btn-primary">
                <PlusIcon />
                {t('nav.newInvoice')}
              </Link>
              <Link to="/invoices/new?type=quote" className="btn">
                <FileTextIcon />
                {t('quote.new')}
              </Link>
              <Link to="/clients" className="btn">
                <UserPlusIcon />
                {t('list.addClient')}
              </Link>
            </>
          }
        >
          <p>{t('list.emptyText')}</p>
          <ol className="empty-steps">
            <li>{t('list.emptyStep1')}</li>
            <li>{t('list.emptyStep2')}</li>
            <li>{t('list.emptyStep3')}</li>
          </ol>
        </EmptyState>
      </div>
    )
  }

  const money = (amount: number, currency: string) => formatMoney(amount, currency)
  const quotes = kind === 'quotes'
  // Overdue invoices get their own chip while there are any; otherwise "overdue" stays under "More filters".
  const overdueChip = !quotes && summary.overdueCount > 0
  const invoiceExtras = [...(overdueChip ? EXTRA.filter((s) => s !== 'overdue') : EXTRA), ...(recurringIds.size > 0 || status === 'recurring' ? (['recurring'] as const) : [])]
  const showRecurring = !quotes && status === 'recurring'
  const extras: StatusFilter[] = quotes ? QUOTE_EXTRA : invoiceExtras
  const isExtra = extras.includes(status)
  const extraValue = isExtra ? status : year !== 'all' ? `y:${year}` : ''
  const onExtra = (v: string) => {
    if (v.startsWith('y:')) {
      setYear(v.slice(2))
      if (isExtra) setStatus('all')
    } else if (v) {
      setStatus(v as StatusFilter)
      setYear('all')
    } else {
      setYear('all')
      if (isExtra) setStatus('all')
    }
  }
  // The strip line whose filter is on (drafts only in the invoices view).
  const activeAttention = (Object.keys(ATTENTION_FILTER) as AttentionKey[]).find(
    (k) => ATTENTION_FILTER[k] === status && (k === 'quotes') === quotes,
  )
  const openAttention = (g: AttentionGroup) => {
    const k: Kind = g.key === 'quotes' ? 'quotes' : 'invoices'
    setKind(k)
    setYear('all')
    setQuery('')
    if (g.docs.length === 1) {
      setStatus('all')
      navigate(`/?id=${g.docs[0].id}`)
      return
    }
    setStatus(ATTENTION_FILTER[g.key])
    if (explicit && (k === 'quotes') !== !!explicit.quote) navigate('/', { replace: true })
  }
  const switchKind = (k: Kind) => {
    setKind(k)
    setStatus('all')
    setYear('all')
    if (explicit && (k === 'quotes') !== !!explicit.quote) navigate('/', { replace: true })
  }
  const mainOptions = quotes
    ? (['all', 'sent', 'draft'] as const).map((s) => ({ value: s as StatusFilter, label: s === 'sent' ? t('list.quoteFilter.sent') : t(`list.filter.${s}`) }))
    : (['all', 'unpaid', 'overdue', 'draft'] as const)
        .filter((s) => s !== 'overdue' || overdueChip)
        .map((s) => (s === 'overdue' ? { value: s as StatusFilter, label: t('list.filter.overdueChip'), count: summary.overdueCount } : { value: s as StatusFilter, label: t(`list.filter.${s}`) }))
  /** The receivables sentence leads to the invoices it sums up. */
  const showStatus = (s: StatusFilter) => {
    setStatus(s)
    setYear('all')
  }

  // Roving tabindex: only one row is in the tab order (the selected one, else the last focused or first row),
  // so Tab goes from the list straight on to the invoice's actions. Arrow keys move between rows (and select).
  const tabStop = filtered.some((r) => r.inv.id === selected?.inv.id) ? selected?.inv.id : filtered.some((r) => r.inv.id === focusId) ? focusId : filtered[0]?.inv.id
  const onListKey = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const links = Array.from(e.currentTarget.querySelectorAll<HTMLAnchorElement>('.inv-row'))
    const i = links.indexOf(document.activeElement as HTMLAnchorElement)
    if (i < 0) return
    const last = links.length - 1
    const next = links[e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowDown' ? Math.min(i + 1, last) : Math.max(i - 1, 0)]
    e.preventDefault()
    next.focus()
    if (!isPhone() && next.dataset.id) navigate(`/?id=${next.dataset.id}`, { replace: true })
  }

  return (
    <div className={`arved${explicit ? ' has-selection' : ''}`}>
      <section className="arved-list" aria-labelledby="arved-title">
        <div className="list-head">
          <h1 id="arved-title" className="visually-hidden">
            {quotes ? t('list.kind.quotes') : t('nav.invoices')}
          </h1>
          <div className="list-kind">
            <Segmented<Kind>
              label={t('list.kindLabel')}
              value={kind}
              onChange={switchKind}
              className="kind-filter"
              options={[
                { value: 'invoices', label: t('list.kind.invoices') },
                { value: 'quotes', label: t('list.kind.quotes') },
              ]}
            />
            {quotes && (
              <Link to="/invoices/new?type=quote" className="btn btn-sm list-new-quote">
                <PlusIcon />
                {t('quote.new')}
              </Link>
            )}
          </div>
          {quotes ? (
            <p className="receivable">
              {summary.quotesOpen.size === 0
                ? t('list.quotesNoneOpen')
                : interpolate(t('list.quotesOpen'), { amount: <strong className="tnum">{joinSums(summary.quotesOpen, money)}</strong> })}
            </p>
          ) : (
          <p className="receivable">
            {!summary.issued
              ? t('list.noIssued')
              : summary.unpaid.size === 0
              ? t('list.allPaid')
              : interpolate(t(summary.overdue.size ? 'list.receivable' : 'list.receivableNoOverdue'), {
                  unpaid: (
                    <button
                      type="button"
                      className="sum-link"
                      aria-label={t('list.showUnpaid', { amount: joinSums(summary.unpaid, money) })}
                      onClick={() => showStatus('unpaid')}
                    >
                      <strong className="tnum">{joinSums(summary.unpaid, money)}</strong>
                    </button>
                  ),
                  overdue: (
                    <button
                      type="button"
                      className="sum-link"
                      aria-label={t('list.showOverdue', { amount: joinSums(summary.overdue, money) })}
                      onClick={() => showStatus('overdue')}
                    >
                      <strong className="tnum tone-danger">{joinSums(summary.overdue, money)}</strong>
                    </button>
                  ),
                })}
          </p>
          )}
          {!quotes && nextRule && (
            <p className="recurring-next">
              <ArrowsClockwiseIcon size={14} aria-hidden="true" />
              <button type="button" className="sum-link" onClick={() => showStatus('recurring')}>
                {t('recurring.nextHint', { date: formatDate(nextRule.rule.nextDate), client: nextRule.source.buyer.name || t('list.noClient') })}
              </button>
            </p>
          )}
          <AttentionStrip groups={attention} active={activeAttention ?? null} onOpen={openAttention} />
          <div className="list-filters">
            <Segmented<StatusFilter | ''>
              label={t('list.filterStatus')}
              value={mainOptions.some((o) => o.value === status) ? status : ''}
              onChange={(v) => v && setStatus(v)}
              className="status-filter"
              options={mainOptions}
            />
            <select className="select-quiet" aria-label={t('list.moreFilters')} value={extraValue} onChange={(e) => onExtra(e.target.value)}>
              <option value="">{t('list.moreFilters')}</option>
              <optgroup label={t('list.filterStatus')}>
                {quotes
                  ? QUOTE_EXTRA.map((s) => (
                      <option key={s} value={s}>
                        {t(`quote.status.${s}`)}
                      </option>
                    ))
                  : invoiceExtras.map((s) => (
                      <option key={s} value={s}>
                        {t(`list.filter.${s}`)}
                      </option>
                    ))}
              </optgroup>
              {years.length > 0 && (
                <optgroup label={t('list.filterYear')}>
                  {years.map((y) => (
                    <option key={y} value={`y:${y}`}>
                      {t('list.yearOption', { year: y })}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <SearchField value={query} onChange={setQuery} label={t('list.searchWide')} shortcutHint={t('common.searchShortcut')} />
        </div>

        <div className="list-scroll" onKeyDown={onListKey}>
          {showRecurring ? (
            <RecurringPanel active={recurring.active} paused={recurring.paused} selectedId={selected?.inv.id} />
          ) : quotes && !hasQuotes ? (
            <div className="list-none list-none-quotes">
              <p className="list-none-title">{t('list.quotesEmptyTitle')}</p>
              <p>{t('list.quotesEmptyText')}</p>
              <Link to="/invoices/new?type=quote" className="btn btn-primary btn-sm">
                <PlusIcon />
                {t('quote.new')}
              </Link>
            </div>
          ) : filtered.length === 0 ? (
            <div className="list-none">
              <p>{t('list.noMatches')}</p>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setStatus('all')
                  setYear('all')
                  setQuery('')
                }}
              >
                {t('list.clearFilters')}
              </button>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key || 'none'} className="month">
                {g.label && <h2 className="month-label">{g.label}</h2>}
                <ul className="inv-rows" aria-label={g.label || t('list.invoicesLabel')}>
                  {g.rows.map((r) => {
                    const { inv, status: st, gross, settle } = r
                    const s = r.quote ? quoteRowStatus(r, t) : rowStatus(inv, st, today, t, settle)
                    const recurringDraft = inv.status === 'draft' && !!inv.recurringRuleId
                    const current = selected?.inv.id === inv.id
                    const hit = hits.get(inv.id)
                    return (
                      <li key={inv.id}>
                        <Link
                          to={`/?id=${inv.id}`}
                          data-id={inv.id}
                          className={`inv-row row-${r.quote ? `quote-${r.quote}` : st}${r.quote === 'draft' ? ' row-draft' : ''}`}
                          aria-current={current ? 'true' : undefined}
                          tabIndex={inv.id === tabStop ? 0 : -1}
                          onFocus={() => setFocusId(inv.id)}
                        >
                          <span className="row-client">
                            {inv.buyer.name ? <Highlight text={inv.buyer.name} query={hit?.field === 'client' ? query : ''} /> : <span className="muted">{t('list.noClient')}</span>}
                          </span>
                          <span className="row-amount tnum">{hit?.field === 'amount' ? <mark className="hit">{formatMoney(gross, inv.currency)}</mark> : formatMoney(gross, inv.currency)}</span>
                          <span className="row-number">
                            {inv.number ? <Highlight text={inv.number} query={hit?.field === 'number' ? query : ''} /> : t('list.noNumber')}
                            {inv.type === 'prepayment' && <span className="row-type"> · {t('invoice.type.prepayment')}</span>}
                            {recurringDraft && (
                              <span className="row-type row-recurring" title={t('list.recurringMarkerTitle')}>
                                {' · '}
                                <ArrowsClockwiseIcon size={12} className="row-recurring-icon" />
                                {t('list.recurringMarker')}
                              </span>
                            )}
                          </span>
                          <span className={`row-status tone-${s.tone}`}>{s.text}</span>
                          {hit && HIDDEN_FIELD[hit.field] && (
                            <span className="row-hit">
                              {t(HIDDEN_FIELD[hit.field]!)}:{' '}
                              {hit.amount !== undefined ? <mark className="hit">{formatMoney(hit.amount, inv.currency)}</mark> : <Highlight text={hit.text} query={query} />}
                            </span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="list-foot">
          {!quotes && summary.yearCount > 0 && <p>{interpolate(t('list.yearBilled', { year: thisYear }), { amount: <span className="tnum">{joinSums(summary.year, money)}</span> })}</p>}
          <BackupNote />
        </div>
      </section>

      <div ref={detailRef} className="arved-detail">
        {selected ? <InvoiceDetail key={selected.inv.id} invoice={selected.inv} showBack={!!explicit} /> : <p className="detail-none">{t('detail.noSelection')}</p>}
      </div>
    </div>
  )
}

/** Data lives only in this browser and invoices must be kept for 7 years (RPS § 12): nudge towards backups. */
function BackupNote() {
  const { t } = useApp()
  const last = getLastBackupAt()
  const age = last ? daysBetween(last.slice(0, 10), localTodayISO()) : null
  const due = age === null || age >= 30
  return (
    <p className={`backup-note${due ? ' backup-due' : ''}`}>
      {due ? (last ? t('list.backupOld', { days: age ?? 0 }) : t('list.backupNever')) : t('footer.local')}{' '}
      <Link to="/settings">{t('list.backupLink')}</Link>
    </p>
  )
}
