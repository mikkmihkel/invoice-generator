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
} from '../../domain'
import { buildUblXml, eInvoiceIssues } from '../../einvoice'
import { downloadBlob, googleSignIn, uploadToDrive } from '../../integrations'
import { invoiceFileName, preloadPdfMake, renderInvoicePdf, renderInvoicePdfBase64 } from '../../pdf'
import { useApp } from '../AppContext'
import { AccentPicker, TemplatePicker } from '../components/Appearance'
import { useConfirm } from '../components/Dialog'
import { pick } from '../i18n'
import { FieldShell, fieldId, NumberField, SelectField, TextAreaField, TextField } from '../components/fields'
import { Section, StatusChip } from '../components/misc'
import { formatDate, formatDateTime, formatIban } from '../format'
import { CURRENCIES, languageOptions, vatSchemeOptions } from '../options'
import { useToast } from '../Toasts'
import { addDaysISO, daysBetween, displayStatus, effectiveInvoice, errorMessage, isUnpaid, localTodayISO, normalizeInvoice, nowISO, buyerFromClient } from '../util'
import { BuyerSection } from './editor/BuyerSection'
import { creditNoteFor, duplicateInvoice, newDraft, redateInvoice } from './editor/builders'
import { EmailDialog } from './editor/EmailDialog'
import { LinesEditor } from './editor/LinesEditor'
import { PdfPreview } from './editor/PdfPreview'
import { IssueDialog, MarkPaidDialog, type StaleIssueDate } from './editor/StatusDialogs'
import { useAutosave } from './editor/useAutosave'
import { ValidationPanel } from './editor/ValidationPanel'
import { numberingPreview } from './ProfileForm'

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
        <div className="empty card">
          <h1>{t('editor.notFound')}</h1>
          <Link to="/" className="btn">
            ← {t('nav.invoices')}
          </Link>
        </div>
      </div>
    )
  }
  if (!invoice || !effective || !profile || !totals) return <div className="page muted">{t('common.loading')}</div>

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

  const title = invoice.number
    ? t(invoice.type === 'credit-note' ? 'editor.titleCredit' : 'editor.title', { number: invoice.number })
    : t(invoice.type === 'credit-note' ? 'editor.newCredit' : 'editor.new')

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
      if (window.location.hash.includes('/invoices/new')) navigate(`/invoices/${issued.id}`, { replace: true, state: { editorKey } })
      toast.success(t('issue.done', { number: issued.number }))
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

  const busyAny = busy !== null

  return (
    <div className="page page-wide editor">
      <div className="editor-head">
        <div className="editor-title">
          <Link to="/" className="back-link">
            ← {t('nav.invoices')}
          </Link>
          <h1>
            {title} <StatusChip status={status} />
          </h1>
          <p className={`small save-state${!ro && autosave.state === 'error' ? ' save-error' : ' muted'}`} aria-live="polite">
            {ro
              ? [invoice.issuedAt && t('editor.issuedAt', { date: formatDateTime(invoice.issuedAt) }), invoice.paidAt && t('editor.paidAt', { date: formatDate(invoice.paidAt) })].filter(Boolean).join(' · ')
              : autosave.state === 'saving' || autosave.state === 'pending'
                ? t('editor.saving')
                : autosave.state === 'saved'
                  ? t('editor.saved')
                  : autosave.state === 'error'
                    ? t('editor.saveError')
                    : t('editor.autosaveHint')}
            {!ro && autosave.state === 'error' && (
              <>
                {' '}
                <button type="button" className="link-btn" onClick={() => void autosave.flush()}>
                  {t('editor.retrySave')}
                </button>
              </>
            )}
          </p>
        </div>
        <div className="editor-actions" role="toolbar" aria-label={t('editor.actions')}>
          {!ro && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setDialog('issue')}
                disabled={errors.length > 0 || busyAny}
                title={errors.length ? t('issue.blocked') : undefined}
                aria-describedby={errors.length ? 'issue-summary' : undefined}
              >
                {t('actions.issue')}
              </button>
              <button type="button" className="btn" onClick={() => void downloadPdf()} disabled={busyAny}>
                {t('actions.previewPdf')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void deleteDraft()} disabled={busyAny}>
                {t('actions.deleteDraft')}
              </button>
              {errors.length > 0 && (
                <button
                  type="button"
                  id="issue-summary"
                  className="link-btn issue-summary"
                  onClick={() => {
                    const panel = document.getElementById('validation-panel')
                    panel?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
                    panel?.focus({ preventScroll: true })
                  }}
                >
                  {t('issue.errorsSummary', { count: errors.length })}
                </button>
              )}
            </>
          )}
          {ro && (
            <>
              {invoice.status !== 'cancelled' && (
                <button type="button" className="btn btn-primary" onClick={() => setDialog('email')} disabled={busyAny}>
                  {t('actions.email')}
                </button>
              )}
              <button type="button" className="btn" onClick={() => void downloadPdf()} disabled={busyAny}>
                {busy === 'pdf' ? t('common.working') : t('actions.downloadPdf')}
              </button>
              <button type="button" className="btn" onClick={() => void print()} disabled={busyAny}>
                {t('actions.print')}
              </button>
              <button type="button" className="btn" onClick={() => void saveToDrive()} disabled={busyAny}>
                {busy === 'drive' ? t('common.working') : t('actions.drive')}
              </button>
            </>
          )}
        </div>
      </div>

      {ro && (
        <div className={`notice ${invoice.status === 'cancelled' ? 'notice-warn' : 'notice-info'} locked-banner`}>
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
          <div className="btn-row">
            {isUnpaid(invoice) && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog('paid')} disabled={busyAny}>
                {t('actions.markPaid')}
              </button>
            )}
            {invoice.status === 'paid' && (
              <button type="button" className="btn btn-sm" onClick={() => void act('unpaid', () => changeStatus(app.markInvoiceUnpaid))} disabled={busyAny}>
                {t('actions.markUnpaid')}
              </button>
            )}
            {invoice.type !== 'credit-note' && invoice.status !== 'cancelled' && (
              <button type="button" className="btn btn-sm" onClick={() => void creditNote()} disabled={busyAny}>
                {t('actions.creditNote')}
              </button>
            )}
            {invoice.status === 'issued' && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cancelInvoice()} disabled={busyAny}>
                {t('actions.cancelInvoice')}
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void duplicate()} disabled={busyAny}>
              {t('actions.duplicate')}
            </button>
          </div>
        </div>
      )}

      <div className="editor-grid">
        <fieldset className="editor-form plain-fieldset" disabled={ro}>
          <legend className="visually-hidden">{title}</legend>

          <Section id="sec-buyer" title={t('editor.buyer')}>
            <BuyerSection buyer={invoice.buyer} onChange={(buyer: BuyerSnapshot) => set({ buyer })} onPickClient={onPickClient} disabled={ro} forceEdit={buyerFieldIssue} />
          </Section>

          <Section id="sec-dates" title={t('editor.datesTerms')}>
            <div className="grid">
              <TextField
                label={t('field.issueDate')}
                type="date"
                path="issueDate"
                value={invoice.issueDate}
                onChange={(v) => v && set({ issueDate: v, dueDate: addDaysISO(v, Math.max(0, term)) })}
                required
              />
              <NumberField
                label={t('field.paymentTerm')}
                path="paymentTerm"
                value={term}
                onChange={(v) => set({ dueDate: addDaysISO(invoice.issueDate, Math.max(0, Math.round(v ?? 0))) })}
                suffix={t('common.days')}
              />
              <TextField label={t('field.dueDate')} type="date" path="dueDate" value={invoice.dueDate} onChange={(v) => v && set({ dueDate: v })} min={invoice.issueDate} required />
              <TextField label={t('field.supplyDate')} type="date" path="supplyDate" value={invoice.supplyDate} onChange={(v) => set({ supplyDate: v || undefined })} hint={t('field.supplyDateHint')} />
              <TextField label={t('field.periodStart')} type="date" path="periodStart" value={invoice.periodStart} onChange={(v) => set({ periodStart: v || undefined })} />
              <TextField label={t('field.periodEnd')} type="date" path="periodEnd" value={invoice.periodEnd} onChange={(v) => set({ periodEnd: v || undefined })} min={invoice.periodStart} />
            </div>
          </Section>

          <Section id="sec-vat" title={t('editor.vat')}>
            <div className="grid">
              <SelectField className="span-2" label={t('field.vatScheme')} path="vatScheme" value={invoice.vatScheme} onChange={(vatScheme) => edit((inv) => withVatScheme(inv, vatScheme, profile.defaults.defaultVatRate))} options={vatSchemeOptions(t)} />
              <SelectField<InvoiceType>
                label={t('field.invoiceType')}
                path="type"
                value={invoice.type}
                onChange={(type) => set({ type })}
                options={(['invoice', 'prepayment', 'credit-note'] as const).map((v) => ({ value: v, label: t(`invoice.type.${v}`) }))}
              />
            </div>
            <p className="explain">{t(`vat.explain.${invoice.vatScheme}`)}</p>
            {!profile.vatRegistered && invoice.vatScheme !== 'not-registered' && !ro && <p className="notice notice-warn">{t('editor.notVatRegistered')}</p>}
            {showNoteField && (
              <TextField label={noteField.label} path="vatExemptionNote" value={invoice.vatExemptionNote} onChange={(v) => set({ vatExemptionNote: v || undefined })} hint={noteField.hint} />
            )}
            {note && (
              <p className="printed-note">
                <span className="muted small">{t('editor.printedNote')}</span> {note}
              </p>
            )}
            {invoice.type === 'credit-note' && (
              <TextField label={t('field.creditedInvoiceNumber')} path="creditedInvoiceNumber" value={invoice.creditedInvoiceNumber} onChange={(v) => set({ creditedInvoiceNumber: v || undefined })} required />
            )}
          </Section>

          <Section id="sec-lines" title={t('editor.lines')} description={invoice.type === 'credit-note' ? t('editor.creditLinesHint') : undefined}>
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
          </Section>

          <Section id="sec-payment" title={t('editor.payment')}>
            <div className="grid">
              <FieldShell
                id={fieldId('referenceNumber')}
                label={t('field.referenceNumber')}
                hint={invoice.referenceNumber ? undefined : t('field.referenceNumberHint')}
                error={invoice.referenceNumber && !isValidReferenceNumber(invoice.referenceNumber) ? t('field.referenceNumberInvalid') : undefined}
              >
                <div>
                  <input
                    id={fieldId('referenceNumber')}
                    type="text"
                    inputMode="numeric"
                    value={invoice.referenceNumber ?? ''}
                    onChange={(e) => set({ referenceNumber: e.target.value.replace(/\s+/g, '') || undefined })}
                  />
                </div>
              </FieldShell>
              <TextField label={t('field.orderReference')} path="orderReference" value={invoice.orderReference} onChange={(v) => set({ orderReference: v || undefined })} />
              <NumberField
                label={t('field.lateInterest')}
                path="lateInterestPercentPerDay"
                value={invoice.lateInterestPercentPerDay}
                onChange={(v) => set({ lateInterestPercentPerDay: v ?? undefined })}
                allowEmpty
                suffix={t('common.percentPerDay')}
              />
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
                      {formatIban(a.iban)}
                      {a.bankName ? ` · ${a.bankName}` : ''}
                    </label>
                  )
                })}
              </fieldset>
            )}
            <TextAreaField label={t('field.notes')} path="notes" value={invoice.notes} onChange={(v) => set({ notes: v || undefined })} hint={t('field.notesHint')} />
          </Section>

          <Section id="sec-appearance" title={t('editor.appearance')}>
            <SelectField label={t('field.invoiceLanguage')} path="language" value={invoice.language} onChange={(language) => set({ language })} options={languageOptions(t)} />
            <TemplatePicker value={invoice.templateId} onChange={(templateId) => set({ templateId })} accent={invoice.accentColor} disabled={ro} />
            <AccentPicker value={invoice.accentColor} onChange={(accentColor) => set({ accentColor })} disabled={ro} />
          </Section>

        </fieldset>

        <aside className="editor-side">
          {!ro && <ValidationPanel issues={issues} />}
          {ro && (
            <Section id="sec-export" title={t('editor.export')}>
              <div className="export-row">
                <div>
                  <strong>{t('einvoice.title')}</strong>
                  <p className="muted small">{t('einvoice.explain')}</p>
                  {xmlIssues.length > 0 && (
                    <ul className="notice notice-warn small xml-issues">
                      {xmlIssues.map((i) => (
                        <li key={i.field + i.message.et}>{pick(i.message, lang)}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button type="button" className="btn" onClick={() => void downloadXml()} disabled={busyAny}>
                  {t('actions.downloadXml')}
                </button>
              </div>
            </Section>
          )}
          {!ro && (
            <p className="muted small issue-hint">
              {errors.length ? t('issue.blocked') : warnings.length ? t('issue.readyWithWarnings') : t('issue.ready', { number: predicted })}
            </p>
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
