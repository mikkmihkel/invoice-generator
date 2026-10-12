import { useState } from 'react'
import { createDefaultProfile, newId, type CompanyProfile, type RegistryCompany } from '../../domain'
import { useApp } from '../AppContext'
import { CompanySearch } from '../components/CompanySearch'
import { useToast } from '../Toasts'
import { errorMessage, partyFromRegistry } from '../util'
import { ProfileForm, profileProblems } from './ProfileForm'
import { BackupImport } from './SettingsPage'

function initialProfile(): CompanyProfile {
  const p = createDefaultProfile()
  return { ...p, bankAccounts: p.bankAccounts.length ? p.bankAccounts : [{ id: newId(), iban: '' }] }
}

/** First run: find own company in the register → check details → save. */
export default function Onboarding() {
  const { t, saveProfile, lang, saveSettings, settings } = useApp()
  const toast = useToast()
  const [step, setStep] = useState<'find' | 'details'>('find')
  const [profile, setProfile] = useState<CompanyProfile>(initialProfile)
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const onPick = (c: RegistryCompany) => {
    const party = partyFromRegistry(c)
    const vatRegistered = !!c.vatNumber
    setProfile((p) => ({
      ...p,
      ...party,
      vatRegistered,
      defaults: { ...p.defaults, vatScheme: vatRegistered ? (p.defaults.vatScheme === 'not-registered' ? 'domestic' : p.defaults.vatScheme) : 'not-registered' },
    }))
    setStep('details')
  }

  const problems = profileProblems(profile, t)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (problems.length) {
      setShowErrors(true)
      return
    }
    setSaving(true)
    try {
      await saveProfile({ ...profile, bankAccounts: profile.bankAccounts.filter((a) => a.iban.trim()) })
      toast.success(t('onboarding.saved'))
    } catch (err) {
      toast.error(t('common.saveFailed') + ' ' + errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <div className="onboarding">
      <div className="onboarding-head">
        <div className="lang-switch" role="group" aria-label={t('settings.uiLanguage')}>
          {(['et', 'en'] as const).map((l) => (
            <button key={l} type="button" className={`btn btn-sm${lang === l ? ' btn-primary' : ''}`} aria-pressed={lang === l} onClick={() => void saveSettings({ uiLanguage: l })}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <h1>{t('onboarding.title')}</h1>
        <p className="lead">{t('onboarding.lead')}</p>
        <ol className="steps" aria-label={t('onboarding.steps')}>
          <li aria-current={step === 'find' ? 'step' : undefined}>{t('onboarding.step1')}</li>
          <li aria-current={step === 'details' ? 'step' : undefined}>{t('onboarding.step2')}</li>
        </ol>
      </div>

      {step === 'find' ? (
        <div className="card onboarding-find">
          <CompanySearch onPick={onPick} autoFocus label={t('onboarding.searchLabel')} />
          {settings.registryLiveLookup && <p className="muted small">{t('onboarding.liveLookupNote')}</p>}
          <div className="divider">
            <span>{t('common.or')}</span>
          </div>
          <button type="button" className="btn" onClick={() => setStep('details')}>
            {t('onboarding.manual')}
          </button>
          <details className="onboarding-restore">
            <summary>{t('onboarding.restore')}</summary>
            <p className="muted">{t('onboarding.restoreHint')}</p>
            <BackupImport compact />
          </details>
        </div>
      ) : (
        <form onSubmit={save} noValidate>
          <ProfileForm value={profile} onChange={setProfile} sections={['company', 'vat', 'bank', 'logo', 'defaults', 'numbering']} />
          {showErrors && problems.length > 0 && (
            <div className="notice notice-error" role="alert">
              <ul>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="form-actions sticky-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep('find')}>
              ← {t('onboarding.backToSearch')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('common.saving') : t('onboarding.finish')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
