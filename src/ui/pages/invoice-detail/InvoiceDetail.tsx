import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowUUpLeftIcon,
  BellRingingIcon,
  CalendarCheckIcon,
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
import { Link, useNavigate } from 'react-router-dom'
import { computeTotals, holdsNumber, selectedBankAccounts, textRows, type Invoice } from '../../../domain'
import { quoteStatus } from '../../../domain/quote'
import { TEMPLATES } from '../../../pdf'
import { useApp } from '../../AppContext'
import { Menu, type MenuItem } from '../../components/ui'
import { formatDate, formatIban, formatMoney, formatNumber } from '../../format'
import { pick, type MessageKey } from '../../i18n'
import { daysBetween, displayStatus, effectiveInvoice, formatAddress, isUnpaid, localTodayISO } from '../../util'
import { EmailDialog } from '../editor/EmailDialog'
import { RecurringControl } from '../editor/RecurringControl'
import { CancelInvoiceDialog, DeleteInvoiceDialog, MarkPaidDialog } from '../editor/StatusDialogs'
import { QuoteActions } from '../quotes/QuoteActions'
import { useInvoiceEvents } from './events'
import { PdfPage } from './PdfPage'
import { detailStatus, docNoun, quoteDetailStatus, settlementOf } from './status'
import { interpolate } from './text'
import { LockNote } from './LockNote'
import { useCanReopen, useInvoiceActions } from './useInvoiceActions'

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

type Dialog = null | 'paid' | 'paidDate' | 'cancel' | 'email' | 'reminder' | 'delete'

/** After a reminder, wait this many days before offering the next one as the main action. */
const REMIND_AGAIN_DAYS = 7

