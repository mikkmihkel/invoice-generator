import { CheckIcon, ClockCounterClockwiseIcon, DownloadSimpleIcon, PlusIcon, ReceiptIcon, UserPlusIcon } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { computeTotals, type Invoice } from '../../domain'
import { downloadBlob } from '../../integrations'
import { invoiceFileName, renderInvoicePdf } from '../../pdf'
import { useApp } from '../AppContext'
import { StatusChip } from '../components/misc'
import { EmptyState, IconButton, SearchField, Segmented } from '../components/ui'
import { formatDate, formatMoney } from '../format'
import type { Translate } from '../i18n'
import { useToast } from '../Toasts'
import { daysBetween, displayStatus, errorMessage, getLastBackupAt, isUnpaid, localTodayISO, normalizeInvoice, sumByCurrency, type DisplayStatus } from '../util'
import { MarkPaidDialog } from './editor/StatusDialogs'

type StatusFilter = 'all' | 'draft' | 'unpaid' | 'overdue' | 'paid'

interface Row {
  inv: Invoice
  status: DisplayStatus
  gross: number
}

function MoneySum({ sums }: { sums: Map<string, number> }) {
  if (sums.size === 0) return <>{formatMoney(0)}</>
  return (
    <>
      {[...sums.entries()].map(([cur, amt], i) => (
        <span key={cur} className="money-part">
          {i > 0 && ' + '}
          {formatMoney(amt, cur)}
        </span>
      ))}
    </>
  )
}

/** "In 3 days" / "5 days overdue" for invoices that still await payment. */
function dueRelative(inv: Invoice, status: DisplayStatus, today: string, t: Translate): { text: string; tone: 'danger' | 'muted' } | null {
  if (status === 'paid' && inv.paidAt) return { text: t('list.paidOn', { date: formatDate(inv.paidAt) }), tone: 'muted' }
  if (!isUnpaid(inv) || !/^\d{4}-\d{2}-\d{2}$/.test(inv.dueDate)) return null
  const d = daysBetween(today, inv.dueDate)
  if (d < 0) return { text: d === -1 ? t('list.overdueOne') : t('list.overdueBy', { days: -d }), tone: 'danger' }
  if (d === 0) return { text: t('list.dueToday'), tone: 'muted' }
  if (d === 1) return { text: t('list.dueTomorrow'), tone: 'muted' }
  return { text: t('list.dueIn', { days: d }), tone: 'muted' }
}

function matches(r: Row, status: StatusFilter): boolean {
  if (status === 'all') return true
  if (status === 'unpaid') return isUnpaid(r.inv)
  return r.status === status
}

