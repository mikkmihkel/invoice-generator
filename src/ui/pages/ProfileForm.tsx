import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { useId, useMemo } from 'react'
import {
  DEFAULT_EMAIL_BODY_EN,
  DEFAULT_EMAIL_SUBJECT_EN,
  DEFAULT_QUOTE_NUMBERING,
  formatInvoiceNumber,
  NUMBERING_PRESETS,
  predictNumber,
  QUOTE_NUMBERING_PRESETS,
  sameSeries,
  textRows,
  type CompanyProfile,
  type ISODate,
  type InvoiceDefaults,
  type NumberingSettings,
} from '../../domain'
import { useApp } from '../AppContext'
import { InvoiceDesign } from '../components/Appearance'
import { CheckboxField, fieldId, NumberField, SelectField, TextAreaField, TextField } from '../components/fields'
import { BankAccountsEditor, LogoInput, Section } from '../components/misc'
import { IconButton } from '../components/ui'
import { PartyFields, registryCodeError, vatNumberError } from '../components/PartyFields'
import { CURRENCIES, languageOptions, vatRates, vatSchemeOptions, UNIT_SUGGESTIONS } from '../options'
import { localTodayISO } from '../util'
import { NumberingEditor } from './NumberingEditor'

/**
 * Number the next document issued on `date` would get (before skipping numbers already in use).
 * A plain year is still accepted and uses the running nextNumber (no period counters).
 */
export function numberingPreview(n: NumberingSettings, date: ISODate | number = localTodayISO()): string {
  return typeof date === 'number' ? formatInvoiceNumber(n, n.nextNumber, date) : predictNumber(n, date)
}

/**
 * `design` = "Arve kujundus": logo, default template, colours and a live preview (`logo` = the logo alone).
 * `quoteNumbering` = the separate number series of quotes.
 */
export type ProfileSection = 'company' | 'vat' | 'bank' | 'logo' | 'design' | 'defaults' | 'numbering' | 'quoteNumbering' | 'email'

type ProblemKey = 'profile.needName' | 'profile.needIban' | 'profile.registryCodeInvalid' | 'profile.vatNumberInvalid' | 'profile.vatNumberRequired'

/**
 * Problems that must be fixed before the profile can be saved (they would make every invoice invalid).
 * A missing registry code is only warned about in the form (see `profile.registryCodeMissing`).
 */
export function profileProblems(p: CompanyProfile, t: (k: ProblemKey) => string): string[] {
  const out: string[] = []
  if (!p.name.trim()) out.push(t('profile.needName'))
  if (registryCodeError(p.registryCode, p.address?.country, 'x')) out.push(t('profile.registryCodeInvalid'))
  if (p.vatNumber && vatNumberError(p.vatNumber, 'x')) out.push(t('profile.vatNumberInvalid'))
  else if (p.vatRegistered && !p.vatNumber?.trim()) out.push(t('profile.vatNumberRequired'))
  if (!p.bankAccounts.some((a) => a.iban.trim())) out.push(t('profile.needIban'))
  return out
}

/** The profile as saved: bank accounts without an IBAN and blank default text rows dropped. */
export function profileForSave(p: CompanyProfile): CompanyProfile {
  const defaults = { ...p.defaults }
  for (const key of ['textBefore', 'textAfter'] as const) {
    const rows = textRows(defaults[key])
    if (rows.length) defaults[key] = rows
    else delete defaults[key]
  }
  return { ...p, bankAccounts: p.bankAccounts.filter((a) => a.iban.trim()), defaults }
}

const focusLater = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus())

