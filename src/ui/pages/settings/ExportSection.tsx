import { FileArchiveIcon, FileCsvIcon } from '@phosphor-icons/react'
import { useMemo, useRef, useState } from 'react'
import { computeTotals, isValidISODate } from '../../../domain'
import { accountantCsv, accountantZip, exportBaseName, periodRange, selectForExport, type DateRange, type ExportPeriod, type ExportProgress } from '../../../export'
import { downloadBlob } from '../../../integrations'
import { useApp } from '../../AppContext'
import { CheckboxField, SelectField, TextField } from '../../components/fields'
import { Section } from '../../components/misc'
import { formatDate, formatMoney } from '../../format'
import { useToast } from '../../Toasts'
import { errorMessage, localTodayISO, sumByCurrency } from '../../util'

const PERIODS: ExportPeriod[] = ['this-month', 'last-month', 'this-quarter', 'last-quarter', 'this-year', 'last-year']
type PeriodChoice = ExportPeriod | 'custom'

/** Settings section: period export (CSV, or a ZIP with the CSV, PDFs and e-invoice XML) for the accountant. */
export default function ExportSection() {
  const { t, lang, invoices } = useApp()
  const toast = useToast()
  const today = localTodayISO()
  const [period, setPeriod] = useState<PeriodChoice>('last-month')
  const [custom, setCustom] = useState<DateRange>(() => periodRange('this-month', today))
  const [withInvoices, setWithInvoices] = useState(true)
  const [withCredits, setWithCredits] = useState(true)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const abort = useRef<AbortController | null>(null)

  const range = period === 'custom' ? custom : periodRange(period, today)
  const { from, to } = range
  const rangeValid = isValidISODate(from) && isValidISODate(to) && from <= to
  const docs = useMemo(
    () => (rangeValid ? selectForExport(invoices, { from, to, invoices: withInvoices, creditNotes: withCredits }) : []),
    [invoices, rangeValid, from, to, withInvoices, withCredits],
  )
  const totals = useMemo(() => [...sumByCurrency(docs.map((d) => ({ amount: computeTotals(d).gross, currency: d.currency || 'EUR' })))], [docs])
  const busy = progress !== null

  const downloadCsv = () => {
    const name = `${exportBaseName(range, lang)}.csv`
    downloadBlob(new Blob([accountantCsv(docs, lang)], { type: 'text/csv;charset=utf-8' }), name)
    toast.success(t('export.done', { name }))
  }

  const downloadZip = async () => {
    const ctrl = new AbortController()
    abort.current = ctrl
    setProgress({ done: 0, total: docs.length })
    try {
      const res = await accountantZip(docs, { range, lang, signal: ctrl.signal, onProgress: setProgress })
      downloadBlob(res.blob, res.fileName)
      if (res.failed.length) toast.warning(t('export.failed', { numbers: res.failed.join(', ') }))
      else toast.success(t('export.done', { name: res.fileName }))
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') toast.info(t('export.cancelled'))
      else toast.error(errorMessage(e))
    } finally {
      abort.current = null
      setProgress(null)
    }
  }

  const options = [...PERIODS, 'custom' as const].map((p) => ({ value: p, label: t(`export.period.${p}`) }))

  return (
    <Section id="set-export" title={t('export.title')} description={t('export.intro')}>
      <div className="grid export-grid">
        <SelectField<PeriodChoice> label={t('export.period')} value={period} onChange={setPeriod} options={options} disabled={busy} />
        {period === 'custom' ? (
          <>
            <TextField type="date" label={t('export.from')} value={custom.from} onChange={(from) => setCustom((c) => ({ ...c, from }))} disabled={busy} max={custom.to || undefined} />
            <TextField
              type="date"
              label={t('export.to')}
              value={custom.to}
              onChange={(to) => setCustom((c) => ({ ...c, to }))}
              disabled={busy}
              min={custom.from || undefined}
              error={!rangeValid ? t('export.rangeInvalid') : undefined}
            />
          </>
        ) : (
          <p className="export-range">
            {formatDate(range.from)}–{formatDate(range.to)}
          </p>
        )}
      </div>
      <fieldset className="export-docs">
        <legend className="label">{t('export.documents')}</legend>
        <CheckboxField label={t('export.invoices')} checked={withInvoices} onChange={setWithInvoices} disabled={busy} />
        <CheckboxField label={t('export.creditNotes')} checked={withCredits} onChange={setWithCredits} disabled={busy} />
      </fieldset>

      <div className="setting-row export-row">
        <div>
          {docs.length > 0 ? (
            <>
              <strong>{t('export.summary', { count: docs.length })}</strong>
              <p className="setting-desc">{t('export.total', { amounts: totals.map(([cur, sum]) => formatMoney(sum, cur)).join(', ') })}</p>
            </>
          ) : (
            <p className="setting-desc">{rangeValid ? t('export.none') : t('export.rangeInvalid')}</p>
          )}
          <p className="setting-desc">{t('export.csvHint')}</p>
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={downloadCsv} disabled={busy || docs.length === 0}>
            <FileCsvIcon />
            {t('export.csv')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void downloadZip()} disabled={busy || docs.length === 0}>
            <FileArchiveIcon />
            {t('export.zip')}
          </button>
        </div>
      </div>

      {progress && (
        <div className="export-progress" role="status">
          <progress value={progress.done} max={Math.max(1, progress.total)} aria-label={t('export.progress', { done: progress.done, total: progress.total })} />
          <span className="small">{t('export.progress', { done: progress.done, total: progress.total })}</span>
          <button type="button" className="btn btn-sm" onClick={() => abort.current?.abort()}>
            {t('export.cancel')}
          </button>
        </div>
      )}
    </Section>
  )
}