export default function InvoiceList() {
  const { t, invoices, markInvoicePaid } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const today = localTodayISO()
  const thisYear = today.slice(0, 4)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [year, setYear] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [paying, setPaying] = useState<Invoice | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Normalized so a malformed stored record (old / hand-edited backup) still renders as a row.
  const rows = useMemo<Row[]>(
    () =>
      invoices.map((raw) => {
        const inv = normalizeInvoice(raw)
        return { inv, status: displayStatus(inv, today), gross: computeTotals(inv).gross }
      }),
    [invoices, today],
  )

  const years = useMemo(() => [...new Set(rows.map((r) => r.inv.issueDate.slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort().reverse(), [rows])

  const summary = useMemo(() => {
    const unpaid = rows.filter((r) => isUnpaid(r.inv))
    const overdue = rows.filter((r) => r.status === 'overdue')
    const year = rows.filter((r) => (r.status === 'issued' || r.status === 'overdue' || r.status === 'paid') && r.inv.issueDate.startsWith(thisYear))
    const sum = (rs: Row[]) => sumByCurrency(rs.map((r) => ({ amount: r.gross, currency: r.inv.currency })))
    return { unpaid: sum(unpaid), unpaidCount: unpaid.length, overdue: sum(overdue), overdueCount: overdue.length, year: sum(year), yearCount: year.length }
  }, [rows, thisYear])

  const q = query.trim().toLowerCase()
  const inScope = rows.filter((r) => {
    if (year !== 'all' && !r.inv.issueDate.startsWith(year)) return false
    if (q && ![r.inv.number, r.inv.buyer.name, r.inv.orderReference, r.inv.buyer.registryCode].some((s) => s?.toLowerCase().includes(q))) return false
    return true
  })
  const filtered = inScope.filter((r) => matches(r, status))
  const count = (s: StatusFilter) => inScope.filter((r) => matches(r, s)).length

  const downloadPdf = async (inv: Invoice) => {
    setBusyId(inv.id)
    try {
      downloadBlob(await renderInvoicePdf(inv), invoiceFileName(inv, 'pdf'))
    } catch (e) {
      toast.error(t('pdf.failed') + ' ' + errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

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

  const toggle = (s: StatusFilter) => setStatus(status === s ? 'all' : s)

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('nav.invoices')}</h1>
      </div>

      <div className="figures" role="group" aria-label={t('list.summary')}>
        <button type="button" className="figure" onClick={() => toggle('unpaid')} aria-pressed={status === 'unpaid'}>
          <span className="figure-label">{t('list.unpaid')}</span>
          <span className="figure-value">
            <MoneySum sums={summary.unpaid} />
          </span>
          <span className="figure-sub">{t('list.invoiceCount', { count: summary.unpaidCount })}</span>
        </button>
        <button type="button" className={`figure${summary.overdueCount ? ' figure-danger' : ''}`} onClick={() => toggle('overdue')} aria-pressed={status === 'overdue'}>
          <span className="figure-label">{t('list.overdue')}</span>
          <span className="figure-value">
            <MoneySum sums={summary.overdue} />
          </span>
          <span className="figure-sub">{t('list.invoiceCount', { count: summary.overdueCount })}</span>
        </button>
        <div className="figure figure-static">
          <span className="figure-label">{t('list.thisYear', { year: thisYear })}</span>
          <span className="figure-value">
            <MoneySum sums={summary.year} />
          </span>
          <span className="figure-sub">{t('list.invoiceCount', { count: summary.yearCount })}</span>
        </div>
      </div>

      <BackupReminder count={invoices.length} />

      <div className="list-toolbar">
        <div className="filter-scroll">
          <Segmented<StatusFilter>
            label={t('list.filterStatus')}
            value={status}
            onChange={setStatus}
            className="status-filter"
            options={(['all', 'draft', 'unpaid', 'overdue', 'paid'] as const).map((s) => ({ value: s, label: t(`list.filter.${s}`), count: count(s) }))}
          />
        </div>
        <div className="toolbar-end">
          <select className="select-sm" aria-label={t('list.filterYear')} value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">{t('list.allYears')}</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <SearchField value={query} onChange={setQuery} label={t('list.search')} shortcutHint={t('common.searchShortcut')} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="panel empty-filter">
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
        <div className="panel table-panel">
          <table className="ledger invoice-table">
            <thead>
              <tr>
                <th scope="col" className="col-number">
                  {t('list.colNumber')}
                </th>
                <th scope="col" className="col-client">
                  {t('list.colClient')}
                </th>
                <th scope="col" className="col-date">
                  {t('list.colIssued')}
                </th>
                <th scope="col" className="col-due">
                  {t('list.colDue')}
                </th>
                <th scope="col" className="num col-total">
                  {t('list.colTotal')}
                </th>
                <th scope="col" className="col-status">
                  {t('list.colStatus')}
                </th>
                <th scope="col" className="col-actions">
                  <span className="visually-hidden">{t('list.colActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ inv, status: st, gross }) => {
                const rel = dueRelative(inv, st, today, t)
                return (
                  <tr key={inv.id} className={`row-${st}`} onClick={(e) => (e.target as HTMLElement).closest('a,button') || navigate(`/invoices/${inv.id}`)}>
                    <td className="col-number">
                      <Link to={`/invoices/${inv.id}`} className={`inv-number${inv.number ? '' : ' inv-draft'}`}>
                        {inv.number || t('list.draftNumber')}
                      </Link>
                      {inv.type === 'credit-note' && <span className="chip chip-credit">{t('invoice.type.credit-note')}</span>}
                      {inv.type === 'prepayment' && <span className="chip chip-neutral">{t('invoice.type.prepayment')}</span>}
                    </td>
                    <td className="col-client">{inv.buyer.name || <span className="muted">{t('list.noClient')}</span>}</td>
                    <td className="col-date">{formatDate(inv.issueDate)}</td>
                    <td className="col-due">
                      <span className="due-date">{formatDate(inv.dueDate)}</span>
                      {rel && <span className={`due-rel due-${rel.tone}`}>{rel.text}</span>}
                    </td>
                    <td className="num col-total">{formatMoney(gross, inv.currency)}</td>
                    <td className="col-status">
                      <StatusChip status={st} />
                    </td>
                    <td className="col-actions">
                      <div className="row-actions">
                        {inv.status !== 'draft' && (
                          <IconButton label={t('actions.downloadPdfFor', { number: inv.number })} icon={<DownloadSimpleIcon />} onClick={() => void downloadPdf(inv)} disabled={busyId === inv.id} />
                        )}
                        {isUnpaid(inv) && <IconButton label={t('actions.markPaid')} icon={<CheckIcon />} onClick={() => setPaying(inv)} />}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {paying && (
        <MarkPaidDialog
          invoice={paying}
          onClose={() => setPaying(null)}
          onConfirm={async (paidAt) => {
            await markInvoicePaid(paying.id, paidAt)
            toast.success(t('actions.markedPaid', { number: paying.number }))
          }}
        />
      )}
    </div>
  )
}

/** Data lives only in this browser and invoices must be kept for 7 years (RPS § 12): nudge towards backups. */
function BackupReminder({ count }: { count: number }) {
  const { t } = useApp()
  const last = getLastBackupAt()
  const age = last ? daysBetween(last.slice(0, 10), localTodayISO()) : null
  if (count === 0 || (age !== null && age < 30)) return null
  return (
    <div className="inline-banner backup-reminder">
      <ClockCounterClockwiseIcon size={18} />
      <p>{last ? t('list.backupOld', { days: age ?? 0 }) : t('list.backupNever')}</p>
      <Link to="/settings" className="btn btn-sm">
        {t('list.backupLink')}
      </Link>
    </div>
  )
}
