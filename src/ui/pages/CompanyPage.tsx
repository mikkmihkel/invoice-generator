import { ArrowsClockwiseIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CompanyProfile, RegistryCompany } from '../../domain'
import { useApp } from '../AppContext'
import { CompanySearch } from '../components/CompanySearch'
import { Dialog, useConfirm } from '../components/Dialog'
import { useNavGuard } from '../navGuard'
import { useToast } from '../Toasts'
import { errorMessage, partyFromRegistry } from '../util'
import { focusField } from './editor/ValidationPanel'
import { ProfileForm, profileForSave, profileProblems } from './ProfileForm'

export default function CompanyPage() {
  const { t, profile, saveProfile } = useApp()
  const toast = useToast()
  const [draft, setDraft] = useState<CompanyProfile | null>(profile)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lookup, setLookup] = useState(false)
  const [search] = useSearchParams()
  const focus = search.get('focus')
  const ready = !!draft

  // Arriving from an invoice's validation panel (#/company?focus=vatNumber): focus the field to fix.
  useEffect(() => {
    if (!focus || !ready) return
    const h = setTimeout(() => {
      if (!focusField(focus) && focus.startsWith('bankAccounts')) document.getElementById('sec-bank')?.scrollIntoView?.({ block: 'start' })
    }, 0)
    return () => clearTimeout(h)
  }, [focus, ready])

  useEffect(() => {
    if (!dirty) setDraft(profile)
  }, [profile, dirty])

  // Leaving through the top bar with unsaved changes asks first (reloads/closing the tab: beforeunload below).
  const confirm = useConfirm()
  useNavGuard(dirty, () =>
    confirm({ title: t('common.unsavedChanges'), message: t('company.leaveConfirm'), confirmLabel: t('common.discard'), cancelLabel: t('common.keepEditing'), danger: true }),
  )

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
      await saveProfile(profileForSave(draft))
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
    <form className="page page-form form-page" onSubmit={save} noValidate>
      <div className="page-head">
        <div>
          <h1>{t('nav.company')}</h1>
          <p className="page-sub">{t('company.intro')}</p>
        </div>
        <button type="button" className="btn" onClick={() => setLookup(true)}>
          <ArrowsClockwiseIcon />
          {t('company.refresh')}
        </button>
      </div>
      <ProfileForm value={draft} onChange={change} sections={['company', 'vat', 'bank', 'design', 'defaults', 'numbering', 'email']} />
      <div className={`form-actions sticky-actions${dirty ? ' is-dirty' : ''}`}>
        {dirty && <span className="unsaved">{t('common.unsavedChanges')}</span>}
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