/** Default free-text rows for new invoices (before the lines / after the totals): add, edit, reorder, remove. */
function DefaultTextRows({ kind, rows, onChange }: { kind: 'before' | 'after'; rows: string[] | undefined; onChange: (rows: string[] | undefined) => void }) {
  const { t } = useApp()
  const labelId = useId()
  const label = t(kind === 'before' ? 'editor.textBefore' : 'editor.textAfter')
  const path = kind === 'before' ? 'defaults.textBefore' : 'defaults.textAfter'
  const list = rows ?? []
  const commit = (next: string[]) => onChange(next.length ? next : undefined)
  const move = (i: number, dir: -1 | 1) => {
    const next = [...list]
    ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
    commit(next)
    focusLater(fieldId(`${path}.${i + dir}`))
  }
  return (
    <div className="text-rows-field" role="group" aria-labelledby={labelId}>
      <span className="label" id={labelId}>
        {label}
      </span>
      {list.length > 0 && (
        <ol className="text-rows-edit">
          {list.map((row, i) => (
            <li key={i}>
              <textarea
                id={fieldId(`${path}.${i}`)}
                rows={1}
                value={row}
                aria-label={t('editor.textRowN', { label, n: i + 1 })}
                placeholder={t(kind === 'before' ? 'editor.textBeforeHint' : 'editor.textAfterHint')}
                onChange={(e) => commit(list.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <span className="text-rows-tools">
                {list.length > 1 && (
                  <>
                    <IconButton className="icon-btn-sm" label={t('editor.textRowUp', { label, n: i + 1 })} icon={<ArrowUpIcon size={14} />} disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton className="icon-btn-sm" label={t('editor.textRowDown', { label, n: i + 1 })} icon={<ArrowDownIcon size={14} />} disabled={i === list.length - 1} onClick={() => move(i, 1)} />
                  </>
                )}
                <IconButton className="icon-btn-sm icon-btn-danger" label={t('editor.textRowRemove', { label, n: i + 1 })} icon={<XIcon size={14} />} onClick={() => commit(list.filter((_, j) => j !== i))} />
              </span>
            </li>
          ))}
        </ol>
      )}
      <div>
        <button
          type="button"
          className="btn btn-sm btn-ghost text-rows-add"
          onClick={() => {
            commit([...list, ''])
            focusLater(fieldId(`${path}.${list.length}`))
          }}
        >
          <PlusIcon />
          {t(kind === 'before' ? 'editor.addTextBefore' : 'editor.addTextAfter')}
        </button>
      </div>
    </div>
  )
}

export function ProfileForm({
  value,
  onChange,
  sections,
  compactDesign,
}: {
  value: CompanyProfile
  onChange: (p: CompanyProfile) => void
  sections: ProfileSection[]
  /** Onboarding: the design section without logo, with compact template cards. */
  compactDesign?: boolean
}) {
  const { t, invoices } = useApp()
  const has = (s: ProfileSection) => sections.includes(s)
  const today = localTodayISO()
  const numbered = useMemo(() => invoices.filter((i) => i.status !== 'draft' && i.number), [invoices])
  const usedNumbers = useMemo(() => new Set(numbered.map((i) => i.number)), [numbered])
  const invoiceDocs = useMemo(() => numbered.filter(sameSeries('invoice')), [numbered])
  const quoteDocs = useMemo(() => numbered.filter(sameSeries('quote')), [numbered])
  const set = (patch: Partial<CompanyProfile>) => onChange({ ...value, ...patch })
  const setDefaults = (patch: Partial<InvoiceDefaults>) => set({ defaults: { ...value.defaults, ...patch } })
  const d = value.defaults

  return (
    <div className="stack">
      {has('company') && (
        <Section id="sec-company" title={t('profile.company')} description={t('profile.companyHint')}>
          <PartyFields value={value} onChange={onChange} pathPrefix="" />
          {!value.registryCode?.trim() && <p className="notice notice-warn">{t('profile.registryCodeMissing')}</p>}
          <div className="grid">
            <TextField label={t('field.website')} type="url" value={value.website} onChange={(v) => set({ website: v || undefined })} placeholder="https://" />
          </div>
        </Section>
      )}

      {has('vat') && (
        <Section id="sec-vat" title={t('profile.vat')}>
          <CheckboxField
            label={t('profile.vatRegistered')}
            hint={t('profile.vatRegisteredHint')}
            checked={value.vatRegistered}
            onChange={(v) =>
              set({
                vatRegistered: v,
                defaults: {
                  ...d,
                  vatScheme: v ? (d.vatScheme === 'not-registered' ? 'domestic' : d.vatScheme) : 'not-registered',
                },
              })
            }
          />
          {value.vatRegistered && !value.vatNumber && <p className="notice notice-warn">{t('profile.vatNumberMissing')}</p>}
        </Section>
      )}

      {has('bank') && (
        <Section id="sec-bank" title={t('profile.bank')} description={t('profile.bankHint')}>
          <BankAccountsEditor value={value.bankAccounts} onChange={(bankAccounts) => set({ bankAccounts })} />
        </Section>
      )}

      {has('logo') && (
        <Section id="sec-logo" title={t('profile.logo')}>
          <LogoInput value={value.logoDataUrl} onChange={(logoDataUrl) => set({ logoDataUrl })} />
        </Section>
      )}

      {has('design') &&
        (compactDesign ? (
          // Onboarding: the step heading already says "Arve kujundus".
          <section className="panel section" id="sec-design" aria-label={t('appearance.design')}>
            <div className="section-body">
              <InvoiceDesign value={value} onChange={onChange} compact />
            </div>
          </section>
        ) : (
          <Section id="sec-design" title={t('appearance.design')} description={t('appearance.designHint')}>
            <InvoiceDesign value={value} onChange={onChange} />
          </Section>
        ))}

      {has('defaults') && (
        <Section id="sec-defaults" title={t('profile.defaults')} description={t('profile.defaultsHint')}>
          <div className="grid">
            <NumberField label={t('field.paymentTerm')} value={d.paymentTermDays} onChange={(v) => setDefaults({ paymentTermDays: Math.max(0, Math.round(v ?? 0)) })} suffix={t('common.days')} />
            <SelectField label={t('field.invoiceLanguage')} value={d.language} onChange={(language) => setDefaults({ language })} options={languageOptions(t)} />
            <SelectField label={t('field.currency')} value={d.currency} onChange={(currency) => setDefaults({ currency })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            <SelectField
              label={t('field.vatScheme')}
              value={d.vatScheme}
              onChange={(vatScheme) => setDefaults({ vatScheme })}
              options={vatSchemeOptions(t)}
              disabled={!value.vatRegistered}
              hint={!value.vatRegistered ? t('profile.schemeLocked') : undefined}
            />
            {value.vatRegistered && (
              <SelectField
                label={t('field.defaultVatRate')}
                value={String(d.defaultVatRate)}
                onChange={(v) => setDefaults({ defaultVatRate: Number(v) })}
                options={vatRates(d.defaultVatRate).map((r) => ({ value: String(r), label: `${r}%` }))}
              />
            )}
            <TextField label={t('field.defaultUnit')} value={d.defaultUnit} onChange={(defaultUnit) => setDefaults({ defaultUnit })} list="unit-suggestions" />
            <NumberField
              label={t('field.lateInterest')}
              value={d.lateInterestPercentPerDay}
              onChange={(v) => setDefaults({ lateInterestPercentPerDay: v ?? undefined })}
              allowEmpty
              suffix={t('common.percentPerDay')}
              hint={t('field.lateInterestHint')}
            />
          </div>
          <datalist id="unit-suggestions">
            {UNIT_SUGGESTIONS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <div className="text-rows-defaults">
            <div className="grid">
              <DefaultTextRows kind="before" rows={d.textBefore} onChange={(textBefore) => setDefaults({ textBefore })} />
              <DefaultTextRows kind="after" rows={d.textAfter} onChange={(textAfter) => setDefaults({ textAfter })} />
            </div>
            <p className="field-hint">{t('profile.textRowsHint')}</p>
          </div>
          <TextAreaField label={t('field.footerNote')} value={d.footerNote} onChange={(v) => setDefaults({ footerNote: v || undefined })} hint={t('field.footerNoteHint')} rows={2} />
          <CheckboxField label={t('field.paymentQr')} hint={t('field.paymentQrHint')} checked={!!d.paymentQr} onChange={(paymentQr) => setDefaults({ paymentQr })} />
        </Section>
      )}

      {has('numbering') && (
        <Section id="sec-numbering" title={t('profile.numbering')} description={t('profile.numberingHint')}>
          <NumberingEditor
            idPrefix="numbering"
            value={value.numbering}
            onChange={(numbering) => set({ numbering })}
            presets={NUMBERING_PRESETS}
            documents={invoiceDocs}
            usedNumbers={usedNumbers}
            today={today}
          />
        </Section>
      )}

      {has('quoteNumbering') && (
        <Section id="sec-quote-numbering" title={t('numbering.quoteTitle')} description={t('numbering.quoteHint')}>
          <NumberingEditor
            idPrefix="quote-numbering"
            value={value.quoteNumbering ?? DEFAULT_QUOTE_NUMBERING}
            onChange={(quoteNumbering) => set({ quoteNumbering })}
            presets={QUOTE_NUMBERING_PRESETS}
            documents={quoteDocs}
            usedNumbers={usedNumbers}
            today={today}
          />
        </Section>
      )}

      {has('email') && (
        <Section id="sec-email" title={t('profile.emailTemplates')} description={t('profile.emailTemplatesHint')}>
          <h3 className="subhead">{t('profile.emailEt')}</h3>
          <TextField label={t('email.subject')} value={d.emailSubject} onChange={(emailSubject) => setDefaults({ emailSubject })} />
          <TextAreaField label={t('email.body')} value={d.emailBody} onChange={(emailBody) => setDefaults({ emailBody })} rows={6} />
          <h3 className="subhead">{t('profile.emailEn')}</h3>
          <TextField label={t('email.subject')} value={d.emailSubjectEn ?? DEFAULT_EMAIL_SUBJECT_EN} onChange={(emailSubjectEn) => setDefaults({ emailSubjectEn })} lang="en" />
          <TextAreaField label={t('email.body')} value={d.emailBodyEn ?? DEFAULT_EMAIL_BODY_EN} onChange={(emailBodyEn) => setDefaults({ emailBodyEn })} rows={6} lang="en" />
          <p className="field-hint">{t('profile.placeholders')}</p>
        </Section>
      )}
    </div>
  )
}
