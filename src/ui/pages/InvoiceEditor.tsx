import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowUUpLeftIcon,
  BellRingingIcon,
  CaretRightIcon,
  CheckIcon,
  ClipboardTextIcon,
  CloudArrowUpIcon,
  CopyIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  FileCodeIcon,
  FilePlusIcon,
  LockSimpleIcon,
  NoteIcon,
  PencilSimpleIcon,
  PrinterIcon,
  ProhibitIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  applyClientTerms,
  clientPaymentTermDays,
  computeTotals,
  holdsNumber,
  newId,
  isValidReferenceNumber,
  numberingFor,
  numberingPeriod,
  predictNumber,
  sameNumberingPeriod,
  quoteStatus,
  stopRulesFor,
  upcomingNumbers,
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
  type InvoiceType,
  type ValidationIssue,
} from '../../domain'
import { buildUblXml, eInvoiceIssues, supportsEInvoice } from '../../einvoice'
import { downloadBlob, googleSignIn, uploadToDrive } from '../../integrations'
import { invoiceFileName, preloadPdfMake, renderInvoicePdf, renderInvoicePdfBase64 } from '../../pdf'
import { useApp } from '../AppContext'
import { BrandColors, TemplatePicker } from '../components/Appearance'
import { ExchangeRateButton } from '../components/ExchangeRateButton'
import { useConfirm } from '../components/Dialog'
import { pick } from '../i18n'
import { CheckboxField, DecimalInput, FieldShell, fieldId, NumberField, SelectField, TextAreaField, TextField } from '../components/fields'
import { IconButton, Menu, Skeleton, type MenuItem } from '../components/ui'
import { formatDate, formatIban } from '../format'
import { CURRENCIES, languageOptions, templateName, vatSchemeOptions } from '../options'
import { issueKeys } from '../shortcuts'
import { useToast } from '../Toasts'
import { accentColor, addDaysISO, daysBetween, displayStatus, effectiveInvoice, errorMessage, isCreditSettled, isUnpaid, localTodayISO, normalizeInvoice, nowISO, buyerFromClient } from '../util'
import { BuyerSection } from './editor/BuyerSection'
import { appearanceMatchesDefaults, copyLines, creditNoteFor, duplicateInvoice, linesAreBlank, newDraft, redateInvoice, savedClientOf } from './editor/builders'
import { AppearanceSummary } from './editor/AppearanceSummary'
import { CopyLinesOffer } from './editor/CopyLinesOffer'
import { latestInvoiceFor } from './products'
import { DueAmount, EdSection, MoreOptions, NextStep, QuoteStatusWord, SaveIndicator, StatusWord } from './editor/EditorParts'
import { EmailDialog } from './editor/EmailDialog'
import { markSent } from './invoice-detail/sent'
import { docNoun, localDateOf } from './invoice-detail/status'
import { LinesEditor } from './editor/LinesEditor'
import { RecurringControl } from './editor/RecurringControl'
import { QuoteActions } from './quotes/QuoteActions'
import { QuoteIssueDialog, type StaleQuoteDate } from './quotes/QuoteIssueDialog'
import { PreviewPanel } from './editor/PdfPreview'
import { useFixedBarHeight } from './editor/useFixedBarHeight'
import { useMediaQuery } from './editor/useMediaQuery'
import { DeleteInvoiceDialog, IssueDialog, MarkPaidDialog, type StaleIssueDate } from './editor/StatusDialogs'
import { LockNote } from './invoice-detail/LockNote'
import { hasPaymentDetails, useCopyPaymentDetails } from './invoice-detail/paymentDetails'
import { reopenRuleKey, useCanReopen, useDeleteDocument } from './invoice-detail/useInvoiceActions'
import { TextRows } from './editor/TextRows'
import { useAutosave } from './editor/useAutosave'
import { ValidationPanel } from './editor/ValidationPanel'

const TERM_PRESETS = [7, 14, 30]
const VALIDITY_PRESETS = [14, 30, 60]

/** Below this the preview is a full-screen sheet; above it, a panel docked beside the form. */
const SHEET_QUERY = '(max-width: 1023px)'
const PREVIEW_KEY = 'invoice-generator:editorPreview'

function rememberedPreview(): boolean {
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia(SHEET_QUERY).matches) return false
    return localStorage.getItem(PREVIEW_KEY) === '1'
  } catch {
    return false
  }
}

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

function EditorSkeleton() {
  const { t } = useApp()
  return (
    <div className="page ed" role="status" aria-label={t('common.loading')}>
      <div className="ed-layout">
        <div className="ed-main">
          <Skeleton w={90} />
          <Skeleton w={220} h={24} className="sk-title" />
          {[0, 1, 2].map((i) => (
            <div className="ed-section" key={i}>
              <Skeleton w={140} h={16} />
              <Skeleton w="100%" h={32} />
              <Skeleton w="60%" h={32} />
            </div>
          ))}
        </div>
        <div className="ed-side ed-side-skeleton">
          <Skeleton w="50%" />
          <Skeleton w="80%" h={28} />
          <Skeleton w="100%" h={36} />
        </div>
      </div>
    </div>
  )
}

/** Stand-in for useCanReopen while the invoice loads (hooks run before the loading state returns). */
const REOPEN_PLACEHOLDER = { id: '', number: '', type: 'invoice', status: 'draft', issueDate: '' } as unknown as Invoice

/** UI-level suggestion: without an e-mail address the invoice cannot be sent from the app. */
const EMAIL_SUGGESTION: ValidationIssue = {
  field: 'buyer.email',
  severity: 'warning',
  message: { et: 'Lisa ostja e-posti aadress, et arvet e-kirjaga saata.', en: 'Add the buyer’s e-mail address to send the invoice by e-mail.' },
}

