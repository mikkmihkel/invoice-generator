import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowUUpLeftIcon,
  BellRingingIcon,
  CaretRightIcon,
  CheckIcon,
  CloudArrowUpIcon,
  CopyIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  FileCodeIcon,
  LockSimpleIcon,
  PrinterIcon,
  ProhibitIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  type InvoiceType,
  type ValidationIssue,
} from '../../domain'
import { buildUblXml, eInvoiceIssues } from '../../einvoice'
import { downloadBlob, googleSignIn, uploadToDrive } from '../../integrations'
import { invoiceFileName, preloadPdfMake, renderInvoicePdf, renderInvoicePdfBase64 } from '../../pdf'
import { useApp } from '../AppContext'
import { BrandColors, TemplatePicker } from '../components/Appearance'
import { useConfirm } from '../components/Dialog'
import { pick } from '../i18n'
import { CheckboxField, DecimalInput, FieldShell, fieldId, NumberField, SelectField, TextAreaField, TextField } from '../components/fields'
import { IconButton, Menu, Skeleton, type MenuItem } from '../components/ui'
import { formatDate, formatIban } from '../format'
import { CURRENCIES, languageOptions, templateName, vatSchemeOptions } from '../options'
import { useToast } from '../Toasts'
import { accentColor, addDaysISO, daysBetween, displayStatus, effectiveInvoice, errorMessage, isCreditSettled, isUnpaid, localTodayISO, normalizeInvoice, nowISO, buyerFromClient } from '../util'
import { BuyerSection } from './editor/BuyerSection'
import { creditNoteFor, duplicateInvoice, newDraft, redateInvoice } from './editor/builders'
import { DueAmount, EdSection, MoreOptions, NextStep, SaveIndicator, StatusWord } from './editor/EditorParts'
import { EmailDialog } from './editor/EmailDialog'
import { markSent } from './invoice-detail/sent'
import { LinesEditor } from './editor/LinesEditor'
import { PreviewPanel } from './editor/PdfPreview'
import { useMediaQuery } from './editor/useMediaQuery'
import { IssueDialog, MarkPaidDialog, type StaleIssueDate } from './editor/StatusDialogs'
import { TextRows } from './editor/TextRows'
import { useAutosave } from './editor/useAutosave'
import { ValidationPanel } from './editor/ValidationPanel'
import { numberingPreview } from './ProfileForm'

