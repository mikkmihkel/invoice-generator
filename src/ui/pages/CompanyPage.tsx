import { useEffect, useState } from 'react'
import type { CompanyProfile, RegistryCompany } from '../../domain'
import { useApp } from '../AppContext'
import { CompanySearch } from '../components/CompanySearch'
import { Dialog } from '../components/Dialog'
import { useToast } from '../Toasts'
import { errorMessage, partyFromRegistry } from '../util'
import { ProfileForm, profileProblems } from './ProfileForm'

export default function CompanyPage() {
  const { t, profile, saveProfile } = useApp()
  const toast = useToast()
  const [draft, setDraft] = useState<CompanyProfile | null>(profile)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lookup, setLookup] = useState(false)

  useEffect(() => {
    if (!dirty) setDraft(profile)
  }, [profile, dirty])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (!draft) return null

  const change = (p: CompanyProfile) => {
    setDraft(p)
    setDirty(true)
  }

  const refreshFromRegistry = (c: RegistryCompany) => {
    const party = partyFromRegistry(c)
    change({ ...draft, name: party.name, registryCode: party.registryCode, vatNumber: party.vatNumber ?? draft.vatNumber, address: party.address })
    setLookup(false)
    toast.info(t('company.refreshed'))
  }

  const problems = profileProblems(draft, t)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (problems.length) {
      toast.error(problems.join(' '))
      return
    }
    setSaving(true)
    try {
      await saveProfile({ ...draft, bankAccounts: draft.bankAccounts.filter((a) => a.iban.trim()) })
      setDirty(false)
      toast.success(t('common.saved'))
    } catch (err) {
      toast.error(t('common.saveFailed') + ' ' + errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    <form className="page page-narrow" onSubmit={save} noValidate>
      <div className="page-head">
        <div>
          <h1>{t('nav.company')}</h1>
          <p className="muted">{t('company.intro')}</p>
        </div>
        <button type="button" className="btn" onClick={() => setLookup(true)}>
          {t('company.refresh')}
        </button>
      </div>
      <ProfileForm value={draft} onChange={change} sections={['company', 'vat', 'bank', 'logo', 'defaults', 'numbering', 'email']} />
      <div className="form-actions sticky-actions">
        {dirty && <span className="muted">{t('common.unsavedChanges')}</span>}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(profile)
            setDirty(false)
          }}
        >
          {t('common.discard')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
      {lookup && (
        <Dialog title={t('company.refresh')} onClose={() => setLookup(false)} closeLabel={t('common.close')}>
          <CompanySearch onPick={refreshFromRegistry} autoFocus />
        </Dialog>
      )}
    </>
  )
}
