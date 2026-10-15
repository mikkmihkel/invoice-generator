import { ArrowsClockwiseIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { numberingFor, raiseNumbering, type CompanyProfile, type NumberingSettings, type RegistryCompany } from '../../domain'
import { useApp } from '../AppContext'
import { CompanySearch } from '../components/CompanySearch'
import { Dialog, useConfirm } from '../components/Dialog'
import { useNavGuard } from '../navGuard'
import { useToast } from '../Toasts'
import { errorMessage, partyFromRegistry } from '../util'
import { focusField } from './editor/ValidationPanel'
import { ProfileForm, profileForSave, profileProblems } from './ProfileForm'

/** Whether `edited` sets the next number (or a period counter) below `base`. */
function lowersNumbering(edited: NumberingSettings, base: NumberingSettings): boolean {
  const raised = raiseNumbering(edited, base)
  if (raised.nextNumber !== edited.nextNumber) return true
  return Object.entries(raised.counters ?? {}).some(([key, n]) => edited.counters?.[key] !== n)
}

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

  // Follow background profile reloads only while there are no unsaved edits. The ref is updated synchronously in
  // change(), so a reload whose effect runs after the user's first edit can no longer overwrite that edit.
  const dirtyRef = useRef(false)
  // The profile the draft started from: number series set below it were lowered on purpose in the editor.
  const baseRef = useRef(profile)
  useEffect(() => {
    if (!dirtyRef.current) baseRef.current = profile
    setDraft((cur) => (dirtyRef.current ? cur : profile))
  }, [profile])

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
    dirtyRef.current = true
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
      const base = baseRef.current
      const lowered = (type: 'invoice' | 'quote') => !!base && lowersNumbering(numberingFor(draft, type), numberingFor(base, type))
      // Unless lowered here on purpose, the repository keeps numbers another tab issued in the meantime.
      await saveProfile(profileForSave(draft), { allowLowerNumbering: { invoice: lowered('invoice'), quote: lowered('quote') } })
      dirtyRef.current = false
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
      <ProfileForm value={draft} onChange={change} sections={['company', 'vat', 'bank', 'design', 'defaults', 'numbering', 'quoteNumbering', 'email']} />
      <div className={`form-actions sticky-actions${dirty ? ' is-dirty' : ''}`}>
        {dirty && <span className="unsaved">{t('common.unsavedChanges')}</span>}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!dirty || saving}
          onClick={() => {
            dirtyRef.current = false
            baseRef.current = profile
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