const TERM_PRESETS = [7, 14, 30]

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
  const [dialog, setDialog] = useState<null | 'issue' | 'paid' | 'email' | 'reminder'>(null)
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

  const persistedRef = useRef(false)
  const previewBtn = useRef<HTMLButtonElement>(null)
  const previewOpener = useRef<HTMLElement | null>(null)
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

  const loaded = !!invoice
  useEffect(() => {
    if (loaded && focusTitle) titleRef.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

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
  const status = displayStatus(invoice, undefined, app.invoices)
  const unpaid = isUnpaid(invoice, app.invoices)
  const credit = invoice.type === 'credit-note'
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const checklist = !ro && invoice.buyer.name && !invoice.buyer.email ? [...issues, EMAIL_SUGGESTION] : issues
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
  const meta = [invoice.buyer.name || t('list.noClient'), invoice.dueDate ? t('editor.dueMeta', { date: formatDate(invoice.dueDate) }) : ''].filter(Boolean).join(' · ')

  // What "Lisavalikud" holds right now, so a closed section still tells what is in use.
  const inUse = [
    invoice.type !== 'invoice' ? t(`invoice.type.${invoice.type}`) : '',
    invoice.supplyDate ? t('field.supplyDate') : '',
    invoice.periodStart || invoice.periodEnd ? t('editor.period') : '',
    invoice.orderReference ? t('field.orderReference') : '',
    invoice.lateInterestPercentPerDay ? t('field.lateInterest') : '',
    invoice.currency.toUpperCase() !== 'EUR' ? invoice.currency : '',
    accounts.length > 1 && invoice.bankAccountIds.length > 0 ? t('editor.bankAccounts') : '',
    invoice.notes ? t('field.notes') : '',
  ].filter(Boolean)
  const moreSummary = inUse.length ? t('editor.moreInUse', { list: inUse.join(', ') }) : t('editor.moreHintCalm')

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
  // One obvious action for an issued invoice; everything else lives in "Rohkem".
  const primary: null | 'email' | 'reminder' =
    !ro || justIssued || invoice.status === 'cancelled' || invoice.status === 'paid' || isCreditSettled(invoice, app.invoices) ? null : status === 'overdue' ? 'reminder' : 'email'
  const menuItems: MenuItem[] = [
    ...(invoice.status === 'paid' ? [{ key: 'email', label: t('actions.email'), icon: <EnvelopeSimpleIcon />, onSelect: () => setDialog('email') }] : []),
    ...(primary === 'reminder' ? [{ key: 'email', label: t('actions.email'), icon: <EnvelopeSimpleIcon />, onSelect: () => setDialog('email') }] : []),
    { key: 'drive', label: t('actions.drive'), icon: <CloudArrowUpIcon />, onSelect: () => void saveToDrive() },
    { key: 'xml', label: t('actions.downloadXml'), icon: <FileCodeIcon />, onSelect: () => void downloadXml() },
    { key: 'print', label: t('actions.print'), icon: <PrinterIcon />, onSelect: () => void print() },
    { key: 'duplicate', label: t('actions.duplicate'), icon: <CopyIcon />, separatorBefore: true, onSelect: () => void duplicate() },
    ...(invoice.type !== 'credit-note' && invoice.status !== 'cancelled' ? [{ key: 'credit', label: t('actions.creditNote'), icon: <ArrowUUpLeftIcon />, onSelect: () => void creditNote() }] : []),
    ...(invoice.status === 'paid' ? [{ key: 'unpaid', label: t('actions.markUnpaid'), icon: <ArrowCounterClockwiseIcon />, onSelect: () => void act('unpaid', () => changeStatus(app.markInvoiceUnpaid)) }] : []),
    ...(invoice.status === 'issued' ? [{ key: 'cancel', label: t('actions.cancelInvoice'), icon: <ProhibitIcon />, danger: true, separatorBefore: true, onSelect: () => void cancelInvoice() }] : []),
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
                  {ro && <StatusWord status={status} />}
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
                {!ro && <IconButton label={t('actions.deleteDraft')} icon={<TrashIcon size={18} />} className="icon-btn-danger" onClick={() => void deleteDraft()} disabled={busyAny} />}
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
            <div className={`ed-locked${invoice.status === 'cancelled' ? ' ed-locked-warn' : ''}`}>
              <LockSimpleIcon size={16} className="ed-locked-icon" />
              <div>
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
            </div>
          )}

          <fieldset className="ed-form" disabled={ro}>
            <legend className="visually-hidden">{title}</legend>

            <EdSection id="sec-buyer" title={t('editor.buyer')}>
              <BuyerSection buyer={invoice.buyer} onChange={(buyer: BuyerSnapshot) => set({ buyer })} onPickClient={onPickClient} disabled={ro} forceEdit={buyerFieldIssue} />
            </EdSection>

            <EdSection
              id="sec-lines"
              title={t('editor.sectionLines')}
              aside={totals.showVat ? t('editor.pricesExclVat') : undefined}
              hint={invoice.type === 'credit-note' ? t('editor.creditLinesHint') : undefined}
            >
              <TextRows kind="before" rows={invoice.textBefore} onChange={(textBefore) => set({ textBefore })} disabled={ro} />
              <LinesEditor
                lines={invoice.lines}
                onChange={(lines) => set({ lines })}
                vatScheme={invoice.vatScheme}
                currency={invoice.currency}
                totals={totals}
                defaultUnit={profile.defaults.defaultUnit}
                defaultVatRate={profile.defaults.defaultVatRate}
                disabled={ro}
                grossLabel={credit ? t('totals.credited') : undefined}
              />
              <TextRows kind="after" rows={invoice.textAfter} onChange={(textAfter) => set({ textAfter })} disabled={ro} />
            </EdSection>

            <EdSection id="sec-terms" title={t('editor.sectionPayment')}>
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
                    <dt>{t('field.invoiceLanguage')}</dt>
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
                  {invoice.paymentQr && (
                    <div>
                      <dt>{t('editor.paymentQrShort')}</dt>
                      <dd>{t('editor.paymentQrOn')}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <>
                <div className="grid">
                  <SelectField label={t('field.invoiceLanguage')} path="language" value={invoice.language} onChange={(language) => set({ language })} options={languageOptions(t)} />
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
                <CheckboxField label={t('field.paymentQr')} hint={t('field.paymentQrHint')} checked={!!invoice.paymentQr} onChange={(paymentQr) => set({ paymentQr })} disabled={ro} />
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
                {shown(invoice.orderReference) && <TextField label={t('field.orderReference')} path="orderReference" value={invoice.orderReference} onChange={(v) => set({ orderReference: v || undefined })} />}
                {shown(invoice.lateInterestPercentPerDay) && (
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
          <aside id="ed-side" className="ed-side" aria-label={t('editor.sideLabel')} tabIndex={-1}>
            <DueAmount totals={totals} currency={invoice.currency} label={credit ? t('totals.credited') : undefined} />
            <ValidationPanel issues={checklist} summaryId="issue-summary" />
            {sheet && (
              <IconButton className="ed-bar-preview" label={t('preview.title')} icon={<EyeIcon size={20} />} aria-expanded={previewOpen} onClick={(e) => togglePreview(e.currentTarget)} />
            )}
            <div className="ed-issue">
              <button
                type="button"
                className="btn btn-primary ed-issue-btn"
                onClick={() => setDialog('issue')}
                disabled={errors.length > 0 || busyAny}
                title={errors.length ? t('issue.blocked') : undefined}
                aria-describedby={errors.length ? 'issue-summary' : 'issue-note'}
              >
                {t(credit ? 'actions.issueCredit' : 'actions.issue')}
              </button>
              <p id="issue-note" className="ed-issue-note">
                {t(credit ? 'editor.willGetNumberCredit' : 'editor.willGetNumber', { number: predicted })}
              </p>
            </div>
          </aside>
        ) : (
          <aside className="ed-side ed-side-ro" aria-label={t('editor.sideLabel')}>
            <DueAmount totals={totals} currency={invoice.currency} label={credit ? t('totals.credited') : undefined} />
            <dl className="ed-facts">
              {invoice.issuedAt && (
                <div>
                  <dt>{t('status.issued')}</dt>
                  <dd>{formatDate(invoice.issuedAt.slice(0, 10))}</dd>
                </div>
              )}
              <div>
                <dt>{t('field.dueDate')}</dt>
                <dd className={status === 'overdue' ? 'ed-overdue' : undefined}>{formatDate(invoice.dueDate)}</dd>
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

      {dialog === 'issue' && <IssueDialog credit={credit} predictedNumber={predicted} warnings={warnings.length} stale={stale} onClose={() => setDialog(null)} onConfirm={issue} />}
      {dialog === 'paid' && <MarkPaidDialog invoice={invoice} onClose={() => setDialog(null)} onConfirm={(paidAt) => changeStatus((id) => app.markInvoicePaid(id, paidAt)).then(() => toast.success(t('actions.markedPaid', { number: invoice.number })))} />}
      {(dialog === 'email' || dialog === 'reminder') && <EmailDialog invoice={effective} kind={dialog === 'reminder' ? 'reminder' : 'invoice'} onSent={() => markSent(invoice.id)} onClose={() => setDialog(null)} />}
    </div>
  )
}
