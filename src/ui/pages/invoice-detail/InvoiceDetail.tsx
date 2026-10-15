import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowUUpLeftIcon,
  BellRingingIcon,
  CheckIcon,
  CloudArrowUpIcon,
  CopyIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  FileCodeIcon,
  FileTextIcon,
  LockSimpleIcon,
  PencilSimpleIcon,
  PrinterIcon,
  ProhibitIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { computeTotals, selectedBankAccounts, type Invoice } from '../../../domain'
import { TEMPLATES } from '../../../pdf'
import { useApp } from '../../AppContext'
import { Menu, type MenuItem } from '../../components/ui'
import { formatDate, formatIban, formatMoney, formatNumber } from '../../format'
import { pick, type MessageKey } from '../../i18n'
import { useToast } from '../../Toasts'
import { daysBetween, displayStatus, effectiveInvoice, formatAddress, isUnpaid, localTodayISO } from '../../util'
import { EmailDialog } from '../editor/EmailDialog'
import { MarkPaidDialog } from '../editor/StatusDialogs'
import { PdfPage } from './PdfPage'
import { markSent, useSentAt } from './sent'
import { detailStatus } from './status'
import { interpolate } from './text'
import { useInvoiceActions } from './useInvoiceActions'

const PAGE_KEY = 'invoice-generator:detailPage'