function InvoiceEditor({ id, editorKey }: { id: string; editorKey: string }) {
  const app = useApp()
  const { t, lang, profile, clients, settings } = app
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const location = useLocation()
  const [search] = useSearchParams()
  // Arriving from "Jätka koostamist": focus lands on the title so keyboard users start from the top of the form.
  const focusTitle = !!(location.state as { focusTitle?: boolean } | null)?.focusTitle
  const titleRef = useRef<HTMLHeadingElement>(null)

  const [invoice, setInvoiceState] = useState<Invoice | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [dialog, setDialog] = useState<null | 'issue' | 'paid' | 'email' | 'reminder' | 'delete'>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [justIssued, setJustIssued] = useState(false)
  // Docked preview: its open state is remembered between visits. On phones it is a sheet and starts closed.
  const sheet = useMediaQuery(SHEET_QUERY)
  const [previewOpen, setPreviewOpenState] = useState(rememberedPreview)
  const [prevSheet, setPrevSheet] = useState(sheet)
  if (prevSheet !== sheet) {
    setPrevSheet(sheet)
    setPreviewOpenState(sheet ? false : rememberedPreview())
  }
  const setPreviewOpen = useCallback(
    (open: boolean) => {
      setPreviewOpenState(open)
      if (sheet) return
      try {
        localStorage.setItem(PREVIEW_KEY, open ? '1' : '0')
      } catch {
        /* storage unavailable */
      }
    },
    [sheet],
  )
  // A new invoice starts in the client search (not on phones, where focus would pop up the keyboard).
  const [autoFocusBuyer] = useState(() => id === 'new' && !focusTitle && !sheet)
  // Ctrl/⌘+Enter asks to issue; each blocked attempt reveals the checklist (counter as a signal).
  const [checkReveal, setCheckReveal] = useState(0)
  // Appearance that follows the company defaults is one summary line until the user asks to change it.
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  // A blank draft keeps its checklist folded until the user starts (picks a buyer, adds a line, tries to issue).
  const [engaged, setEngaged] = useState(false)
  if (!engaged && invoice && invoice.status === 'draft' && (!!invoice.buyer.name || invoice.lines.length > 1 || !linesAreBlank(invoice.lines))) setEngaged(true)
  const issueKeyRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.repeat || e.defaultPrevented) return
      const request = issueKeyRef.current
      if (!request || document.querySelector('[role="dialog"], [role="menu"]')) return
      e.preventDefault()
      request()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const persistedRef = useRef(false)
  const previewBtn = useRef<HTMLButtonElement>(null)
  const previewOpener = useRef<HTMLElement | null>(null)
  const barRef = useFixedBarHeight()
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
  // Opened by the remembered state or a template pick: Escape in the panel returns focus to the header toggle.
  useEffect(() => {
    if (previewOpen && !previewOpener.current) previewOpener.current = previewBtn.current
  })

  // Load (or create in memory) once per editor instance.
  useEffect(() => {
    if (!profile) return
    if (id === 'new') {
      const clientId = search.get('client')
      const client = clientId ? clients.find((c) => c.id === clientId) : undefined
      setInvoice(newDraft(profile, client, search.get('type') === 'quote' ? 'quote' : 'invoice'))
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

  const loaded = !!invoice
  useEffect(() => {
    if (loaded && focusTitle) titleRef.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  const { markDirty } = autosave
  const deleteDocument = useDeleteDocument()
  const copyPayment = useCopyPaymentDetails()
  const canReopen = useCanReopen(invoice ?? REOPEN_PLACEHOLDER)
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
  const numbered = holdsNumber(invoice)
  const reopened = !ro && numbered
  const status = displayStatus(invoice, undefined, app.invoices)
  const unpaid = isUnpaid(invoice, app.invoices)
  const credit = invoice.type === 'credit-note'
  const quote = invoice.type === 'quote'
  const qStatus = quote ? quoteStatus(invoice, undefined, app.invoices) : null
  const sourceQuote = invoice.convertedFromQuoteId ? app.invoices.find((i) => i.id === invoice.convertedFromQuoteId) : undefined
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const checklist = !ro && invoice.buyer.name && !invoice.buyer.email ? [...issues, EMAIL_SUGGESTION] : issues
  const series = numberingFor(profile, invoice.type)
  // Issuing skips numbers any document already has (e.g. after merging a backup); the preview does the same.
  const usedNumbers = new Set(app.invoices.filter((i) => i.number && i.id !== invoice.id).map((i) => i.number))
  const numberFor = (date: string) => upcomingNumbers(series, date, usedNumbers, 1)[0] ?? predictNumber(series, date)
  const predicted = reopened ? invoice.number : numberFor(invoice.issueDate)
  // A reopened document keeps its number, so its date stays within the numbering period of that number.
  const reopenAnchor = reopened ? (invoice.reopenedIssueDate ?? invoice.issueDate) : ''
  const reopenPeriod = reopened ? numberingPeriod(series, reopenAnchor) : null
  const keepsPeriod = (date: string) => !reopened || sameNumberingPeriod(series, reopenAnchor, date)
  const dateLimit = reopenPeriod
    ? { min: reopenPeriod.start, max: reopenPeriod.end, hint: t('reopen.dateLimit', { start: formatDate(reopenPeriod.start), end: formatDate(reopenPeriod.end) }) }
    : {}
  const term = daysBetween(invoice.issueDate, invoice.dueDate)
  const validity = invoice.validUntil ? daysBetween(invoice.issueDate, invoice.validUntil) : 0
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
  const xmlIssues = ro && supportsEInvoice(invoice) ? eInvoiceIssues(invoice) : []
  const today = localTodayISO()
  // A reopened document gets the "move to today" offer only while today is in the numbering period of its number.
  const stale: StaleIssueDate | null =
    !ro && keepsPeriod(today) && /^\d{4}-\d{2}-\d{2}$/.test(invoice.issueDate) && invoice.issueDate < today
      ? {
          date: invoice.issueDate,
          today,
          newDueDate: redateInvoice(invoice, today).dueDate,
          supplyDateMoves: !!invoice.supplyDate && invoice.supplyDate === invoice.issueDate,
          numberWithToday: reopened ? invoice.number : numberFor(today),
        }
      : null
  const staleQuote: StaleQuoteDate | null = stale && quote ? { date: stale.date, today, validUntil: redateInvoice(invoice, today).validUntil ?? today, numberWithToday: stale.numberWithToday } : null
  const buyerFieldIssue = !!invoice.buyer.name && issues.some((i) => i.field.startsWith('buyer.'))
  const creditedBy =
    ro && invoice.type !== 'credit-note' && invoice.number
      ? app.invoices.filter((i) => i.type === 'credit-note' && i.id !== invoice.id && i.status !== 'cancelled' && i.creditedInvoiceNumber?.trim() === invoice.number)
      : []
  const hasGoogle = !!settings.googleClientId
  // The saved client behind the buyer: its internal note is shown while writing, never printed.
  const pickedClient = invoice.buyer.clientId ? clients.find((c) => c.id === invoice.buyer.clientId) : undefined
  const clientNote = !ro ? pickedClient?.notes?.trim() : undefined
  // A regular client's last invoice, offered for copying while the draft's lines are still empty.
  const copySource =
    !ro && !numbered && (invoice.type === 'invoice' || invoice.type === 'prepayment') && invoice.buyer.name && linesAreBlank(invoice.lines)
      ? latestInvoiceFor(app.invoices, invoice.buyer, invoice.currency)
      : undefined
  const clientForNew = savedClientOf(invoice, clients)
  const termFromClient = !ro && pickedClient?.paymentTermDays !== undefined && term === clientPaymentTermDays(profile, pickedClient)
  const payable = hasPaymentDetails(invoice, app.invoices)
  const appearanceCollapsed = !ro && !appearanceOpen && appearanceMatchesDefaults(invoice, profile, pickedClient)
  // Issued invoices read as a document: optional fields that were left empty are not shown.
  const shown = (v: unknown) => !ro || (v !== undefined && v !== null && v !== '')

  const title = quote
    ? invoice.number
      ? t('quote.title', { number: invoice.number })
      : t('quote.newTitle')
    : invoice.number
      ? t(invoice.type === 'credit-note' ? 'editor.titleCredit' : 'editor.title', { number: invoice.number })
      : t(invoice.type === 'credit-note' ? 'editor.newCredit' : 'editor.new')
  const deadline = quote
    ? invoice.validUntil
      ? t('quote.validTill', { date: formatDate(invoice.validUntil) })
      : ''
    : invoice.dueDate
      ? t('editor.dueMeta', { date: formatDate(invoice.dueDate) })
      : ''
  const meta = [invoice.buyer.name || t('list.noClient'), deadline].filter(Boolean).join(' · ')

  // What "Lisavalikud" holds right now, so a closed section still tells what is in use.
  const inUse = [
    invoice.type !== 'invoice' && !quote ? t(`invoice.type.${invoice.type}`) : '',
    invoice.supplyDate ? t('field.supplyDate') : '',
    invoice.periodStart || invoice.periodEnd ? t('editor.period') : '',
    invoice.orderReference ? t('field.orderReference') : '',
    invoice.lateInterestPercentPerDay && !quote ? t('field.lateInterest') : '',
    invoice.currency.toUpperCase() !== 'EUR' ? invoice.currency : '',
    accounts.length > 1 && invoice.bankAccountIds.length > 0 && !quote ? t('editor.bankAccounts') : '',
    invoice.notes ? t('field.notes') : '',
  ].filter(Boolean)
  const moreSummary = inUse.length ? t('editor.moreInUse', { list: inUse.join(', ') }) : t(quote ? 'quote.moreHintCalm' : 'editor.moreHintCalm')

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
        // The PDF goes inside the XML, so it must not carry its own embedded copy of the XML.
        pdf = { base64: await renderInvoicePdfBase64(invoice, { embedEInvoice: false }), fileName: invoiceFileName(invoice, 'pdf') }
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
  const newForClient = (c: Client) => navigate(`/invoices/new?client=${encodeURIComponent(c.id)}`)

  const copyLinesFrom = (src: Invoice) => {
    const before = invoice.lines
    set({ lines: copyLines(src, invoice, profile) })
    toast.success(t('copyLines.done', { number: src.number }), {
      label: t('payment.undo'),
      onClick: () => {
        set({ lines: before })
        toast.info(t('copyLines.undone'))
      },
    })
    // The offer disappears with the click: continue in the first copied line (usually the quantity changes).
    requestAnimationFrame(() => document.getElementById(fieldId('lines.0.quantity'))?.focus())
  }

  const creditNote = () => openCopy(creditNoteFor(invoice, profile), t('actions.creditCreated', { number: invoice.number }))

  const cancelInvoice = async () => {
    const ok = await confirm({
      title: t('actions.cancelTitle', { number: invoice.number }),
      message: t('actions.cancelConfirm'),
      confirmLabel: t('actions.cancelInvoice'),
      cancelLabel: t('common.back'),
      danger: true,
    })
    if (!ok) return
    await act('cancel', async () => {
      await changeStatus(app.cancelInvoice)
      // A cancelled invoice is not repeated any more.
      const rules = stopRulesFor(app.recurringRules, invoice.id, nowISO())
      for (const rule of rules) await app.saveRecurringRule(rule)
      if (rules.length) toast.success(t('payment.cancelledOnly', { number: invoice.number }) + ' ' + t('recurring.stoppedOnCancel'))
    })
  }

  const deleteDraft = async () => {
    if (numbered) {
      setDialog('delete')
      return
    }
    const ok = await confirm({ title: t('actions.deleteDraftTitle'), message: t('actions.deleteDraftConfirm'), confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), danger: true })
    if (!ok) return
    setBusy('delete')
    try {
      // Wait for an in-flight (e.g. the very first) autosave, so it cannot recreate the record after the delete.
      await autosave.discard()
      await deleteDocument(invoice)
      navigate('/')
    } catch {
      // shown by deleteDocument
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const reopen = async () => {
    const doc = t(`invoice.type.${invoice.type}`)
    const ok = await confirm({
      title: t('reopen.title', { doc: doc.toLocaleLowerCase(), number: invoice.number }),
      message: (
        <>
          <p>{t('reopen.text', { doc, number: invoice.number })}</p>
          <p className="muted small">{t(reopenRuleKey(invoice.type))}</p>
        </>
      ),
      confirmLabel: t('reopen.action'),
      cancelLabel: t('common.cancel'),
    })
    if (!ok) return
    await act('reopen', async () => {
      setInvoice(await app.reopenInvoice(invoice.id))
      setJustIssued(false)
      toast.success(t('reopen.done', { doc, number: invoice.number }))
    })
  }

  const onPickClient = (c: Client) =>
    edit((inv) => {
      // Payment term and late interest follow the client card unless the user already changed them in this draft.
      const previous = inv.buyer.clientId ? clients.find((x) => x.id === inv.buyer.clientId) : undefined
      const withTerms = applyClientTerms(inv, profile, previous, c)
      return withVatScheme(
        { ...withTerms, buyer: buyerFromClient(c), language: c.defaultLanguage ?? inv.language },
        effectiveVatScheme(profile, c.defaultVatScheme ?? inv.vatScheme),
        profile.defaults.defaultVatRate,
      )
    })

  const setTerm = (days: number) => set({ dueDate: addDaysISO(invoice.issueDate, Math.max(0, Math.round(days))) })
  // A quote's due date mirrors its validity date (see asQuote).
  const setValidUntil = (validUntil: string) => set({ validUntil, dueDate: validUntil })
  const setValidity = (days: number) => setValidUntil(addDaysISO(invoice.issueDate, Math.max(0, Math.round(days))))

  const busyAny = busy !== null
  // Issue when the checks pass; otherwise open the checklist and move focus to it.
  const requestIssue = () => {
    if (busyAny) return
    setEngaged(true)
    if (errors.length > 0) setCheckReveal((n) => n + 1)
    else setDialog('issue')
  }
  issueKeyRef.current = ro ? null : requestIssue
  // One obvious action for an issued invoice; everything else lives in "Rohkem".
  const primary: null | 'email' | 'reminder' =
    !ro || justIssued || invoice.status === 'cancelled' || invoice.status === 'paid' || isCreditSettled(invoice, app.invoices) || (quote && qStatus !== 'sent')
      ? null
      : status === 'overdue'
        ? 'reminder'
        : 'email'
  const menuItems: MenuItem[] = [
    ...(invoice.status === 'paid' ? [{ key: 'email', label: t('actions.email'), icon: <EnvelopeSimpleIcon />, onSelect: () => setDialog('email') }] : []),
    ...(primary === 'reminder' || (quote && !primary && invoice.status !== 'cancelled') ? [{ key: 'email', label: t('actions.email'), icon: <EnvelopeSimpleIcon />, onSelect: () => setDialog('email') }] : []),
    { key: 'drive', label: t('actions.drive'), icon: <CloudArrowUpIcon />, onSelect: () => void saveToDrive() },
    ...(supportsEInvoice(invoice) ? [{ key: 'xml', label: t('actions.downloadXml'), icon: <FileCodeIcon />, onSelect: () => void downloadXml() }] : []),
    { key: 'print', label: t('actions.print'), icon: <PrinterIcon />, onSelect: () => void print() },
    ...(payable ? [{ key: 'copyPayment', label: t('actions.copyPayment'), icon: <ClipboardTextIcon />, onSelect: () => void copyPayment(effective) }] : []),
    ...(canReopen ? [{ key: 'reopen', label: t('reopen.action'), icon: <PencilSimpleIcon />, separatorBefore: true, onSelect: () => void reopen() }] : []),
    { key: 'duplicate', label: t('actions.duplicate'), icon: <CopyIcon />, separatorBefore: !canReopen, onSelect: () => void duplicate() },
    ...(clientForNew ? [{ key: 'newForClient', label: t('actions.newForClient'), icon: <FilePlusIcon />, onSelect: () => newForClient(clientForNew) }] : []),
    ...(invoice.type !== 'credit-note' && !quote && invoice.status !== 'cancelled' ? [{ key: 'credit', label: t('actions.creditNote'), icon: <ArrowUUpLeftIcon />, onSelect: () => void creditNote() }] : []),
    ...(invoice.status === 'paid' ? [{ key: 'unpaid', label: t('actions.markUnpaid'), icon: <ArrowCounterClockwiseIcon />, onSelect: () => void act('unpaid', () => changeStatus(app.markInvoiceUnpaid)) }] : []),
    ...(invoice.status === 'issued' && !quote && !credit ? [{ key: 'cancel', label: t('actions.cancelInvoice'), icon: <ProhibitIcon />, danger: true, separatorBefore: true, onSelect: () => void cancelInvoice() }] : []),
    {
      key: 'delete',
      label: t('delete.menu', { doc: docNoun(t, invoice) }),
      icon: <TrashIcon />,
      danger: true,
      separatorBefore: !(invoice.status === 'issued' && !quote && !credit),
      onSelect: () => setDialog('delete'),
    },
  ]

  const togglePreview = (opener: HTMLElement) => {
    previewOpener.current = opener
    setPreviewOpen(!previewOpen)
  }

  const pdfButton = (
    <button type="button" className="btn btn-sm" onClick={() => void downloadPdf()} disabled={busyAny}>
      <DownloadSimpleIcon />
      {busy === 'pdf' ? t('common.working') : ro ? t('actions.downloadPdf') : t('actions.previewPdf')}
    </button>
  )

  return (
    <div className={`page ed${ro ? ' ed-ro' : ' ed-draft'}${previewOpen && !sheet ? ' ed-pv' : ''}`}>
      <div className="ed-layout">
        <div className="ed-main">
          {!ro && (
            <a
              href="#ed-side"
              className="ed-skip"
              onClick={(e) => {
                e.preventDefault()
                const target = document.querySelector<HTMLElement>('.ed-issue-btn:not(:disabled)') ?? document.getElementById('ed-side')
                target?.focus()
              }}
            >
              {t('editor.skipToIssue')}
            </a>
          )}
          <header className="ed-head">
            <Link to="/" className="back-link">
              <ArrowLeftIcon />
              {t('nav.invoices')}
            </Link>
            <div className="ed-head-row">
              <div className="ed-title">
                <div className="ed-title-line">
                  <h1 ref={titleRef} tabIndex={-1}>
                    {title}
                  </h1>
                  {ro && (qStatus ? <QuoteStatusWord status={qStatus} sent={app.invoiceEvents.some((e) => e.invoiceId === invoice.id && e.kind === 'sent')} /> : <StatusWord status={status} />)}
                </div>
                <p className="ed-meta">{ro ? meta : <SaveIndicator state={autosave.state} onRetry={() => void autosave.flush()} />}</p>
              </div>
              <div className="ed-head-actions" role="group" aria-label={t('editor.actions')}>
                <button
                  ref={previewBtn}
                  type="button"
                  className={`btn${ro ? ' btn-text' : ''}`}
                  aria-expanded={previewOpen}
                  aria-controls={previewOpen ? 'ed-preview' : undefined}
                  onClick={(e) => togglePreview(e.currentTarget)}
                >
                  <EyeIcon />
                  {t('preview.title')}
                </button>
                {!ro && (
                  <IconButton
                    label={numbered ? t('delete.menu', { doc: docNoun(t, invoice) }) : t('actions.deleteDraft')}
                    icon={<TrashIcon size={18} />}
                    className="icon-btn-danger"
                    onClick={() => void deleteDraft()}
                    disabled={busyAny}
                  />
                )}
                {ro && (
                  <>
                    <button type="button" className="btn btn-text" onClick={() => void downloadPdf()} disabled={busyAny} title={t('actions.downloadPdf')}>
                      <DownloadSimpleIcon />
                      {busy === 'pdf' ? t('common.working') : t('editor.pdf')}
                    </button>
                    <Menu label={t('common.more')} text={t('editor.moreActions')} items={menuItems} disabled={busyAny} />
                  </>
                )}
              </div>
            </div>
          </header>

          {sourceQuote && (
            <p className="ed-origin">
              {t('quote.fromQuote')} <Link to={`/?id=${sourceQuote.id}`}>{sourceQuote.number || t('quote.draftNumber')}</Link>
            </p>
          )}

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
          {ro && justIssued && payable && (
            <p className="next-copy">
              <button type="button" className="ed-text-btn" onClick={() => void copyPayment(effective)}>
                <ClipboardTextIcon />
                {t('actions.copyPayment')}
              </button>
              <span className="next-copy-hint">{t('payment.detailsHint')}</span>
            </p>
          )}

          {reopened && (
            <div className="ed-locked ed-reopened">
              <PencilSimpleIcon size={16} className="ed-locked-icon" />
              <p>{t('reopen.banner', { number: invoice.number })}</p>
            </div>
          )}

          {ro && (
            <div className={`ed-locked${invoice.status === 'cancelled' ? ' ed-locked-warn' : ''}`}>
              <LockSimpleIcon size={16} className="ed-locked-icon" />
              <div>
                <p>
                  <LockNote
                    invoice={invoice}
                    creditLink={
                      <button type="button" className="link-btn" onClick={() => void creditNote()} disabled={busyAny}>
                        {t('detail.lockedLink')}
                      </button>
                    }
                  />
                </p>
                {canReopen && (
                  <p>
                    <button type="button" className="link-btn" onClick={() => void reopen()} disabled={busyAny}>
                      {t('reopen.action')}
                    </button>
                  </p>
                )}
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
            </div>
          )}

          <fieldset className="ed-form" disabled={ro}>
            <legend className="visually-hidden">{title}</legend>

            <EdSection id="sec-buyer" title={t('editor.buyer')}>
              <BuyerSection buyer={invoice.buyer} onChange={(buyer: BuyerSnapshot) => set({ buyer })} onPickClient={onPickClient} disabled={ro} forceEdit={buyerFieldIssue} autoFocus={autoFocusBuyer} />
              {clientNote && (
                <div className="ed-client-note" role="note" aria-label={t('editor.clientNote')}>
                  <NoteIcon size={16} className="ed-client-note-icon" aria-hidden="true" />
                  <div>
                    <p className="ed-client-note-label">{t('editor.clientNote')}</p>
                    <p className="ed-client-note-text">{clientNote}</p>
                  </div>
                </div>
              )}
            </EdSection>

            <EdSection
              id="sec-lines"
              title={quote ? t('quote.sectionLines') : t('editor.sectionLines')}
              aside={totals.showVat ? t('editor.pricesExclVat') : undefined}
              hint={invoice.type === 'credit-note' ? t('editor.creditLinesHint') : undefined}
            >
              {copySource && <CopyLinesOffer source={copySource} onCopy={() => copyLinesFrom(copySource)} />}
              <TextRows kind="before" rows={invoice.textBefore} onChange={(textBefore) => set({ textBefore })} disabled={ro} quote={quote} />
              <LinesEditor
                catalogue={!credit}
                lines={invoice.lines}
                onChange={(lines) => set({ lines })}
                buyer={invoice.buyer}
                vatScheme={invoice.vatScheme}
                currency={invoice.currency}
                totals={totals}
                defaultUnit={profile.defaults.defaultUnit}
                defaultVatRate={profile.defaults.defaultVatRate}
                disabled={ro}
                grossLabel={credit ? t('totals.credited') : quote ? t('totals.grossShort') : undefined}
              />
              <TextRows kind="after" rows={invoice.textAfter} onChange={(textAfter) => set({ textAfter })} disabled={ro} quote={quote} />
            </EdSection>

            <EdSection id="sec-terms" title={quote ? t('quote.sectionTerms') : t('editor.sectionPayment')}>
              {quote ? (
                <div className="grid">
                  <TextField
                    label={t('quote.fieldDate')}
                    type="date"
                    path="issueDate"
                    value={invoice.issueDate}
                    onChange={(v) => v && keepsPeriod(v) && set({ issueDate: v, validUntil: addDaysISO(v, Math.max(0, validity)), dueDate: addDaysISO(v, Math.max(0, validity)) })}
                    required
                    {...dateLimit}
                  />
                  <TextField label={t('quote.validUntil')} type="date" path="validUntil" value={invoice.validUntil} onChange={(v) => v && setValidUntil(v)} min={invoice.issueDate} required />
                  {!ro && (
                    <FieldShell id={fieldId('validity')} label={t('quote.validDays')} className="span-2">
                      <div className="term-row">
                        <div className="input-suffix term-days">
                          <DecimalInput id={fieldId('validity')} className="num" value={validity} onChange={(v) => setValidity(v ?? 0)} />
                          <span aria-hidden="true">{t('common.days')}</span>
                        </div>
                        <div className="chip-group" role="group" aria-label={t('quote.validDays')}>
                          {VALIDITY_PRESETS.map((d) => (
                            <button key={d} type="button" className="chip-btn" aria-pressed={validity === d} onClick={() => setValidity(d)}>
                              {t('editor.termDays', { days: d })}
                            </button>
                          ))}
                        </div>
                      </div>
                    </FieldShell>
                  )}
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
              ) : (
              <div className="grid">
                {invoice.type === 'credit-note' && (
                  <TextField
                    className="span-2"
                    label={t('field.creditedInvoiceNumber')}
                    path="creditedInvoiceNumber"
                    value={invoice.creditedInvoiceNumber}
                    onChange={(v) => set({ creditedInvoiceNumber: v || undefined })}
                    required
                  />
                )}
                <TextField
                  label={t('field.issueDate')}
                  type="date"
                  path="issueDate"
                  value={invoice.issueDate}
                  onChange={(v) => v && keepsPeriod(v) && set({ issueDate: v, dueDate: addDaysISO(v, Math.max(0, term)) })}
                  required
                  {...dateLimit}
                />
                <TextField label={t('field.dueDate')} type="date" path="dueDate" value={invoice.dueDate} onChange={(v) => v && set({ dueDate: v })} min={invoice.issueDate} required />
                <FieldShell id={fieldId('paymentTerm')} label={t('field.paymentTerm')} className="span-2" hint={termFromClient ? t('editor.termFromClient') : undefined}>
                  <div className="term-row">
                    <div className="input-suffix term-days">
                      <DecimalInput id={fieldId('paymentTerm')} className="num" value={term} onChange={(v) => setTerm(v ?? 0)} aria-describedby={termFromClient ? fieldId('paymentTerm') + '-hint' : undefined} />
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
                {shown(invoice.referenceNumber) && (
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
                      className="tnum"
                      value={invoice.referenceNumber ?? ''}
                      aria-invalid={invoice.referenceNumber && !isValidReferenceNumber(invoice.referenceNumber) ? true : undefined}
                      aria-describedby={invoice.referenceNumber ? undefined : fieldId('referenceNumber') + '-hint'}
                      onChange={(e) => set({ referenceNumber: e.target.value.replace(/\s+/g, '') || undefined })}
                    />
                  </FieldShell>
                )}
              </div>
              )}
              {quote && !ro && <p className="ed-quote-note">{t('quote.noPayment')}</p>}
              {!profile.vatRegistered && invoice.vatScheme !== 'not-registered' && !ro && <p className="notice notice-warn">{t('editor.notVatRegistered')}</p>}
              {showNoteField && shown(invoice.vatExemptionNote) && (
                <TextField label={noteField.label} path="vatExemptionNote" value={invoice.vatExemptionNote} onChange={(v) => set({ vatExemptionNote: v || undefined })} hint={noteField.hint} />
              )}
              {note && (
                <p className="printed-note">
                  <span className="printed-label">{t('editor.printedNote')}</span> {note}
                </p>
              )}
            </EdSection>

            <EdSection id="sec-appearance" title={t('editor.appearance')}>
              {ro ? (
                <dl className="ed-design-facts">
                  <div>
                    <dt>{t(quote ? 'quote.language' : 'field.invoiceLanguage')}</dt>
                    <dd>{languageOptions(t).find((o) => o.value === invoice.language)?.label ?? invoice.language}</dd>
                  </div>
                  <div>
                    <dt>{t('appearance.template')}</dt>
                    <dd>{templateName(invoice.templateId, lang)}</dd>
                  </div>
                  <div>
                    <dt>{t('appearance.mode')}</dt>
                    <dd className="ed-design-colors">
                      {(invoice.colorMode ?? 'accent') !== 'mono' && <span className="ed-swatch" style={{ background: accentColor(invoice.accentColor) }} aria-hidden="true" />}
                      {invoice.colorMode === 'duo' && invoice.secondaryColor && <span className="ed-swatch" style={{ background: accentColor(invoice.secondaryColor) }} aria-hidden="true" />}
                      {t(`appearance.mode.${invoice.colorMode ?? 'accent'}`)}
                    </dd>
                  </div>
                  {invoice.paymentQr && !quote && (
                    <div>
                      <dt>{t('editor.paymentQrShort')}</dt>
                      <dd>{t('editor.paymentQrOn')}</dd>
                    </div>
                  )}
                </dl>
              ) : appearanceCollapsed ? (
                <AppearanceSummary
                  invoice={invoice}
                  onChange={() => {
                    setAppearanceOpen(true)
                    requestAnimationFrame(() => document.getElementById(fieldId('language'))?.focus())
                  }}
                />
              ) : (
                <>
                <div className="grid">
                  <SelectField label={t(quote ? 'quote.language' : 'field.invoiceLanguage')} path="language" value={invoice.language} onChange={(language) => set({ language })} options={languageOptions(t)} />
                </div>
                <TemplatePicker
                  value={invoice.templateId}
                  onChange={(templateId) => {
                    set({ templateId })
                    // Choosing a design is easiest while seeing it: open the docked preview.
                    if (!previewOpen && !sheet) setPreviewOpen(true)
                  }}
                  accent={invoice.accentColor}
                  secondary={invoice.secondaryColor}
                  mode={invoice.colorMode}
                  disabled={ro}
                  compact
                />
                <BrandColors
                  value={{ accentColor: invoice.accentColor, secondaryColor: invoice.secondaryColor, colorMode: invoice.colorMode }}
                  onChange={(patch) => set(patch)}
                  logoDataUrl={effective.seller.logoDataUrl ?? profile.logoDataUrl}
                  disabled={ro}
                  compact
                />
                {!quote && <CheckboxField label={t('field.paymentQr')} hint={t('field.paymentQrHint')} checked={!!invoice.paymentQr} onChange={(paymentQr) => set({ paymentQr })} disabled={ro} />}
                {!ro && (
                  <p className="ed-quiet">
                    {t('editor.designNote')} <Link to="/company">{t('editor.designNoteLink')}</Link>.
                  </p>
                )}
                </>
              )}
            </EdSection>

            <MoreOptions initiallyOpen={ro} summary={moreSummary}>
              <div className="grid">
                {!quote && (
                  <SelectField<InvoiceType>
                    label={t('field.invoiceType')}
                    path="type"
                    value={invoice.type}
                    onChange={(type) => set({ type })}
                    options={(['invoice', 'prepayment', 'credit-note'] as const).map((v) => ({ value: v, label: t(`invoice.type.${v}`) }))}
                  />
                )}
                {shown(invoice.supplyDate) && (
                  <TextField label={t('field.supplyDate')} type="date" path="supplyDate" value={invoice.supplyDate} onChange={(v) => set({ supplyDate: v || undefined })} hint={t('field.supplyDateHint')} />
                )}
                {shown(invoice.periodStart) && <TextField label={t('field.periodStart')} type="date" path="periodStart" value={invoice.periodStart} onChange={(v) => set({ periodStart: v || undefined })} />}
                {shown(invoice.periodEnd) && <TextField label={t('field.periodEnd')} type="date" path="periodEnd" value={invoice.periodEnd} onChange={(v) => set({ periodEnd: v || undefined })} min={invoice.periodStart} />}
                {shown(invoice.orderReference) && <TextField label={t('field.orderReference')} path="orderReference" value={invoice.orderReference} onChange={(v) => set({ orderReference: v || undefined })} />}
                {shown(invoice.lateInterestPercentPerDay) && !quote && (
                  <NumberField
                    label={t('field.lateInterest')}
                    path="lateInterestPercentPerDay"
                    value={invoice.lateInterestPercentPerDay}
                    onChange={(v) => set({ lateInterestPercentPerDay: v ?? undefined })}
                    allowEmpty
                    suffix={t('common.percentPerDay')}
                  />
                )}
                <SelectField label={t('field.currency')} path="currency" value={invoice.currency} onChange={(currency) => set({ currency })} options={[...new Set([invoice.currency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))} />
                {invoice.currency.toUpperCase() !== 'EUR' && totals.vat !== 0 && !quote && (
                  <div className="ed-rate">
                    <NumberField
                      label={t('field.eurExchangeRate')}
                      hint={t('field.eurExchangeRateHint', { currency: invoice.currency })}
                      path="eurExchangeRate"
                      value={invoice.eurExchangeRate}
                      onChange={(v) => set({ eurExchangeRate: v ?? undefined })}
                      allowEmpty
                    />
                    {!ro && <ExchangeRateButton currency={invoice.currency} date={invoice.supplyDate || invoice.issueDate} onRate={(rate) => set({ eurExchangeRate: rate })} />}
                  </div>
                )}
              </div>
              {accounts.length > 1 && !quote && (
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
                        <span className="tnum">{formatIban(a.iban)}</span>
                        {a.bankName && <span className="muted">{a.bankName}</span>}
                      </label>
                    )
                  })}
                </fieldset>
              )}
              {shown(invoice.notes) && <TextAreaField label={t('field.notes')} path="notes" value={invoice.notes} onChange={(v) => set({ notes: v || undefined })} hint={t('field.notesHint')} rows={3} />}
            </MoreOptions>
          </fieldset>
        </div>

        <div className="ed-dock">
        {!ro ? (
          <aside ref={barRef} id="ed-side" className="ed-side" aria-label={t('editor.sideLabel')} tabIndex={-1}>
            <DueAmount totals={totals} currency={invoice.currency} label={credit ? t('totals.credited') : quote ? t('totals.grossShort') : undefined} />
            <ValidationPanel issues={checklist} summaryId="issue-summary" reveal={checkReveal} calm={!engaged} />
            {sheet && (
              <IconButton className="ed-bar-preview" label={t('preview.title')} icon={<EyeIcon size={20} />} aria-expanded={previewOpen} onClick={(e) => togglePreview(e.currentTarget)} />
            )}
            <div className="ed-issue">
              <button
                type="button"
                className="btn btn-primary ed-issue-btn"
                onClick={requestIssue}
                disabled={busyAny}
                aria-disabled={errors.length > 0 || undefined}
                title={errors.length ? t(quote ? 'quote.issueBlocked' : 'issue.blocked') : t('shortcuts.issueTitle', { keys: issueKeys() })}
                aria-describedby={errors.length ? 'issue-summary' : 'issue-note'}
                aria-keyshortcuts="Control+Enter Meta+Enter"
              >
                {quote ? t('quote.issue') : t(credit ? 'actions.issueCredit' : 'actions.issue')}
              </button>
              <p id="issue-note" className="ed-issue-note">
                {reopened
                  ? t('reopen.willKeepNumber', { number: predicted })
                  : quote
                    ? t('quote.willGetNumber', { number: predicted })
                    : t(credit ? 'editor.willGetNumberCredit' : 'editor.willGetNumber', { number: predicted })}
              </p>
            </div>
          </aside>
        ) : (
          <aside className="ed-side ed-side-ro" aria-label={t('editor.sideLabel')}>
            <DueAmount totals={totals} currency={invoice.currency} label={credit ? t('totals.credited') : quote ? t('totals.grossShort') : undefined} />
            <dl className="ed-facts">
              {invoice.issuedAt && (
                <div>
                  <dt>{t('status.issued')}</dt>
                  <dd>{formatDate(localDateOf(invoice.issuedAt))}</dd>
                </div>
              )}
              {quote ? (
                invoice.validUntil && (
                  <div>
                    <dt>{t('quote.validUntil')}</dt>
                    <dd>{formatDate(invoice.validUntil)}</dd>
                  </div>
                )
              ) : (
                <div>
                  <dt>{t('field.dueDate')}</dt>
                  <dd className={status === 'overdue' ? 'ed-overdue' : undefined}>{formatDate(invoice.dueDate)}</dd>
                </div>
              )}
              {invoice.paidAt && (
                <div>
                  <dt>{t('status.paid')}</dt>
                  <dd>{formatDate(invoice.paidAt)}</dd>
                </div>
              )}
              {invoice.referenceNumber && (
                <div>
                  <dt>{t('field.referenceNumber')}</dt>
                  <dd className="tnum">{invoice.referenceNumber}</dd>
                </div>
              )}
            </dl>
            {(primary || unpaid) && (
              <div className="ed-issue">
                {primary && (
                  <button type="button" className="btn btn-primary ed-issue-btn" onClick={() => setDialog(primary)} disabled={busyAny}>
                    {primary === 'reminder' ? <BellRingingIcon /> : <EnvelopeSimpleIcon />}
                    {primary === 'reminder' ? t('editor.sendReminder') : t('actions.email')}
                  </button>
                )}
                {unpaid && (
                  <button type="button" className={`btn ed-issue-btn${primary ? '' : ' btn-primary'}`} onClick={() => setDialog('paid')} disabled={busyAny}>
                    <CheckIcon />
                    {t('actions.markPaid')}
                  </button>
                )}
              </div>
            )}
            {quote && <QuoteActions invoice={invoice} primary={!primary && !justIssued} />}
            <RecurringControl invoice={invoice} className="ed-recurring" />
            {xmlIssues.length > 0 && (
              <section className="ed-einvoice" aria-labelledby="einvoice-title">
                <h2 id="einvoice-title">{t('einvoice.title')}</h2>
                <ul className="xml-issues">
                  {xmlIssues.map((i) => (
                    <li key={i.field + i.message.et}>{pick(i.message, lang)}</li>
                  ))}
                </ul>
                <details className="disclosure disclosure-plain">
                  <summary>
                    <CaretRightIcon className="caret" />
                    <span className="disclosure-title">{t('editor.einvoiceMore')}</span>
                  </summary>
                  <p className="disclosure-body small">{t('einvoice.explain')}</p>
                </details>
              </section>
            )}
          </aside>
        )}
        <PreviewPanel invoice={effective} open={previewOpen} sheet={sheet} onClose={() => setPreviewOpen(false)} actions={pdfButton} returnFocus={previewOpener} />
        </div>
      </div>

      {dialog === 'issue' && quote && <QuoteIssueDialog predictedNumber={predicted} keepsNumber={reopened} warnings={warnings.length} stale={staleQuote} onClose={() => setDialog(null)} onConfirm={issue} />}
      {dialog === 'issue' && !quote && <IssueDialog credit={credit} predictedNumber={predicted} keepsNumber={reopened} warnings={warnings.length} stale={stale} onClose={() => setDialog(null)} onConfirm={issue} />}
      {dialog === 'delete' && (
        <DeleteInvoiceDialog
          invoice={invoice}
          onClose={() => setDialog(null)}
          onDeleted={() => navigate('/')}
          onCreditNote={credit || quote || invoice.status === 'cancelled' || !ro ? undefined : () => void creditNote()}
          beforeDelete={ro ? undefined : () => autosave.discard()}
        />
      )}
      {dialog === 'paid' && <MarkPaidDialog invoice={invoice} onClose={() => setDialog(null)} onConfirm={(paidAt) => changeStatus((id) => app.markInvoicePaid(id, paidAt)).then(() => toast.success(t('actions.markedPaid', { number: invoice.number })))} />}
      {(dialog === 'email' || dialog === 'reminder') && <EmailDialog invoice={effective} kind={dialog === 'reminder' ? 'reminder' : 'invoice'} onSent={() => markSent(invoice.id)} onClose={() => setDialog(null)} />}
    </div>
  )
}
