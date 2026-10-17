import { ArrowLeftIcon, ArrowRightIcon, CaretRightIcon, CheckIcon, ClockCounterClockwiseIcon, PencilSimpleIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import { createDefaultProfile, newId, type CompanyProfile, type RegistryCompany } from '../../domain'
import { effectiveClientId } from '../../integrations/googleClient'
import { useApp } from '../AppContext'
import { CompanySearch } from '../components/CompanySearch'
import { Segmented } from '../components/ui'
import { OnboardingDriveStep } from '../google/OnboardingDriveStep'
import { BrandMark } from '../Layout'
import { useToast } from '../Toasts'
import { errorMessage, partyFromRegistry } from '../util'
import { ProfileForm, profileForSave, profileProblems, type ProfileSection } from './ProfileForm'
import { BackupImport } from './SettingsPage'

function initialProfile(): CompanyProfile {
  const p = createDefaultProfile()
  return { ...p, bankAccounts: p.bankAccounts.length ? p.bankAccounts : [{ id: newId(), iban: '' }] }
}

/** 0 is "Google Drive", shown first when Google sign-in is available. */
type Step = 0 | 1 | 2 | 3

const SECTIONS: Record<Step, ProfileSection[]> = {
  0: [],
  1: ['company', 'vat'],
  2: ['bank', 'logo'],
  3: ['design'],
}

/**
 * First run in three calm steps: company (register search first) → bank account and logo → invoice design
 * (template, colours, live preview), with payment term, language and numbering behind a closed "Lisavalikud".
 * When Google sign-in is available, a "Save to your Google Drive (recommended)" step comes first.
 */
export default function Onboarding() {
  const { t, saveProfile, lang, saveSettings, settings } = useApp()
  const toast = useToast()
  const [withDrive] = useState(() => !!effectiveClientId(settings))
  const steps: Step[] = withDrive ? [0, 1, 2, 3] : [1, 2, 3]
  const [step, setStep] = useState<Step>(withDrive ? 0 : 1)
  const [finding, setFinding] = useState(true)
  const [profile, setProfile] = useState<CompanyProfile>(initialProfile)
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const labels: Record<Step, string> = { 0: t('onboarding.stepDrive'), 1: t('onboarding.step1'), 2: t('onboarding.step2'), 3: t('onboarding.step3Design') }
  const heads: Record<Step, string> = { ...labels, 0: t('gdrive.onbTitle') }
  const hints: Record<Step, string> = { 0: '', 1: t('onboarding.step1Hint'), 2: t('onboarding.step2Hint'), 3: t('onboarding.step3DesignHint') }

  const onPick = (c: RegistryCompany) => {
    const party = partyFromRegistry(c)
    const vatRegistered = !!c.vatNumber
    setProfile((p) => ({
      ...p,
      ...party,
      vatRegistered,
      defaults: { ...p.defaults, vatScheme: vatRegistered ? (p.defaults.vatScheme === 'not-registered' ? 'domestic' : p.defaults.vatScheme) : 'not-registered' },
    }))
    setFinding(false)
  }

  // Each step only blocks on its own problems; the last step re-checks everything before saving.
  const all = profileProblems(profile, t)
  const ibanProblem = t('profile.needIban')
  const problems = step === 1 ? all.filter((p) => p !== ibanProblem) : step === 2 ? all.filter((p) => p === ibanProblem) : all

  const goTo = (s: Step) => {
    setStep(s)
    setShowErrors(false)
    requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true })
      headingRef.current?.scrollIntoView?.({ block: 'center' })
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      await saveProfile(profileForSave(profile))
      toast.success(t('onboarding.saved'))
    } catch (err) {
      toast.error(t('common.saveFailed') + ' ' + errorMessage(err))
      setSaving(false)
    }
  }

  const next = (e: React.FormEvent) => {
    e.preventDefault()
    if (problems.length) {
      setShowErrors(true)
      return
    }
    if (step < 3) goTo((step + 1) as Step)
    else void save()
  }

  return (
    <div className="onboarding">
      <header className="onb-bar">
        <span className="brand">
          <BrandMark profile={profile.name ? profile : null} />
          <span className="brand-text">
            <span className="brand-name">{t('app.name')}</span>
          </span>
        </span>
        <Segmented
          label={t('settings.uiLanguage')}
          value={lang}
          onChange={(uiLanguage) => void saveSettings({ uiLanguage })}
          options={[
            { value: 'et', label: 'ET' },
            { value: 'en', label: 'EN' },
          ]}
        />
      </header>

      <div className="onb-main">
        <div className="onb-intro">
          <h1>{t('onboarding.title')}</h1>
          <p className="lead">{t('onboarding.lead')}</p>
        </div>

        <ol className={`stepper${steps.length === 4 ? ' stepper-4' : ''}`} aria-label={t('onboarding.steps')}>
          {steps.map((s, i) => (
            <li key={s} aria-current={step === s ? 'step' : undefined} className={s < step ? 'stepper-done' : s === step ? 'stepper-current' : undefined}>
              <span className="stepper-no" aria-hidden="true">
                {s < step ? <CheckIcon size={12} /> : i + 1}
              </span>
              <span className="stepper-label">{labels[s]}</span>
            </li>
          ))}
        </ol>

        <div className="onb-step-head">
          <h2 ref={headingRef} tabIndex={-1}>
            {heads[step]}
          </h2>
          {hints[step] && <p>{hints[step]}</p>}
        </div>

        {step === 0 ? (
          <OnboardingDriveStep onNext={() => goTo(1)} />
        ) : step === 1 && finding ? (
          <div className="onb-find">
            <div className="panel onb-search">
              <CompanySearch onPick={onPick} autoFocus label={t('onboarding.searchLabel')} />
              {settings.registryLiveLookup && <p className="field-hint">{t('onboarding.liveLookupNote')}</p>}
              <div className="divider">
                <span>{t('common.or')}</span>
              </div>
              <button type="button" className="btn" onClick={() => setFinding(false)}>
                <PencilSimpleIcon />
                {t('onboarding.manual')}
              </button>
            </div>
            <details className="panel disclosure onb-restore">
              <summary>
                <ClockCounterClockwiseIcon className="caret-static" />
                <span className="disclosure-title">{t('onboarding.restore')}</span>
              </summary>
              <div className="disclosure-body">
                <p className="field-hint">{t('onboarding.restoreHint')}</p>
                <BackupImport compact />
              </div>
            </details>
            {withDrive && (
              <div className="onb-actions">
                <button type="button" className="btn btn-ghost" onClick={() => goTo(0)}>
                  <ArrowLeftIcon />
                  {t('common.back')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={next} noValidate className="onb-form">
            <ProfileForm value={profile} onChange={setProfile} sections={SECTIONS[step]} compactDesign />
            {step === 3 && (
              <details className="panel disclosure onb-more">
                <summary>
                  <CaretRightIcon className="caret" />
                  <span className="disclosure-title">{t('onboarding.moreOptions')}</span>
                  <span className="disclosure-hint">{t('onboarding.moreOptionsHint')}</span>
                </summary>
                <div className="disclosure-body">
                  <ProfileForm value={profile} onChange={setProfile} sections={['defaults', 'numbering']} />
                </div>
              </details>
            )}
            {showErrors && problems.length > 0 && (
              <div className="notice notice-error" role="alert">
                <ul>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="onb-actions">
              {step === 1 ? (
                <button type="button" className="btn btn-ghost" onClick={() => setFinding(true)}>
                  <ArrowLeftIcon />
                  {t('onboarding.backToSearch')}
                </button>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => goTo((step - 1) as Step)}>
                  <ArrowLeftIcon />
                  {t('common.back')}
                </button>
              )}
              {step < 3 ? (
                <button type="submit" className="btn btn-primary">
                  {t('common.next')}
                  <ArrowRightIcon />
                </button>
              ) : (
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? t('common.saving') : t('onboarding.finish')}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
