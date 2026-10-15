import { PlusIcon, ReceiptIcon, UserPlusIcon } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { computeTotals, type Invoice } from '../../domain'
import { useApp } from '../AppContext'
import { EmptyState, SearchField, Segmented } from '../components/ui'
import { formatMoney } from '../format'
import { daysBetween, displayStatus, getLastBackupAt, isUnpaid, localTodayISO, normalizeInvoice, sumByCurrency, type DisplayStatus } from '../util'
import { InvoiceDetail } from './invoice-detail/InvoiceDetail'
import { rowStatus, settlementOf, type Settlement } from './invoice-detail/status'
import { interpolate, joinSums } from './invoice-detail/text'

type MainFilter = 'all' | 'unpaid' | 'draft'
type ExtraFilter = 'overdue' | 'paid' | 'cancelled'
type StatusFilter = MainFilter | ExtraFilter
const EXTRA: ExtraFilter[] = ['overdue', 'paid', 'cancelled']

interface Row {
  inv: Invoice
  status: DisplayStatus
  gross: number
  /** Credit notes against the row's invoice and what is still owed after them. */
  settle: Settlement
  unpaid: boolean
}

function matches(r: Row, status: StatusFilter): boolean {
  if (status === 'all') return true
  if (status === 'unpaid') return r.unpaid
  return r.status === status
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
  const { t, lang, invoices } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const today = localTodayISO()
  const thisYear = today.slice(0, 4)
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
      gross: computeTotals(inv).gross,
      settle: settlementOf(inv, all),
      unpaid: isUnpaid(inv, all),
    }))
  }, [invoices, today])

  const years = useMemo(() => [...new Set(rows.map((r) => r.inv.issueDate.slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort().reverse(), [rows])

  const summary = useMemo(() => {
    // Receivables count what is still owed after credit notes; the year total is invoices and credit notes net.
    const owed = (rs: Row[]) => sumByCurrency(rs.map((r) => ({ amount: r.settle.outstanding, currency: r.inv.currency })))
    const billed = rows.filter((r) => (r.status === 'issued' || r.status === 'overdue' || r.status === 'paid') && r.inv.issueDate.startsWith(thisYear))
    return {
      unpaid: owed(rows.filter((r) => r.unpaid)),
      overdue: owed(rows.filter((r) => r.status === 'overdue')),
      year: sumByCurrency(billed.map((r) => ({ amount: r.gross, currency: r.inv.currency }))),
      yearCount: billed.length,
      issued: rows.some((r) => r.status !== 'draft'),
    }
  }, [rows, thisYear])

  const q = query.trim().toLowerCase()
  const filtered = rows.filter((r) => {
    if (year !== 'all' && !r.inv.issueDate.startsWith(year)) return false
    if (q && ![r.inv.number, r.inv.buyer.name, r.inv.orderReference, r.inv.buyer.registryCode].some((s) => s?.toLowerCase().includes(q))) return false
    return matches(r, status)
  })

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

  const explicitId = params.get('id')
  const explicit = explicitId ? rows.find((r) => r.inv.id === explicitId) : undefined
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
  const extraValue = EXTRA.includes(status as ExtraFilter) ? status : year !== 'all' ? `y:${year}` : ''
  const onExtra = (v: string) => {
    if (v.startsWith('y:')) {
      setYear(v.slice(2))
      if (EXTRA.includes(status as ExtraFilter)) setStatus('all')
    } else if (v) {
      setStatus(v as ExtraFilter)
      setYear('all')
    } else {
      setYear('all')
      if (EXTRA.includes(status as ExtraFilter)) setStatus('all')
    }
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
            {t('nav.invoices')}
          </h1>
          <p className="receivable">
            {!summary.issued
              ? t('list.noIssued')
              : summary.unpaid.size === 0
              ? t('list.allPaid')
              : interpolate(t(summary.overdue.size ? 'list.receivable' : 'list.receivableNoOverdue'), {
                  unpaid: <strong className="tnum">{joinSums(summary.unpaid, money)}</strong>,
                  overdue: <strong className="tnum tone-danger">{joinSums(summary.overdue, money)}</strong>,
                })}
          </p>
          <div className="list-filters">
            <Segmented<MainFilter | ''>
              label={t('list.filterStatus')}
              value={EXTRA.includes(status as ExtraFilter) ? '' : (status as MainFilter)}
              onChange={(v) => v && setStatus(v)}
              className="status-filter"
              options={(['all', 'unpaid', 'draft'] as const).map((s) => ({ value: s, label: t(`list.filter.${s}`) }))}
            />
            <select className="select-quiet" aria-label={t('list.moreFilters')} value={extraValue} onChange={(e) => onExtra(e.target.value)}>
              <option value="">{t('list.moreFilters')}</option>
              <optgroup label={t('list.filterStatus')}>
                {EXTRA.map((s) => (
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
          <SearchField value={query} onChange={setQuery} label={t('list.search')} shortcutHint={t('common.searchShortcut')} />
        </div>

        <div className="list-scroll" onKeyDown={onListKey}>
          {filtered.length === 0 ? (
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
                  {g.rows.map(({ inv, status: st, gross, settle }) => {
                    const s = rowStatus(inv, st, today, t, settle)
                    const current = selected?.inv.id === inv.id
                    return (
                      <li key={inv.id}>
                        <Link
                          to={`/?id=${inv.id}`}
                          data-id={inv.id}
                          className={`inv-row row-${st}`}
                          aria-current={current ? 'true' : undefined}
                          tabIndex={inv.id === tabStop ? 0 : -1}
                          onFocus={() => setFocusId(inv.id)}
                        >
                          <span className="row-client">{inv.buyer.name || <span className="muted">{t('list.noClient')}</span>}</span>
                          <span className="row-amount tnum">{formatMoney(gross, inv.currency)}</span>
                          <span className="row-number">
                            {inv.number || t('list.noNumber')}
                            {inv.type === 'prepayment' && <span className="row-type"> · {t('invoice.type.prepayment')}</span>}
                          </span>
                          <span className={`row-status tone-${s.tone}`}>{s.text}</span>
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
          {summary.yearCount > 0 && <p>{interpolate(t('list.yearBilled', { year: thisYear }), { amount: <span className="tnum">{joinSums(summary.year, money)}</span> })}</p>}
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
