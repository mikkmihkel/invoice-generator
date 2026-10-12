import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowUUpLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CloudArrowUpIcon,
  CopyIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  FileCodeIcon,
  LockSimpleIcon,
  PrinterIcon,
  ProhibitIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  computeTotals,
  newId,
  formatInvoiceNumber,
  isValidReferenceNumber,
  selectedBankAccounts,
  validateInvoice,
  vatNoteMode,
  vatNoteRelevant,
  vatSchemeNote,
  withVatScheme,
  effectiveVatScheme,
  type BuyerSnapshot,
  type Client,
  type Invoice,
  type InvoiceTotals,
  type InvoiceType,
  type ValidationIssue,
} from '../../domain'
import { buildUblXml, eInvoiceIssues } from '../../einvoice'
import { downloadBlob, googleSignIn, uploadToDrive } from '../../integrations'
import { invoiceFileName, preloadPdfMake, renderInvoicePdf, renderInvoicePdfBase64 } from '../../pdf'
import { useApp } from '../AppContext'
import { AccentPicker, TemplatePicker } from '../components/Appearance'
import { useConfirm } from '../components/Dialog'
import { pick } from '../i18n'
import { DecimalInput, FieldShell, fieldId, NumberField, SelectField, TextAreaField, TextField } from '../components/fields'
import { StatusChip } from '../components/misc'
import { IconButton, Menu, Skeleton, type MenuItem } from '../components/ui'
import { formatDate, formatIban, formatMoney } from '../format'
import { CURRENCIES, languageOptions, vatSchemeOptions } from '../options'
import { useToast } from '../Toasts'
import { addDaysISO, daysBetween, displayStatus, effectiveInvoice, errorMessage, isUnpaid, localTodayISO, normalizeInvoice, nowISO, buyerFromClient } from '../util'
import { BuyerSection } from './editor/BuyerSection'
import { creditNoteFor, duplicateInvoice, newDraft, redateInvoice } from './editor/builders'
import { EmailDialog } from './editor/EmailDialog'
import { LinesEditor } from './editor/LinesEditor'
import { PdfPreview } from './editor/PdfPreview'
import { IssueDialog, MarkPaidDialog, type StaleIssueDate } from './editor/StatusDialogs'
import { useAutosave, type SaveState } from './editor/useAutosave'
import { ValidationPanel } from './editor/ValidationPanel'
import { numberingPreview } from './ProfileForm'

const TERM_PRESETS = [7, 14, 30]

/** Keeps one editor instance alive across the /invoices/new → /invoices/:id URL swap after the first autosave. */
export default function InvoiceEditorRoute() {
  const { id = 'new' } = useParams()
  const location = useLocation()
  const stateKey = (location.state as { editorKey?: string } | null)?.editorKey
  // Each navigation yields a new location object; typed/bookmarked URLs all share location.key 'default',
  // so derive a fresh key per navigation to always start a new draft on /invoices/new.
  const navKey = useMemo(() => 'new-' + newId(), [location]) // eslint-disable-line react-hooks/exhaustive-deps
  const key = stateKey ?? (id === 'new' ? navKey : id)
  return <InvoiceEditor key={key} id={id} editorKey={key} />
}

/** One numbered block of the editor flow: Buyer → Lines → Terms → Design. */
function Step({ n, id, title, done, hint, children }: { n: number; id: string; title: string; done?: boolean; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel step" id={id} aria-labelledby={id + '-title'}>
      <header className="step-head">
        <span className={`step-no${done ? ' step-done' : ''}`} aria-hidden="true">
          {done ? <CheckIcon size={12} /> : n}
        </span>
        <h2 id={id + '-title'}>{title}</h2>
      </header>
      {hint && <p className="step-hint">{hint}</p>}
      <div className="step-body">{children}</div>
    </section>
  )
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const { t } = useApp()
  if (state === 'error') {
    return (
      <span className="save-state save-error" aria-live="polite">
        <WarningCircleIcon />
        {t('editor.saveError')}{' '}
        <button type="button" className="link-btn" onClick={onRetry}>
          {t('editor.retrySave')}
        </button>
      </span>
    )
  }
  const text = state === 'saving' || state === 'pending' ? t('editor.saving') : state === 'saved' ? t('editor.saved') : t('editor.autosaveHint')
  return (
    <span className={`save-state save-${state}`} aria-live="polite">
      {state === 'saved' && <CheckIcon />}
      {text}
    </span>
  )
}

