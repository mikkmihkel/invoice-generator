import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Invoice } from '../../domain'
import { downloadBlob } from '../../integrations'
import { invoiceFileName, renderInvoicePdf } from '../../pdf'
import { useApp } from '../AppContext'
import { StatusChip } from '../components/misc'
import { formatDate, formatMoney } from '../format'
import { useToast } from '../Toasts'
import { displayStatus, errorMessage, localTodayISO, safeTotals, sumByCurrency, type DisplayStatus } from '../util'
import { MarkPaidDialog } from './editor/StatusDialogs'

type StatusFilter = 'all' | 'unpaid' | DisplayStatus

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
        <span key={cur}>
          {i > 0 && ' · '}
          {formatMoney(amt, cur)}
        </span>
      ))}
    </>
  )
}

export default function InvoiceList() {
  const { t, invoices, saveInvoice } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const today = localTodayISO()
  const thisYear = today.slice(0, 4)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [year, setYear] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [paying, setPaying] = useState<Invoice | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => invoices.map((inv) => ({ inv, status: displayStatus(inv, today), gross: safeTotals(inv).gross })), [invoices, today])

  const years = useMemo(() => [...new Set(invoices.map((i) => i.issueDate.slice(0, 4)))].sort().reverse(), [invoices])

  const summary = useMemo(() => {
    const unpaid = rows.filter((r) => r.status === 'issued' || r.status === 'overdue')
    const overdue = rows.filter((r) => r.status === 'overdue')
    const year = rows.filter((r) => (r.status === 'issued' || r.status === 'overdue' || r.status === 'paid') && r.inv.issueDate.startsWith(thisYear))
    const sum = (rs: Row[]) => sumByCurrency(rs.map((r) => ({ amount: r.gross, currency: r.inv.currency })))
    return { unpaid: sum(unpaid), unpaidCount: unpaid.length, overdue: sum(overdue), overdueCount: overdue.length, year: sum(year), yearCount: year.length }
  }, [rows, thisYear])

  const q = query.trim().toLowerCase()
  const filtered = rows.filter((r) => {
    if (status === 'unpaid' ? !(r.status === 'issued' || r.status === 'overdue') : status !== 'all' && r.status !== status) return false
    if (year !== 'all' && !r.inv.issueDate.startsWith(year)) return false
    if (q && ![r.inv.number, r.inv.buyer.name, r.inv.orderReference, r.inv.buyer.registryCode].some((s) => s?.toLowerCase().includes(q))) return false
    return true
  })

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
      <div className="page">
        <div className="empty card empty-hero">
          <div className="empty-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="56" height="56">
              <rect x="10" y="6" width="28" height="36" rx="3" fill="none" stroke="currentColor" strokeWidth="2.5" />
              <path d="M16 16h16M16 23h16M16 30h9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
          <h1>{t('list.emptyTitle')}</h1>
          <p className="muted">{t('list.emptyText')}</p>
          <Link to="/invoices/new" className="btn btn-primary btn-lg">
            + {t('nav.newInvoice')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('nav.invoices')}</h1>
      </div>

      <div className="summary">
        <button type="button" className={`summary-card${status === 'unpaid' ? ' active' : ''}`} onClick={() => setStatus(status === 'unpaid' ? 'all' : 'unpaid')} aria-pressed={status === 'unpaid'}>
          <span className="summary-label">{t('list.unpaid')}</span>
          <span className="summary-value">
            <MoneySum sums={summary.unpaid} />
          </span>
          <span className="summary-sub">{t('list.invoiceCount', { count: summary.unpaidCount })}</span>
        </button>
        <button
          type="button"
          className={`summary-card${summary.overdueCount ? ' summary-danger' : ''}${status === 'overdue' ? ' active' : ''}`}
          onClick={() => setStatus(status === 'overdue' ? 'all' : 'overdue')}
          aria-pressed={status === 'overdue'}
        >
          <span className="summary-label">{t('list.overdue')}</span>
          <span className="summary-value">
            <MoneySum sums={summary.overdue} />
          </span>
          <span className="summary-sub">{t('list.invoiceCount', { count: summary.overdueCount })}</span>
        </button>
        <div className="summary-card">
          <span className="summary-label">{t('list.thisYear', { year: thisYear })}</span>
          <span className="summary-value">
            <MoneySum sums={summary.year} />
          </span>
          <span className="summary-sub">{t('list.invoiceCount', { count: summary.yearCount })}</span>
        </div>
      </div>

      <div className="toolbar">
        <input type="search" className="search-input" placeholder={t('list.search')} aria-label={t('list.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label={t('list.filterStatus')} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="all">{t('list.allStatuses')}</option>
          <option value="unpaid">{t('list.unpaid')}</option>
          {(['draft', 'issued', 'overdue', 'paid', 'cancelled'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
        <select aria-label={t('list.filterYear')} value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="all">{t('list.allYears')}</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="empty-filter muted">{t('list.noMatches')}</p>
      ) : (
        <div className="table-wrap">
          <table className="invoice-table">
            <thead>
              <tr>
                <th scope="col">{t('list.colNumber')}</th>
                <th scope="col">{t('list.colClient')}</th>
                <th scope="col">{t('list.colIssued')}</th>
                <th scope="col">{t('list.colDue')}</th>
                <th scope="col" className="num">
                  {t('list.colTotal')}
                </th>
                <th scope="col">{t('list.colStatus')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('list.colActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ inv, status: st, gross }) => (
                <tr key={inv.id} className={`row-${st}`} onClick={(e) => (e.target as HTMLElement).closest('a,button') || navigate(`/invoices/${inv.id}`)}>
                  <td data-label={t('list.colNumber')}>
                    <Link to={`/invoices/${inv.id}`} className="inv-number">
                      {inv.number || t('list.draftNumber')}
                    </Link>
                    {inv.type === 'credit-note' && <span className="chip chip-credit">{t('invoice.type.credit-note')}</span>}
                    {inv.type === 'prepayment' && <span className="chip">{t('invoice.type.prepayment')}</span>}
                  </td>
                  <td data-label={t('list.colClient')} className="cell-client">
                    {inv.buyer.name || <span className="muted">{t('list.noClient')}</span>}
                  </td>
                  <td data-label={t('list.colIssued')}>{formatDate(inv.issueDate)}</td>
                  <td data-label={t('list.colDue')}>{formatDate(inv.dueDate)}</td>
                  <td data-label={t('list.colTotal')} className="num">
                    {formatMoney(gross, inv.currency)}
                  </td>
                  <td data-label={t('list.colStatus')}>
                    <StatusChip status={st} />
                  </td>
                  <td className="row-actions">
                    {inv.status !== 'draft' && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void downloadPdf(inv)} disabled={busyId === inv.id} aria-label={t('actions.downloadPdfFor', { number: inv.number })}>
                        PDF
                      </button>
                    )}
                    {inv.status === 'issued' && (
                      <button type="button" className="btn btn-sm" onClick={() => setPaying(inv)}>
                        {t('actions.markPaid')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paying && (
        <MarkPaidDialog
          invoice={paying}
          onClose={() => setPaying(null)}
          onConfirm={async (paidAt) => {
            await saveInvoice({ ...paying, status: 'paid', paidAt, updatedAt: new Date().toISOString() })
            toast.success(t('actions.markedPaid', { number: paying.number }))
          }}
        />
      )}
    </div>
  )
}