/** The selected invoice, typeset like a document, with one status-dependent primary action. */
export function InvoiceDetail({ invoice, showBack }: { invoice: Invoice; showBack?: boolean }) {
  const { t, lang, profile, invoices } = useApp()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [showPage, setShowPage] = useState(initialShowPage)
  const effective = useMemo(() => effectiveInvoice(invoice, profile), [invoice, profile])
  const totals = useMemo(() => computeTotals(invoice), [invoice])
  const actions = useInvoiceActions(invoice, effective)
  const history = useInvoiceEvents(invoice.id)
  const sentAt = history.sentAt
  const today = localTodayISO()
  const draft = invoice.status === 'draft'
  const numbered = holdsNumber(invoice)
  const canReopen = useCanReopen(invoice)
  const credit = invoice.type === 'credit-note'
  const quote = invoice.type === 'quote'
  const status = quote ? invoice.status : displayStatus(invoice, today, invoices)
  const unpaid = !quote && isUnpaid(invoice, invoices)
  const lastReminder = history.reminders[history.reminders.length - 1]
  const remindedRecently = !!lastReminder && daysBetween(lastReminder, today) < REMIND_AGAIN_DAYS
  const settle = useMemo(() => settlementOf(invoice, invoices), [invoice, invoices])
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
  else if (quote) primary = null
  else if (status === 'overdue')
    primary = remindedRecently ? { kind: 'paid', label: t('actions.markPaid'), icon: <CheckIcon /> } : { kind: 'remind', label: t('detail.remind'), icon: <BellRingingIcon /> }
  else if (invoice.status === 'issued' && !sentAt && !settle.settled) primary = { kind: 'email', label: t('actions.email'), icon: <EnvelopeSimpleIcon /> }
  else if (unpaid) primary = { kind: 'paid', label: t('actions.markPaid'), icon: <CheckIcon /> }

  const runPrimary = (p: Primary) => {
    if (p.kind === 'email') setDialog('email')
    else if (p.kind === 'remind') setDialog('reminder')
    else if (p.kind === 'paid') void actions.markPaid()
  }

  // ---- everything else, in one menu ---------------------------------------------
  const items: MenuItem[] = []
  if (!draft && invoice.status !== 'cancelled' && primary?.kind !== 'email') items.push({ key: 'email', label: t('actions.email'), icon: <EnvelopeSimpleIcon />, onSelect: () => setDialog('email') })
  if (status === 'overdue' && primary?.kind !== 'remind')
    items.push({ key: 'remind', label: t(history.reminders.length ? 'reminder.again' : 'detail.remind'), icon: <BellRingingIcon />, onSelect: () => setDialog('reminder') })
  if (!draft) items.push({ key: 'drive', label: t('actions.drive'), icon: <CloudArrowUpIcon />, onSelect: () => void actions.saveToDrive() })
  if (!draft && !quote) items.push({ key: 'xml', label: t('actions.downloadXml'), icon: <FileCodeIcon />, onSelect: () => void actions.downloadXml() })
  items.push({ key: 'print', label: t('actions.print'), icon: <PrinterIcon />, onSelect: () => void actions.print() })
  if (canReopen) items.push({ key: 'reopen', label: t('reopen.action'), icon: <PencilSimpleIcon />, separatorBefore: true, onSelect: () => void actions.reopen() })
  items.push({ key: 'duplicate', label: t('actions.duplicate'), icon: <CopyIcon />, separatorBefore: !canReopen, onSelect: () => void actions.duplicate() })
  if (!draft && !credit && !quote && invoice.status !== 'cancelled' && !settle.settled) items.push({ key: 'credit', label: t('actions.creditNote'), icon: <ArrowUUpLeftIcon />, onSelect: () => void actions.creditNote() })
  if (unpaid) items.push({ key: 'paidOn', label: t('payment.otherDate'), icon: <CalendarCheckIcon />, onSelect: () => setDialog('paid') })
  if (invoice.status === 'paid') items.push({ key: 'unpaid', label: t('actions.markUnpaid'), icon: <ArrowCounterClockwiseIcon />, onSelect: () => void actions.markUnpaid() })
  // A credit note is not cancelled: one not yet sent is reopened or deleted, a sent one is answered with a new invoice.
  if (invoice.status === 'issued' && !credit)
    items.push({
      key: 'cancel',
      label: t(quote ? 'payment.cancelQuote' : 'actions.cancelInvoice'),
      icon: <ProhibitIcon />,
      danger: true,
      separatorBefore: true,
      onSelect: () => (actions.cancelsWithCredit ? setDialog('cancel') : void actions.cancel()),
    })
  if (numbered)
    items.push({
      key: 'delete',
      label: t('delete.menu', { doc: docNoun(t, invoice) }),
      icon: <TrashIcon />,
      danger: true,
      separatorBefore: invoice.status !== 'issued' || credit,
      onSelect: () => setDialog('delete'),
    })
  else if (draft) items.push({ key: 'delete', label: t('actions.deleteDraft'), icon: <TrashIcon />, danger: true, separatorBefore: true, onSelect: () => void actions.deleteDraft() })

  // ---- text ---------------------------------------------------------------------
  const title = quote
    ? draft && !numbered
      ? t('detail.quoteDraftTitle')
      : t('detail.quoteTitle', { number: invoice.number })
    : draft && !numbered
      ? t(credit ? 'detail.draftCreditTitle' : 'detail.draftTitle')
      : t(credit ? 'editor.titleCredit' : 'editor.title', { number: invoice.number })
  const head = quote ? quoteDetailStatus(invoice, quoteStatus(invoice, today, invoices), today, t) : detailStatus(invoice, status, today, t, settle)
  const fromQuote = invoice.convertedFromQuoteId ? invoices.find((i) => i.id === invoice.convertedFromQuoteId) : undefined
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
  const creditLinks = (list: Invoice[]) =>
    list.map((cn, i) => (
      <span key={cn.id}>
        {i > 0 && ', '}
        <Link to={`/?id=${cn.id}`}>{cn.number || t('list.draftNumber')}</Link>
      </span>
    ))

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
  if (invoice.type !== 'invoice' && !quote) payRows.push([t('field.invoiceType'), t(`invoice.type.${invoice.type}`)])
  if (invoice.issueDate) payRows.push([t(quote ? 'quote.fieldDate' : 'field.issueDate'), formatDate(invoice.issueDate)])
  if (quote && invoice.validUntil) payRows.push([t('detail.validUntil'), formatDate(invoice.validUntil)])
  if (fromQuote) payRows.push([t('detail.fromQuote'), <Link key="quote" to={`/?id=${fromQuote.id}`}>{fromQuote.number || t('list.draftNumber')}</Link>])
  if (invoice.dueDate && !credit && !quote) payRows.push([t('field.dueDate'), term > 0 ? t(term === 1 ? 'detail.termOne' : 'detail.term', { date: formatDate(invoice.dueDate), days: term }) : formatDate(invoice.dueDate)])
  if (invoice.paidAt) payRows.push([t('detail.paidOn'), formatDate(invoice.paidAt)])
  if (invoice.supplyDate && invoice.supplyDate !== invoice.issueDate) payRows.push([t('field.supplyDate'), formatDate(invoice.supplyDate)])
  if (invoice.periodStart || invoice.periodEnd) payRows.push([t('detail.period'), `${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`])
  if (invoice.referenceNumber && !quote) payRows.push([t('field.referenceNumber'), invoice.referenceNumber])
  if (invoice.orderReference) payRows.push([t('field.orderReference'), invoice.orderReference])
  if (accounts.length && !quote)
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
  payRows.push([t('detail.design'), [template ? pick(template.name, lang) : invoice.templateId, lang === 'et' ? t(`lang.${invoice.language}` as MessageKey).toLowerCase() : t(`lang.${invoice.language}` as MessageKey)].filter(Boolean).join(', ')])

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
            {settle.settled ? (
              <span className="tone-muted">
                {interpolate(t(settle.creditNotes.length > 1 ? 'detail.statusCreditedMany' : 'detail.statusCredited'), { numbers: creditLinks(settle.creditNotes) })}
              </span>
            ) : (
              <span className={`tone-${head.tone}`}>{head.text}</span>
            )}
            {tail.length > 0 && <>, {tail.join(', ')}</>}
            {unpaid && primary?.kind !== 'paid' && (
              <>
                {'. '}
                <button type="button" className="link-btn" onClick={() => void actions.markPaid()} disabled={busy}>
                  {t('actions.markPaid')}
                </button>
              </>
            )}
            {invoice.status === 'paid' && (
              <>
                {' · '}
                <button type="button" className="link-btn" onClick={() => setDialog('paidDate')} disabled={busy}>
                  {t('payment.changeDate')}
                </button>
              </>
            )}
          </p>
          {!draft && history.reminders.length > 0 && (
            <p className="doc-reminders muted small">
              {t(history.reminders.length > 1 ? 'reminder.many' : 'reminder.one', { dates: history.reminders.map((d) => formatDate(d)).join(', ') })}
            </p>
          )}
        </div>
        <div className="doc-amount">
          <span className={`doc-gross${invoice.status === 'cancelled' ? ' is-void' : ''}`}>{formatMoney(totals.gross, cur)}</span>
          {totals.showVat && <span className="doc-vat">{t('detail.vatIncluded', { amount: formatMoney(totals.vat, cur) })}</span>}
        </div>
      </header>

      {quote && !draft && <QuoteActions invoice={invoice} className="doc-quote" />}
      <div className="doc-actions" role="group" aria-label={t('detail.actions')}>
        {primary &&
          (primary.kind === 'continue' ? (
            <Link to={`/invoices/${invoice.id}`} state={{ focusTitle: true }} className="btn btn-primary">
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
          {t(quote ? 'quote.showPage' : 'detail.showPage')}
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
              <h3 id="doc-payment">{t(quote ? 'detail.terms' : 'detail.payment')}</h3>
              <Facts rows={payRows} />
            </section>
          </div>

          <section className="doc-lines" aria-labelledby="doc-lines">
            <h3 id="doc-lines">{t(quote ? 'quote.sectionLines' : 'detail.lines')}</h3>
            {textRows(invoice.textBefore).map((r, i) => (
              <p key={i} className="doc-text-row doc-text-before">
                {r}
              </p>
            ))}
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
                <dt>{t(credit ? 'totals.credited' : quote ? 'totals.grossShort' : 'totals.gross')}</dt>
                <dd>{formatMoney(totals.gross, cur)}</dd>
              </div>
            </dl>
            {textRows(invoice.textAfter).map((r, i) => (
              <p key={i} className="doc-text-row doc-text-after">
                {r}
              </p>
            ))}
            {invoice.notes && <p className="doc-notes">{invoice.notes}</p>}
          </section>
        </>
      )}

      <footer className="doc-foot">
        {draft ? (
          <p>{numbered ? t('reopen.banner', { number: invoice.number }) : t('detail.draftNote')}</p>
        ) : (
          <>
            <RecurringControl invoice={invoice} className="doc-recurring" />
            <p className="doc-lock">
              <LockSimpleIcon />
              <span>
                <LockNote
                  invoice={invoice}
                  creditLink={
                    <button type="button" className="link-btn" onClick={() => void actions.creditNote()} disabled={busy}>
                      {t('detail.lockedLink')}
                    </button>
                  }
                />
                {canReopen && (
                  <>
                    {' '}
                    {interpolate(t('reopen.hint'), {
                      link: (
                        <button type="button" className="link-btn" onClick={() => void actions.reopen()} disabled={busy}>
                          {t('reopen.hintLink')}
                        </button>
                      ),
                    })}
                  </>
                )}
              </span>
            </p>
            {creditedBy.length > 0 && (
              <p className="credited-by">
                {t('editor.creditedBy')} {creditLinks(creditedBy)}
              </p>
            )}
          </>
        )}
      </footer>

      {(dialog === 'paid' || dialog === 'paidDate') && (
        <MarkPaidDialog
          invoice={invoice}
          change={dialog === 'paidDate'}
          onClose={() => setDialog(null)}
          onConfirm={async (paidAt) => {
            if (dialog === 'paidDate') await actions.changePaidDate(paidAt)
            else await actions.markPaidOn(paidAt)
          }}
        />
      )}
      {dialog === 'cancel' && (
        <CancelInvoiceDialog
          invoice={invoice}
          amount={actions.remaining}
          partiallyCredited={settle.creditNotes.length > 0}
          onClose={() => setDialog(null)}
          onConfirm={actions.cancelWithCredit}
          onPartial={() => void actions.creditNote()}
        />
      )}
      {dialog === 'delete' && (
        <DeleteInvoiceDialog
          invoice={invoice}
          onClose={() => setDialog(null)}
          onDeleted={() => navigate('/')}
          onCreditNote={credit || quote || invoice.status === 'cancelled' ? undefined : () => void actions.creditNote()}
        />
      )}
      {(dialog === 'email' || dialog === 'reminder') && (
        <EmailDialog
          invoice={effective}
          kind={dialog === 'reminder' ? 'reminder' : 'invoice'}
          previousReminders={history.reminders.length}
          onClose={() => setDialog(null)}
        />
      )}
    </article>
  )
}