function SideTotals({ totals, currency }: { totals: InvoiceTotals; currency: string }) {
  const { t } = useApp()
  return (
    <dl className="side-totals">
      {totals.showVat && (
        <>
          <div>
            <dt>{t('totals.netShort')}</dt>
            <dd>{formatMoney(totals.net, currency)}</dd>
          </div>
          <div>
            <dt>{t('totals.vatShort')}</dt>
            <dd>{formatMoney(totals.vat, currency)}</dd>
          </div>
        </>
      )}
      <div className="grand">
        <dt>{t('totals.grossShort')}</dt>
        <dd>{formatMoney(totals.gross, currency)}</dd>
      </div>
    </dl>
  )
}

/** The moment right after issuing: the number, and the three ways to send it on. */
function NextStep({
  invoice,
  busy,
  hasGoogle,
  folder,
  onEmail,
  onPdf,
  onDrive,
  onDismiss,
}: {
  invoice: Invoice
  busy: string | null
  hasGoogle: boolean
  folder: string
  onEmail: () => void
  onPdf: () => void
  onDrive: () => void
  onDismiss: () => void
}) {
  const { t } = useApp()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  return (
    <section ref={ref} className="next-step" aria-labelledby="next-title" tabIndex={-1}>
      <div className="next-head">
        <span className="next-icon">
          <CheckCircleIcon size={22} />
        </span>
        <div className="next-text">
          <h2 id="next-title">{t('next.title', { number: invoice.number })}</h2>
          <p>{t('next.text')}</p>
        </div>
        <IconButton label={t('next.dismiss')} icon={<XIcon />} onClick={onDismiss} />
      </div>
      <div className="next-actions" role="group" aria-label={t('next.actions')}>
        <button type="button" className="next-action next-primary" onClick={onEmail} disabled={busy !== null}>
          <EnvelopeSimpleIcon size={20} />
          <span className="na-text">
            <span className="na-title">{t('actions.email')}</span>
            <span className="na-sub">{invoice.buyer.email ? t('next.emailTo', { email: invoice.buyer.email }) : t('next.emailNoAddress')}</span>
          </span>
        </button>
        <button type="button" className="next-action" onClick={onPdf} disabled={busy !== null}>
          <DownloadSimpleIcon size={20} />
          <span className="na-text">
            <span className="na-title">{busy === 'pdf' ? t('common.working') : t('actions.downloadPdf')}</span>
            <span className="na-sub">{t('next.pdf', { file: invoiceFileName(invoice, 'pdf') })}</span>
          </span>
        </button>
        <button type="button" className="next-action" onClick={onDrive} disabled={busy !== null}>
          <CloudArrowUpIcon size={20} />
          <span className="na-text">
            <span className="na-title">{busy === 'drive' ? t('common.working') : t('actions.drive')}</span>
            <span className="na-sub">{hasGoogle ? t('next.driveFolder', { folder }) : t('next.driveSetup')}</span>
          </span>
        </button>
      </div>
    </section>
  )
}

/** Secondary terms, collapsed unless the invoice already uses one of them. */
function MoreOptions({ initiallyOpen, children }: { initiallyOpen: boolean; children: ReactNode }) {
  const { t } = useApp()
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <details className="disclosure" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <CaretRightIcon className="caret" />
        <span className="disclosure-title">{t('editor.more')}</span>
        <span className="disclosure-hint">{t('editor.moreHint')}</span>
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  )
}

function EditorSkeleton() {
  const { t } = useApp()
  return (
    <div className="page page-wide editor" role="status" aria-label={t('common.loading')}>
      <Skeleton w={90} />
      <Skeleton w={220} h={24} className="sk-title" />
      <div className="editor-grid">
        <div className="editor-form">
          {[0, 1, 2].map((i) => (
            <div className="panel step" key={i}>
              <Skeleton w={140} h={16} />
              <Skeleton w="100%" h={32} />
              <Skeleton w="60%" h={32} />
            </div>
          ))}
        </div>
        <div className="editor-side">
          <div className="panel summary-panel">
            <Skeleton w="50%" />
            <Skeleton w="80%" h={28} />
            <Skeleton w="100%" h={36} />
          </div>
        </div>
      </div>
    </div>
  )
}

const errorsUnder = (issues: ValidationIssue[], test: (field: string) => boolean) => issues.some((i) => i.severity === 'error' && test(i.field))