function initialShowPage(): boolean {
  try {
    return localStorage.getItem(PAGE_KEY) === '1'
  } catch {
    return false
  }
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

type Dialog = null | 'paid' | 'email' | 'reminder'

/** The selected invoice, typeset like a document, with one status-dependent primary action. */
export function InvoiceDetail({ invoice, showBack }: { invoice: Invoice; showBack?: boolean }) {
  const { t, lang, profile, invoices, markInvoicePaid } = useApp()
  const toast = useToast()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [showPage, setShowPage] = useState(initialShowPage)
  const effective = useMemo(() => effectiveInvoice(invoice, profile), [invoice, profile])
  const totals = useMemo(() => computeTotals(invoice), [invoice])
  const actions = useInvoiceActions(invoice, effective)
  const sentAt = useSentAt(invoice.id)
  const today = localTodayISO()
  const status = displayStatus(invoice, today)
  const draft = invoice.status === 'draft'
  const credit = invoice.type === 'credit-note'
  const unpaid = isUnpaid(invoice)
  const busy = actions.busy !== null
  const cur = invoice.currency

  const togglePage = () => {
    const next = !showPage
    setShowPage(next)
    try {
      localStorage.setItem(PAGE_KEY, next ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }

  // ---- the one primary action -------------------------------------------------
  type Primary = { kind: 'continue' | 'email' | 'remind' | 'paid'; label: string; icon: ReactNode }
  let primary: Primary | null = null
  if (draft) primary = { kind: 'continue', label: t('detail.continue'), icon: <PencilSimpleIcon /> }
  else if (status === 'overdue') primary = { kind: 'remind', label: t('detail.remind'), icon: <BellRingingIcon /> }
  else if (invoice.status === 'issued' && !sentAt) primary = { kind: 'email', label: t('actions.email'), icon: <EnvelopeSimpleIcon /> }
  else if (unpaid) primary = { kind: 'paid', label: t('actions.markPaid'), icon: <CheckIcon /> }

  const runPrimary = (p: Primary) => {
    if (p.kind === 'email') setDialog('email')
    else if (p.kind === 'remind') setDialog('reminder')
    else if (p.kind === 'paid') setDialog('paid')
  }

  // ---- everything else, in one menu ---------------------------------------------
  const items: MenuItem[] = []
  if (!draft && invoice.status !== 'cancelled' && primary?.kind !== 'email') items.push({ key: 'email', label: t('actions.email'), icon: <EnvelopeSimpleIcon />, onSelect: () => setDialog('email') })
  if (!draft) {
    items.push({ key: 'drive', label: t('actions.drive'), icon: <CloudArrowUpIcon />, onSelect: () => void actions.saveToDrive() })
    items.push({ key: 'xml', label: t('actions.downloadXml'), icon: <FileCodeIcon />, onSelect: () => void actions.downloadXml() })
  }
  items.push({ key: 'print', label: t('actions.print'), icon: <PrinterIcon />, onSelect: () => void actions.print() })
  items.push({ key: 'duplicate', label: t('actions.duplicate'), icon: <CopyIcon />, separatorBefore: true, onSelect: () => void actions.duplicate() })
  if (!draft && !credit && invoice.status !== 'cancelled') items.push({ key: 'credit', label: t('actions.creditNote'), icon: <ArrowUUpLeftIcon />, onSelect: () => void actions.creditNote() })
  if (invoice.status === 'paid') items.push({ key: 'unpaid', label: t('actions.markUnpaid'), icon: <ArrowCounterClockwiseIcon />, onSelect: () => void actions.markUnpaid() })
  if (invoice.status === 'issued') items.push({ key: 'cancel', label: t('actions.cancelInvoice'), icon: <ProhibitIcon />, danger: true, separatorBefore: true, onSelect: () => void actions.cancel() })
  if (draft) items.push({ key: 'delete', label: t('actions.deleteDraft'), icon: <TrashIcon />, danger: true, separatorBefore: true, onSelect: () => void actions.deleteDraft() })

  // ---- text ---------------------------------------------------------------------
  const title = draft
    ? t(credit ? 'detail.draftCreditTitle' : 'detail.draftTitle')
    : t(credit ? 'editor.titleCredit' : 'editor.title', { number: invoice.number })
  const head = detailStatus(invoice, status, today, t)
  const tail = [
    !draft && invoice.issuedAt ? t('detail.issuedOn', { date: formatDate(invoice.issuedAt.slice(0, 10)) }) : '',
    sentAt && invoice.status === 'issued' ? t('detail.sentOn', { date: formatDate(sentAt) }) : '',
  ].filter(Boolean)

  const buyer = invoice.buyer
  const accounts = selectedBankAccounts(effective)
  const term = daysBetween(invoice.issueDate, invoice.dueDate)
  const template = TEMPLATES.find((x) => x.id === invoice.templateId)
  const creditedBy =
    !draft && !credit && invoice.number
      ? invoices.filter((i) => i.type === 'credit-note' && i.id !== invoice.id && i.status !== 'cancelled' && i.creditedInvoiceNumber?.trim() === invoice.number)
      : []

  const buyerRows: [string, ReactNode][] = []
  if (buyer.kind === 'person' ? buyer.personalCode : buyer.registryCode) buyerRows.push([t(buyer.kind === 'person' ? 'field.personalCode' : 'field.registryCode'), (buyer.kind === 'person' ? buyer.personalCode : buyer.registryCode) ?? ''])
  if (buyer.vatNumber) buyerRows.push([t('field.vatNumber'), buyer.vatNumber])
  if (formatAddress(buyer.address)) buyerRows.push([t('detail.address'), formatAddress(buyer.address)])
  if (buyer.email)
    buyerRows.push([
      t('field.email'),
      <a key="email" href={`mailto:${buyer.email}`}>
        {buyer.email}
      </a>,
    ])

  const payRows: [string, ReactNode][] = []
  if (invoice.type !== 'invoice') payRows.push([t('field.invoiceType'), t(`invoice.type.${invoice.type}`)])
  if (invoice.issueDate) payRows.push([t('field.issueDate'), formatDate(invoice.issueDate)])
  if (invoice.dueDate && !credit) payRows.push([t('field.dueDate'), term > 0 ? t(term === 1 ? 'detail.termOne' : 'detail.term', { date: formatDate(invoice.dueDate), days: term }) : formatDate(invoice.dueDate)])
  if (invoice.paidAt) payRows.push([t('detail.paidOn'), formatDate(invoice.paidAt)])
  if (invoice.supplyDate && invoice.supplyDate !== invoice.issueDate) payRows.push([t('field.supplyDate'), formatDate(invoice.supplyDate)])
  if (invoice.periodStart || invoice.periodEnd) payRows.push([t('detail.period'), `${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`])
  if (invoice.referenceNumber) payRows.push([t('field.referenceNumber'), invoice.referenceNumber])
  if (invoice.orderReference) payRows.push([t('field.orderReference'), invoice.orderReference])
  if (accounts.length)
    payRows.push([
      t('detail.bankAccount'),
      <>
        {accounts.map((a) => (
          <span key={a.id} className="fact-line">
            {formatIban(a.iban)}
            {a.bankName ? ` (${a.bankName})` : ''}
          </span>
        ))}
      </>,
    ])
  payRows.push([t('detail.vat'), t(`vat.scheme.${invoice.vatScheme}` as MessageKey)])
  payRows.push([t('detail.design'), [template ? pick(template.name, lang) : invoice.templateId, t(`lang.${invoice.language}` as MessageKey).toLowerCase()].filter(Boolean).join(', ')])

  return (
    <article className="doc" aria-labelledby="doc-title">
      {showBack && (
        <Link to="/" className="back-link doc-back">
          <ArrowLeftIcon />
          {t('nav.invoices')}
        </Link>
      )}
      <header className="doc-head">
        <div className="doc-title">
          <h2 id="doc-title">{title}</h2>
          <p className="doc-client">{buyer.name || <span className="muted">{t('list.noClient')}</span>}</p>
          <p className="doc-status">
            <span className={`tone-${head.tone}`}>{head.text}</span>
            {tail.length > 0 && <>, {tail.join(', ')}</>}
            {unpaid && primary?.kind !== 'paid' && (
              <>
                {'. '}
                <button type="button" className="link-btn" onClick={() => setDialog('paid')} disabled={busy}>
                  {t('actions.markPaid')}
                </button>
              </>
            )}
          </p>
        </div>
        <div className="doc-amount">
          <span className={`doc-gross${invoice.status === 'cancelled' ? ' is-void' : ''}`}>{formatMoney(totals.gross, cur)}</span>
          {totals.showVat && <span className="doc-vat">{t('detail.vatIncluded', { amount: formatMoney(totals.vat, cur) })}</span>}
        </div>
      </header>

      <div className="doc-actions" role="group" aria-label={t('detail.actions')}>
        {primary &&
          (primary.kind === 'continue' ? (
            <Link to={`/invoices/${invoice.id}`} className="btn btn-primary">
              {primary.icon}
              {primary.label}
            </Link>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => runPrimary(primary)} disabled={busy}>
              {primary.icon}
              {primary.label}
            </button>
          ))}
        <button
          type="button"
          className="btn btn-text"
          onClick={() => void actions.downloadPdf()}
          disabled={busy}
          aria-label={draft ? t('actions.previewPdf') : t('actions.downloadPdfFor', { number: invoice.number })}
          title={draft ? t('actions.previewPdf') : t('actions.downloadPdf')}
        >
          <DownloadSimpleIcon />
          {actions.busy === 'pdf' ? t('common.working') : t('detail.pdf')}
        </button>
        <Menu label={t('common.more')} text={t('detail.more')} items={items} disabled={busy} align="start" />
        <button type="button" className="btn btn-text doc-page-toggle" aria-pressed={showPage} onClick={togglePage}>
          <FileTextIcon />
          {t('detail.showPage')}
        </button>
      </div>

      {showPage ? (
        <PdfPage invoice={effective} cacheKey={`${invoice.id}:${invoice.updatedAt}:${draft ? (profile?.updatedAt ?? '') : ''}`} />
      ) : (
        <>
          <div className="doc-facts">
            {buyerRows.length > 0 && (
              <section aria-labelledby="doc-buyer">
                <h3 id="doc-buyer">{t('editor.buyer')}</h3>
                <Facts rows={buyerRows} />
              </section>
            )}
            <section aria-labelledby="doc-payment">
              <h3 id="doc-payment">{t('detail.payment')}</h3>
              <Facts rows={payRows} />
            </section>
          </div>

          <section className="doc-lines" aria-labelledby="doc-lines">
            <h3 id="doc-lines">{t('detail.lines')}</h3>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th scope="col">{t('lines.description')}</th>
                    <th scope="col" className="num">
                      {t('lines.quantity')}
                    </th>
                    <th scope="col" className="num">
                      {t('lines.unitPrice')}
                    </th>
                    {totals.showVat && (
                      <th scope="col" className="num">
                        {t('detail.colVat')}
                      </th>
                    )}
                    <th scope="col" className="num">
                      {t('lines.total')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((l, i) => (
                    <tr key={l.id ?? i}>
                      <td className="doc-desc">
                        {l.description}
                        {!!l.discountPercent && <span className="muted"> (−{formatNumber(l.discountPercent)}%)</span>}
                      </td>
                      <td className="num">
                        {formatNumber(l.quantity)}
                        {l.unit ? ` ${l.unit}` : ''}
                      </td>
                      <td className="num">{formatMoney(l.unitPrice, cur)}</td>
                      {totals.showVat && <td className="num">{formatNumber(l.vatRate)}%</td>}
                      <td className="num">{formatMoney(totals.lines[i]?.net ?? 0, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="doc-totals">
              {totals.showVat && (
                <>
                  <div>
                    <dt>{t('totals.net')}</dt>
                    <dd>{formatMoney(totals.net, cur)}</dd>
                  </div>
                  {totals.vatBreakdown.map((r) => (
                    <div key={r.rate}>
                      <dt>{t('detail.vatRate', { rate: formatNumber(r.rate) })}</dt>
                      <dd>{formatMoney(r.vat, cur)}</dd>
                    </div>
                  ))}
                </>
              )}
              <div className="doc-grand">
                <dt>{t('totals.gross')}</dt>
                <dd>{formatMoney(totals.gross, cur)}</dd>
              </div>
            </dl>
            {invoice.notes && <p className="doc-notes">{invoice.notes}</p>}
          </section>
        </>
      )}

      <footer className="doc-foot">
        {draft ? (
          <p>{t('detail.draftNote')}</p>
        ) : (
          <>
            <p className="doc-lock">
              <LockSimpleIcon />
              <span>
                {invoice.status === 'cancelled'
                  ? t('editor.cancelledBanner')
                  : credit
                    ? t('editor.lockedBanner')
                    : interpolate(t('detail.locked'), {
                        link: (
                          <button type="button" className="link-btn" onClick={() => void actions.creditNote()} disabled={busy}>
                            {t('detail.lockedLink')}
                          </button>
                        ),
                      })}
              </span>
            </p>
            {creditedBy.length > 0 && (
              <p className="credited-by">
                {t('editor.creditedBy')}{' '}
                {creditedBy.map((cn, i) => (
                  <span key={cn.id}>
                    {i > 0 && ', '}
                    <Link to={`/?id=${cn.id}`}>{cn.number || t('list.draftNumber')}</Link>
                  </span>
                ))}
              </p>
            )}
          </>
        )}
      </footer>

      {dialog === 'paid' && (
        <MarkPaidDialog
          invoice={invoice}
          onClose={() => setDialog(null)}
          onConfirm={async (paidAt) => {
            await markInvoicePaid(invoice.id, paidAt)
            toast.success(t('actions.markedPaid', { number: invoice.number }))
          }}
        />
      )}
      {(dialog === 'email' || dialog === 'reminder') && (
        <EmailDialog invoice={effective} kind={dialog === 'reminder' ? 'reminder' : 'invoice'} onSent={() => markSent(invoice.id)} onClose={() => setDialog(null)} />
      )}
    </article>
  )
}
