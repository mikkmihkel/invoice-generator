import { formatInvoiceNumber, type CompanyProfile, type InvoiceDefaults, type NumberingSettings } from '../../domain'
import { useApp } from '../AppContext'
import { AccentPicker, TemplatePicker } from '../components/Appearance'
import { CheckboxField, NumberField, SelectField, TextAreaField, TextField } from '../components/fields'
import { BankAccountsEditor, LogoInput, Section } from '../components/misc'
import { PartyFields } from '../components/PartyFields'
import { CURRENCIES, languageOptions, vatRates, vatSchemeOptions, UNIT_SUGGESTIONS } from '../options'
import { localTodayISO } from '../util'

export function numberingPreview(n: NumberingSettings, year = Number(localTodayISO().slice(0, 4))): string {
  try {
    return formatInvoiceNumber(n, n.nextNumber, year)
  } catch {
    return n.prefix.replace('{YYYY}', String(year)) + String(n.nextNumber).padStart(n.padding, '0')
  }
}

export type ProfileSection = 'company' | 'vat' | 'bank' | 'logo' | 'defaults' | 'numbering' | 'email'

/** Problems that must be fixed before the profile can be saved. */
export function profileProblems(p: CompanyProfile, t: (k: 'profile.needName' | 'profile.needIban') => string): string[] {
  const out: string[] = []
  if (!p.name.trim()) out.push(t('profile.needName'))
  if (!p.bankAccounts.some((a) => a.iban.trim())) out.push(t('profile.needIban'))
  return out
}

export function ProfileForm({ value, onChange, sections }: { value: CompanyProfile; onChange: (p: CompanyProfile) => void; sections: ProfileSection[] }) {
  const { t } = useApp()
  const has = (s: ProfileSection) => sections.includes(s)
  const set = (patch: Partial<CompanyProfile>) => onChange({ ...value, ...patch })
  const setDefaults = (patch: Partial<InvoiceDefaults>) => set({ defaults: { ...value.defaults, ...patch } })
  const setNumbering = (patch: Partial<NumberingSettings>) => set({ numbering: { ...value.numbering, ...patch } })
  const d = value.defaults

  return (
    <div className="stack">
      {has('company') && (
        <Section id="sec-company" title={t('profile.company')} description={t('profile.companyHint')}>
          <PartyFields value={value} onChange={onChange} pathPrefix="" />
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
          <TextAreaField label={t('field.footerNote')} value={d.footerNote} onChange={(v) => setDefaults({ footerNote: v || undefined })} hint={t('field.footerNoteHint')} rows={2} />
          <TemplatePicker value={d.templateId} onChange={(templateId) => setDefaults({ templateId })} accent={d.accentColor} />
          <AccentPicker value={d.accentColor} onChange={(accentColor) => setDefaults({ accentColor })} />
        </Section>
      )}

      {has('numbering') && (
        <Section id="sec-numbering" title={t('profile.numbering')} description={t('profile.numberingHint')}>
          <div className="grid">
            <TextField label={t('field.prefix')} value={value.numbering.prefix} onChange={(prefix) => setNumbering({ prefix })} hint={t('field.prefixHint')} />
            <NumberField label={t('field.nextNumber')} value={value.numbering.nextNumber} onChange={(v) => setNumbering({ nextNumber: Math.max(1, Math.round(v ?? 1)) })} />
            <NumberField label={t('field.padding')} value={value.numbering.padding} onChange={(v) => setNumbering({ padding: Math.min(10, Math.max(0, Math.round(v ?? 0))) })} />
          </div>
          <p className="numbering-preview">
            {t('profile.nextInvoiceNumber')} <strong>{numberingPreview(value.numbering)}</strong>
          </p>
        </Section>
      )}

      {has('email') && (
        <Section id="sec-email" title={t('profile.emailTemplates')} description={t('profile.emailTemplatesHint')}>
          <TextField label={t('email.subject')} value={d.emailSubject} onChange={(emailSubject) => setDefaults({ emailSubject })} />
          <TextAreaField label={t('email.body')} value={d.emailBody} onChange={(emailBody) => setDefaults({ emailBody })} rows={6} />
          <p className="field-hint">{t('profile.placeholders')}</p>
        </Section>
      )}
    </div>
  )
}