function InvoiceEditor({ id, editorKey }: { id: string; editorKey: string }) {
  const app = useApp()
  const { t, lang, profile, clients, settings } = app
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [search] = useSearchParams()

  const [invoice, setInvoiceState] = useState<Invoice | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [dialog, setDialog] = useState<null | 'issue' | 'paid' | 'email'>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [justIssued, setJustIssued] = useState(false)

  const persistedRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  // Stored records may be incomplete (old or hand-edited backups): render them without crashing.
  const setInvoice = useCallback((inv: Invoice) => setInvoiceState(normalizeInvoice(inv)), [])

  const autosave = useAutosave(invoice, {
    save: app.saveInvoice,
    onSaved: (inv) => {
      if (persistedRef.current) return
      persistedRef.current = true
      if (mountedRef.current) navigate(`/invoices/${inv.id}`, { replace: true, state: { editorKey } })
    },
    onError: (e, first) => {
      if (first && mountedRef.current) toast.error(t('common.saveFailed') + ' ' + errorMessage(e))
    },
  })

  useEffect(() => preloadPdfMake(), [])

  // Load (or create in memory) once per editor instance.
  useEffect(() => {
    if (!profile) return
    if (id === 'new') {
      const clientId = search.get('client')
      const client = clientId ? clients.find((c) => c.id === clientId) : undefined
      setInvoice(newDraft(profile, client))
      persistedRef.current = false
      return
    }
    const cached = app.invoices.find((i) => i.id === id)
    if (cached) {
      setInvoice(cached)
      persistedRef.current = true
      return
    }
    let alive = true
    app.repo
      .getInvoice(id)
      .then((inv) => {
        if (!alive) return
        if (inv) {
          setInvoice(inv)
          persistedRef.current = true
        } else setNotFound(true)
      })
      .catch(() => alive && setNotFound(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { markDirty } = autosave
  const isDraft = invoice?.status === 'draft'
  const edit = useCallback(
    (fn: (inv: Invoice) => Invoice) => {
      if (!isDraft) return
      setInvoiceState((prev) => (prev && prev.status === 'draft' ? { ...fn(prev), updatedAt: nowISO() } : prev))
      markDirty()
    },
    [markDirty, isDraft],
  )

  const set = useCallback((patch: Partial<Invoice>) => edit((inv) => ({ ...inv, ...patch })), [edit])

  const effective = useMemo(() => (invoice ? effectiveInvoice(invoice, profile) : null), [invoice, profile])
  // Drafts get their number when issued.
  const issues = useMemo(() => (effective ? validateInvoice(effective, { requireNumber: effective.status !== 'draft' }) : []), [effective])
  const totals = useMemo(() => (invoice ? computeTotals(invoice) : null), [invoice])

  if (notFound) {
    return (
      <div className="page">
        <div className="panel empty">
          <h1 className="empty-title">{t('editor.notFound')}</h1>
          <div className="btn-row empty-actions">
            <Link to="/" className="btn">
              <ArrowLeftIcon />
              {t('nav.invoices')}
            </Link>
          </div>
        </div>
      </div>
    )
  }
  if (!invoice || !effective || !profile || !totals) return <EditorSkeleton />

  const ro = invoice.status !== 'draft'
  const status = displayStatus(invoice)
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const predicted = numberingPreview(profile.numbering, Number(invoice.issueDate.slice(0, 4)) || undefined)
  const term = daysBetween(invoice.issueDate, invoice.dueDate)
  const note = vatSchemeNote(invoice.vatScheme, invoice.language, invoice.vatExemptionNote)
  // The note field is shown wherever the text is printed (and whenever a note is set, so it can be cleared).
  const showNoteField = vatNoteRelevant(invoice) || !!invoice.vatExemptionNote
  const noteField =
    invoice.vatScheme === 'exempt'
      ? { label: t('field.vatExemptionNote'), hint: t('field.vatExemptionNoteHint') }
      : invoice.vatScheme === 'domestic'
        ? { label: t('field.vatNoteZeroRate'), hint: t('field.vatNoteZeroRateHint') }
        : vatNoteMode(invoice.vatScheme) === 'replace'
          ? { label: t('field.vatNote'), hint: t('field.vatNoteReplaceHint') }
          : { label: t('field.vatNoteExtra'), hint: t('field.vatNoteAppendHint') }
  const accounts = effective.seller.bankAccounts
  const selectedAccounts = selectedBankAccounts(effective)
  const xmlIssues = ro ? eInvoiceIssues(invoice) : []
  const today = localTodayISO()
  const stale: StaleIssueDate | null =
    !ro && /^\d{4}-\d{2}-\d{2}$/.test(invoice.issueDate) && invoice.issueDate < today
      ? {
          date: invoice.issueDate,
          today,
          newDueDate: redateInvoice(invoice, today).dueDate,
          supplyDateMoves: !!invoice.supplyDate && invoice.supplyDate === invoice.issueDate,
          numberWithToday: formatInvoiceNumber(profile.numbering, profile.numbering.nextNumber, Number(today.slice(0, 4))),
        }
      : null
  const buyerFieldIssue = !!invoice.buyer.name && issues.some((i) => i.field.startsWith('buyer.'))
  const creditedBy =
    ro && invoice.type !== 'credit-note' && invoice.number
      ? app.invoices.filter((i) => i.type === 'credit-note' && i.id !== invoice.id && i.status !== 'cancelled' && i.creditedInvoiceNumber?.trim() === invoice.number)
      : []
  const hasGoogle = !!settings.googleClientId
  // Issued invoices read as a document: optional fields that were left empty are not shown.
  const shown = (v: unknown) => !ro || (v !== undefined && v !== null && v !== '')

  const title = invoice.number
    ? t(invoice.type === 'credit-note' ? 'editor.titleCredit' : 'editor.title', { number: invoice.number })
    : t(invoice.type === 'credit-note' ? 'editor.newCredit' : 'editor.new')
  const meta = [invoice.buyer.name || t('list.noClient'), formatMoney(totals.gross, invoice.currency), ro && invoice.dueDate ? t('editor.dueMeta', { date: formatDate(invoice.dueDate) }) : '']
    .filter(Boolean)
    .join(' · ')

  // Step progress (drafts only): a step is done when it has its content and no blocking errors.
  const isTermsField = (f: string) => !f.startsWith('buyer') && !f.startsWith('lines') && !f.startsWith('seller')
  const stepDone = {
    buyer: !ro && !!invoice.buyer.name && !errorsUnder(issues, (f) => f.startsWith('buyer')),
    lines: !ro && invoice.lines.length > 0 && !errorsUnder(issues, (f) => f.startsWith('lines')),
    terms: !ro && !errorsUnder(issues, isTermsField),
  }
  const moreOpen =
    ro ||
    invoice.type === 'prepayment' ||
    !!(invoice.supplyDate || invoice.periodStart || invoice.periodEnd || invoice.orderReference || invoice.referenceNumber || invoice.eurExchangeRate) ||
    invoice.currency.toUpperCase() !== 'EUR' ||
    invoice.bankAccountIds.length > 0

  // ---- actions --------------------------------------------------------------
  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  // Status changes go through dedicated repository calls (issued invoices are otherwise immutable).
  const changeStatus = async (change: (id: string) => Promise<Invoice>) => {
    setInvoice(await change(invoice.id))
  }

  const renderPdf = async () => {
    try {
      return await renderInvoicePdf(effective)
    } catch (e) {
      throw new Error(t('pdf.failed') + ' ' + errorMessage(e))
    }
  }

  const downloadPdf = () => act('pdf', async () => downloadBlob(await renderPdf(), invoiceFileName(effective, 'pdf')))

  const print = () =>
    act('print', async () => {
      // Open the window synchronously (inside the click) so popup blockers allow it, then load the PDF.
      const w = window.open('', '_blank')
      // The PDF needs no access back to this app.
      if (w) w.opener = null
      const blob = await renderPdf().catch((e) => {
        w?.close()
        throw e
      })
      if (!w) {
        downloadBlob(blob, invoiceFileName(effective, 'pdf'))
        return
      }
      const url = URL.createObjectURL(blob)
      w.location.href = url
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    })

  const downloadXml = () =>
    act('xml', async () => {
      // Embed the human-readable PDF so the receiver gets both in one file.
      let pdf: { base64: string; fileName: string } | undefined
      try {
        pdf = { base64: await renderInvoicePdfBase64(invoice), fileName: invoiceFileName(invoice, 'pdf') }
      } catch (e) {
        console.warn('PDF embedding failed', e)
      }
      const xml = buildUblXml(invoice, pdf ? { pdf } : {})
      downloadBlob(new Blob([xml], { type: 'application/xml' }), invoiceFileName(invoice, 'xml'))
      toast.success(t('einvoice.downloaded'))
    })

  const saveToDrive = () =>
    act('drive', async () => {
      if (!settings.googleClientId) {
        toast.info(t('google.needClientId'))
        navigate('/settings')
        return
      }
      // Sign in first: the consent popup must open directly from the click.
      await googleSignIn(settings.googleClientId, ['drive'])
      const blob = await renderPdf()
      const res = await uploadToDrive(settings.googleClientId, blob, invoiceFileName(effective, 'pdf'), settings.driveFolderName)
      toast.success(t('drive.saved', { folder: settings.driveFolderName }), res.webViewLink ? { label: t('drive.open'), href: res.webViewLink } : undefined)
    })

  const issue = async (useToday: boolean) => {
    // Save the final draft first; if that fails, stop and keep the edits on screen (still dirty).
    let draft: Invoice | undefined
    if (useToday) {
      draft = { ...redateInvoice(invoice, localTodayISO()), updatedAt: nowISO() }
      setInvoiceState(draft)
    } else if (!persistedRef.current) draft = invoice
    if (!(await autosave.flush(draft))) {
      toast.error(t('issue.saveFailed'))
      throw new Error('save failed')
    }
    try {
      // The repository allocates the number and, if empty, the reference number.
      const issued = await app.issueInvoice(invoice.id)
      autosave.reset()
      setInvoice(issued)
      setJustIssued(true)
      if (window.location.hash.includes('/invoices/new')) navigate(`/invoices/${issued.id}`, { replace: true, state: { editorKey } })
    } catch (e) {
      toast.error(t('issue.failed') + ' ' + errorMessage(e))
      throw e
    }
  }

  const openCopy = (inv: Invoice, msg: string) =>
    act('copy', async () => {
      await app.saveInvoice(inv)
      toast.success(msg)
      navigate(`/invoices/${inv.id}`)
    })

  const duplicate = () => openCopy(duplicateInvoice(effective, profile), t('actions.duplicated'))
  const creditNote = () => openCopy(creditNoteFor(invoice, profile), t('actions.creditCreated', { number: invoice.number }))

  const cancelInvoice = async () => {
    const ok = await confirm({
      title: t('actions.cancelTitle', { number: invoice.number }),
      message: t('actions.cancelConfirm'),
      confirmLabel: t('actions.cancelInvoice'),
      cancelLabel: t('common.back'),
      danger: true,
    })
    if (ok) await act('cancel', () => changeStatus(app.cancelInvoice))
  }

  const deleteDraft = async () => {
    const ok = await confirm({ title: t('actions.deleteDraftTitle'), message: t('actions.deleteDraftConfirm'), confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), danger: true })
    if (!ok) return
    await act('delete', async () => {
      // Wait for an in-flight (e.g. the very first) autosave, so it cannot recreate the record after the delete.
      await autosave.discard()
      await app.deleteInvoice(invoice.id)
      toast.success(t('actions.draftDeleted'))
      navigate('/')
    })
  }

  const onPickClient = (c: Client) =>
    edit((inv) =>
      withVatScheme(
        { ...inv, buyer: buyerFromClient(c), language: c.defaultLanguage ?? inv.language },
        effectiveVatScheme(profile, c.defaultVatScheme ?? inv.vatScheme),
        profile.defaults.defaultVatRate,
      ),
    )

  const setTerm = (days: number) => set({ dueDate: addDaysISO(invoice.issueDate, Math.max(0, Math.round(days))) })

  const busyAny = busy !== null
  const menuItems: MenuItem[] = [
    { key: 'print', label: t('actions.print'), icon: <PrinterIcon />, onSelect: () => void print() },
    { key: 'duplicate', label: t('actions.duplicate'), icon: <CopyIcon />, onSelect: () => void duplicate() },
    ...(invoice.type !== 'credit-note' && invoice.status !== 'cancelled' ? [{ key: 'credit', label: t('actions.creditNote'), icon: <ArrowUUpLeftIcon />, onSelect: () => void creditNote() }] : []),
    ...(invoice.status === 'paid' ? [{ key: 'unpaid', label: t('actions.markUnpaid'), icon: <ArrowCounterClockwiseIcon />, onSelect: () => void act('unpaid', () => changeStatus(app.markInvoiceUnpaid)) }] : []),
    ...(invoice.status === 'issued' ? [{ key: 'cancel', label: t('actions.cancelInvoice'), icon: <ProhibitIcon />, danger: true, separatorBefore: true, onSelect: () => void cancelInvoice() }] : []),
  ]

  const scrollToValidation = () => {
    const panel = document.getElementById('validation-panel')
    panel?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    panel?.focus({ preventScroll: true })
  }

  return (
    <div className="page page-wide editor">
      <div className="editor-head">
        <Link to="/" className="back-link">
          <ArrowLeftIcon />
          {t('nav.invoices')}
        </Link>
        <div className="editor-head-row">
          <div className="editor-title">
            <div className="title-line">
              <h1>{title}</h1>
              <StatusChip status={status} />
            </div>
            <p className="editor-meta">
              <span>{meta}</span>
              {!ro && <SaveIndicator state={autosave.state} onRetry={() => void autosave.flush()} />}
            </p>
          </div>
          <div className="editor-actions" role="toolbar" aria-label={t('editor.actions')}>
            {!ro && (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => void downloadPdf()} disabled={busyAny} title={t('actions.previewPdf')}>
                  <DownloadSimpleIcon />
                  <span className="collapse-label">{t('actions.previewPdf')}</span>
                </button>
                <button type="button" className="btn btn-ghost btn-danger-ghost" onClick={() => void deleteDraft()} disabled={busyAny} title={t('actions.deleteDraft')}>
                  <TrashIcon />
                  <span className="collapse-label">{t('actions.deleteDraft')}</span>
                </button>
              </>
            )}
            {ro && (
              <>
                {!justIssued && invoice.status !== 'cancelled' && (
                  <button type="button" className="btn btn-primary" onClick={() => setDialog('email')} disabled={busyAny}>
                    <EnvelopeSimpleIcon />
                    {t('actions.email')}
                  </button>
                )}
                {!justIssued && (
                  <>
                    <button type="button" className="btn" onClick={() => void downloadPdf()} disabled={busyAny} title={t('actions.downloadPdf')}>
                      <DownloadSimpleIcon />
                      <span className="collapse-label">{busy === 'pdf' ? t('common.working') : t('actions.downloadPdf')}</span>
                    </button>
                    <button type="button" className="btn" onClick={() => void saveToDrive()} disabled={busyAny} title={t('actions.drive')}>
                      <CloudArrowUpIcon />
                      <span className="collapse-label">{busy === 'drive' ? t('common.working') : t('actions.drive')}</span>
                    </button>
                  </>
                )}
                <button type="button" className="btn" onClick={() => void downloadXml()} disabled={busyAny} title={t('einvoice.title')}>
                  <FileCodeIcon />
                  <span className="collapse-label">{t('actions.downloadXml')}</span>
                </button>
                <Menu label={t('common.more')} items={menuItems} disabled={busyAny} />
              </>
            )}
          </div>
        </div>
      </div>

      {ro && justIssued && (
        <NextStep
          invoice={effective}
          busy={busy}
          hasGoogle={hasGoogle}
          folder={settings.driveFolderName}
          onEmail={() => setDialog('email')}
          onPdf={() => void downloadPdf()}
          onDrive={() => void saveToDrive()}
          onDismiss={() => setJustIssued(false)}
        />
      )}

      {ro && (
        <div className={`status-strip${invoice.status === 'cancelled' ? ' strip-warn' : ''}`}>
          <LockSimpleIcon size={18} className="strip-icon" />
          <div className="strip-text">
            <p>{invoice.status === 'cancelled' ? t('editor.cancelledBanner') : t('editor.lockedBanner')}</p>
            {creditedBy.length > 0 && (
              <p className="credited-by">
                {t('editor.creditedBy')}{' '}
                {creditedBy.map((cn, i) => (
                  <span key={cn.id}>
                    {i > 0 && ', '}
                    <Link to={`/invoices/${cn.id}`}>{cn.number || t('list.draftNumber')}</Link>
                  </span>
                ))}
              </p>
            )}
          </div>
          {isUnpaid(invoice) && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog('paid')} disabled={busyAny}>
              <CheckIcon />
              {t('actions.markPaid')}
            </button>
          )}
        </div>
      )}

      <div className="editor-grid">
        <fieldset className="editor-form plain-fieldset" disabled={ro}>
          <legend className="visually-hidden">{title}</legend>

          <Step n={1} id="sec-buyer" title={t('editor.buyer')} done={stepDone.buyer}>
            <BuyerSection buyer={invoice.buyer} onChange={(buyer: BuyerSnapshot) => set({ buyer })} onPickClient={onPickClient} disabled={ro} forceEdit={buyerFieldIssue} />
          </Step>

          <Step n={2} id="sec-lines" title={t('editor.lines')} done={stepDone.lines} hint={invoice.type === 'credit-note' ? t('editor.creditLinesHint') : undefined}>
            <LinesEditor
              lines={invoice.lines}
              onChange={(lines) => set({ lines })}
              vatScheme={invoice.vatScheme}
              currency={invoice.currency}
              totals={totals}
              defaultUnit={profile.defaults.defaultUnit}
              defaultVatRate={profile.defaults.defaultVatRate}
              disabled={ro}
            />
          </Step>

          <Step n={3} id="sec-terms" title={t('editor.terms')} done={stepDone.terms}>
            <div className="grid">
              <TextField
                label={t('field.issueDate')}
                type="date"
                path="issueDate"
                value={invoice.issueDate}
                onChange={(v) => v && set({ issueDate: v, dueDate: addDaysISO(v, Math.max(0, term)) })}
                required
              />
              <TextField label={t('field.dueDate')} type="date" path="dueDate" value={invoice.dueDate} onChange={(v) => v && set({ dueDate: v })} min={invoice.issueDate} required />
              <FieldShell id={fieldId('paymentTerm')} label={t('field.paymentTerm')} className="span-2">
                <div className="term-row">
                  <div className="input-suffix term-days">
                    <DecimalInput id={fieldId('paymentTerm')} className="num" value={term} onChange={(v) => setTerm(v ?? 0)} />
                    <span aria-hidden="true">{t('common.days')}</span>
                  </div>
                  {!ro && (
                    <div className="chip-group" role="group" aria-label={t('field.paymentTerm')}>
                      {TERM_PRESETS.map((d) => (
                        <button key={d} type="button" className="chip-btn" aria-pressed={term === d} onClick={() => setTerm(d)}>
                          {t('editor.termDays', { days: d })}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </FieldShell>
              <SelectField
                className="span-2"
                label={t('field.vatScheme')}
                path="vatScheme"
                value={invoice.vatScheme}
                onChange={(vatScheme) => edit((inv) => withVatScheme(inv, vatScheme, profile.defaults.defaultVatRate))}
                options={vatSchemeOptions(t)}
                hint={t(`vat.explain.${invoice.vatScheme}`)}
              />
            </div>
            {!profile.vatRegistered && invoice.vatScheme !== 'not-registered' && !ro && <p className="notice notice-warn">{t('editor.notVatRegistered')}</p>}
            {showNoteField && shown(invoice.vatExemptionNote) && (
              <TextField label={noteField.label} path="vatExemptionNote" value={invoice.vatExemptionNote} onChange={(v) => set({ vatExemptionNote: v || undefined })} hint={noteField.hint} />
            )}
            {note && (
              <p className="printed-note">
                <span className="printed-label">{t('editor.printedNote')}</span> {note}
              </p>
            )}
            {invoice.type === 'credit-note' && (
              <div className="grid">
                <TextField label={t('field.creditedInvoiceNumber')} path="creditedInvoiceNumber" value={invoice.creditedInvoiceNumber} onChange={(v) => set({ creditedInvoiceNumber: v || undefined })} required />
              </div>
            )}
            {shown(invoice.notes) && <TextAreaField label={t('field.notes')} path="notes" value={invoice.notes} onChange={(v) => set({ notes: v || undefined })} hint={t('field.notesHint')} rows={2} />}

            <MoreOptions initiallyOpen={moreOpen}>
              <div className="grid">
                <SelectField<InvoiceType>
                  label={t('field.invoiceType')}
                  path="type"
                  value={invoice.type}
                  onChange={(type) => set({ type })}
                  options={(['invoice', 'prepayment', 'credit-note'] as const).map((v) => ({ value: v, label: t(`invoice.type.${v}`) }))}
                />
                {shown(invoice.supplyDate) && (
                  <TextField label={t('field.supplyDate')} type="date" path="supplyDate" value={invoice.supplyDate} onChange={(v) => set({ supplyDate: v || undefined })} hint={t('field.supplyDateHint')} />
                )}
                {shown(invoice.periodStart) && <TextField label={t('field.periodStart')} type="date" path="periodStart" value={invoice.periodStart} onChange={(v) => set({ periodStart: v || undefined })} />}
                {shown(invoice.periodEnd) && <TextField label={t('field.periodEnd')} type="date" path="periodEnd" value={invoice.periodEnd} onChange={(v) => set({ periodEnd: v || undefined })} min={invoice.periodStart} />}
                <FieldShell
                  id={fieldId('referenceNumber')}
                  label={t('field.referenceNumber')}
                  hint={invoice.referenceNumber ? undefined : t('field.referenceNumberHint')}
                  error={invoice.referenceNumber && !isValidReferenceNumber(invoice.referenceNumber) ? t('field.referenceNumberInvalid') : undefined}
                >
                  <input
                    id={fieldId('referenceNumber')}
                    type="text"
                    inputMode="numeric"
                    className="mono"
                    value={invoice.referenceNumber ?? ''}
                    aria-invalid={invoice.referenceNumber && !isValidReferenceNumber(invoice.referenceNumber) ? true : undefined}
                    onChange={(e) => set({ referenceNumber: e.target.value.replace(/\s+/g, '') || undefined })}
                  />
                </FieldShell>
                {shown(invoice.orderReference) && <TextField label={t('field.orderReference')} path="orderReference" value={invoice.orderReference} onChange={(v) => set({ orderReference: v || undefined })} />}
                {shown(invoice.lateInterestPercentPerDay) && <NumberField
                  label={t('field.lateInterest')}
                  path="lateInterestPercentPerDay"
                  value={invoice.lateInterestPercentPerDay}
                  onChange={(v) => set({ lateInterestPercentPerDay: v ?? undefined })}
                  allowEmpty
                  suffix={t('common.percentPerDay')}
                />}
                <SelectField label={t('field.currency')} path="currency" value={invoice.currency} onChange={(currency) => set({ currency })} options={[...new Set([invoice.currency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))} />
                {invoice.currency.toUpperCase() !== 'EUR' && totals.vat !== 0 && (
                  <NumberField
                    label={t('field.eurExchangeRate')}
                    hint={t('field.eurExchangeRateHint', { currency: invoice.currency })}
                    path="eurExchangeRate"
                    value={invoice.eurExchangeRate}
                    onChange={(v) => set({ eurExchangeRate: v ?? undefined })}
                    allowEmpty
                  />
                )}
              </div>
              {accounts.length > 1 && (
                <fieldset className="bank-select">
                  <legend className="label">{t('editor.bankAccounts')}</legend>
                  {accounts.map((a) => {
                    const checked = selectedAccounts.includes(a)
                    return (
                      <label key={a.id} className="check-line">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const current = selectedAccounts.map((x) => x.id)
                            const next = e.target.checked ? [...current, a.id] : current.filter((x) => x !== a.id)
                            set({ bankAccountIds: next.length === accounts.length ? [] : next })
                          }}
                        />
                        <span className="mono">{formatIban(a.iban)}</span>
                        {a.bankName && <span className="muted">{a.bankName}</span>}
                      </label>
                    )
                  })}
                </fieldset>
              )}
            </MoreOptions>
          </Step>

          <Step n={4} id="sec-appearance" title={t('editor.appearance')}>
            <div className="grid">
              <SelectField label={t('field.invoiceLanguage')} path="language" value={invoice.language} onChange={(language) => set({ language })} options={languageOptions(t)} />
              <AccentPicker value={invoice.accentColor} onChange={(accentColor) => set({ accentColor })} disabled={ro} />
            </div>
            <TemplatePicker value={invoice.templateId} onChange={(templateId) => set({ templateId })} accent={invoice.accentColor} disabled={ro} compact />
          </Step>
        </fieldset>

        <aside className="editor-side">
          <section className="panel summary-panel" aria-labelledby="summary-title">
            <h2 id="summary-title" className="panel-title">
              {t('totals.title')}
            </h2>
            <SideTotals totals={totals} currency={invoice.currency} />
            {!ro ? (
              <div className="issue-box">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={() => setDialog('issue')}
                  disabled={errors.length > 0 || busyAny}
                  title={errors.length ? t('issue.blocked') : undefined}
                  aria-describedby={errors.length ? 'issue-summary' : undefined}
                >
                  {t('actions.issue')}
                </button>
                {errors.length > 0 ? (
                  <button type="button" id="issue-summary" className="link-btn issue-summary" onClick={scrollToValidation}>
                    <WarningCircleIcon />
                    {t('issue.errorsSummary', { count: errors.length })}
                  </button>
                ) : (
                  <p className="issue-hint">{warnings.length ? t('issue.readyWithWarnings') : t('issue.ready', { number: predicted })}</p>
                )}
              </div>
            ) : (
              <dl className="side-facts">
                {invoice.issuedAt && (
                  <div>
                    <dt>{t('status.issued')}</dt>
                    <dd>{formatDate(invoice.issuedAt.slice(0, 10))}</dd>
                  </div>
                )}
                <div>
                  <dt>{t('field.dueDate')}</dt>
                  <dd>{formatDate(invoice.dueDate)}</dd>
                </div>
                {invoice.paidAt && (
                  <div>
                    <dt>{t('status.paid')}</dt>
                    <dd>{formatDate(invoice.paidAt)}</dd>
                  </div>
                )}
                {invoice.referenceNumber && (
                  <div>
                    <dt>{t('field.referenceNumber')}</dt>
                    <dd>{invoice.referenceNumber}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>
          {!ro && <ValidationPanel issues={issues} />}
          {ro && (
            <section className="panel einvoice-panel" aria-labelledby="einvoice-title">
              <h2 id="einvoice-title" className="panel-title">
                {t('einvoice.title')}
              </h2>
              {xmlIssues.length > 0 && (
                <ul className="notice notice-warn xml-issues">
                  {xmlIssues.map((i) => (
                    <li key={i.field + i.message.et}>{pick(i.message, lang)}</li>
                  ))}
                </ul>
              )}
              <details className="disclosure disclosure-plain">
                <summary>
                  <CaretRightIcon className="caret" />
                  <span className="disclosure-title">{t('editor.einvoiceMore')}</span>
                </summary>
                <p className="disclosure-body small">{t('einvoice.explain')}</p>
              </details>
            </section>
          )}
          <PdfPreview invoice={effective} />
        </aside>
      </div>

      {dialog === 'issue' && <IssueDialog predictedNumber={predicted} warnings={warnings.length} stale={stale} onClose={() => setDialog(null)} onConfirm={issue} />}
      {dialog === 'paid' && <MarkPaidDialog invoice={invoice} onClose={() => setDialog(null)} onConfirm={(paidAt) => changeStatus((id) => app.markInvoicePaid(id, paidAt)).then(() => toast.success(t('actions.markedPaid', { number: invoice.number })))} />}
      {dialog === 'email' && <EmailDialog invoice={effective} onClose={() => setDialog(null)} />}
    </div>
  )
}
