import { DEFAULT_EMAIL_BODY_EN, DEFAULT_EMAIL_SUBJECT_EN, formatInvoiceNumber, type CompanyProfile, type InvoiceDefaults, type NumberingSettings } from '../../domain'
import { useApp } from '../AppContext'
import { InvoiceDesign } from '../components/Appearance'
import { CheckboxField, NumberField, SelectField, TextAreaField, TextField } from '../components/fields'
import { BankAccountsEditor, LogoInput, Section } from '../components/misc'
import { PartyFields, registryCodeError, vatNumberError } from '../components/PartyFields'
import { CURRENCIES, languageOptions, vatRates, vatSchemeOptions, UNIT_SUGGESTIONS } from '../options'
import { localTodayISO } from '../util'

export function numberingPreview(n: NumberingSettings, year = Number(localTodayISO().slice(0, 4))): string {
  return formatInvoiceNumber(n, n.nextNumber, year)
}

/** `design` = "Arve kujundus": logo, default template, colours and a live preview (`logo` = the logo alone). */
export type ProfileSection = 'company' | 'vat' | 'bank' | 'logo' | 'design' | 'defaults' | 'numbering' | 'email'

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
          <TextAreaField label={t('field.footerNote')} value={d.footerNote} onChange={(v) => setDefaults({ footerNote: v || undefined })} hint={t('field.footerNoteHint')} rows={2} />
          <CheckboxField label={t('field.paymentQr')} hint={t('field.paymentQrHint')} checked={!!d.paymentQr} onChange={(paymentQr) => setDefaults({ paymentQr })} />
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
