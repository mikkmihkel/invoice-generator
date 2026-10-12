import { useEffect, useRef, useState } from 'react'
import type { BackupFile } from '../../domain'
import { RegistryAttribution } from '../components/CompanySearch'
import { backupToDrive, downloadBlob, getGoogleStatus, googleSignIn, googleSignOut, restoreFromDrive, type GoogleStatus } from '../../integrations'
import { getIndexInfo, type RegistryIndexInfo } from '../../registry'
import { backupFileName, requestPersistentStorage, serializeBackup } from '../../storage'
import { useApp } from '../AppContext'
import { GOOGLE_CLIENT_ID_RE, keepClientId, paymentDetailChanges, readBackupText } from './backupReview'
import { Dialog, useConfirm } from '../components/Dialog'
import { CheckboxField, SelectField, TextField } from '../components/fields'
import { Section } from '../components/misc'
import { formatDateTime } from '../format'
import { useToast } from '../Toasts'
import { errorMessage, getLastBackupAt, markBackupDone } from '../util'

export const REPO_URL = 'https://github.com/mikkmihkel/invoice-generator'
export const GOOGLE_SETUP_URL = `${REPO_URL}/blob/main/docs/google-setup.md`
export const LEGAL_DOC_URL = `${REPO_URL}/blob/main/docs/legal-requirements.md`

/** Shows what a backup contains and imports it with merge or replace. */
export function ImportBackupDialog({ backup, onClose }: { backup: BackupFile; onClose: () => void }) {
  const { t, repo, reload, profile, settings } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [importClientId, setImportClientId] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const changes = paymentDetailChanges({ profile, settings }, backup)
  const clientIdChange = changes.some((c) => c.field === 'googleClientId')
  // Changed payment details (or an imported client ID) need an explicit confirmation.
  const needsReview = changes.some((c) => c.field !== 'googleClientId') || (clientIdChange && importClientId)
  const blocked = busy || (needsReview && !reviewed)

  const run = async (mode: 'merge' | 'replace') => {
    if (mode === 'replace') {
      const ok = await confirm({ title: t('backup.replaceTitle'), message: t('backup.replaceConfirm'), confirmLabel: t('backup.replace'), cancelLabel: t('common.cancel'), danger: true })
      if (!ok) return
    }
    setBusy(true)
    try {
      const res = await repo.importBackup(importClientId ? backup : keepClientId(backup, settings.googleClientId), mode)
      await reload()
      toast.success(t('backup.imported'))
      if (res?.duplicateNumbers?.length) toast.error(t('backup.duplicates', { numbers: res.duplicateNumbers.join(', ') }))
      onClose()
    } catch (e) {
      toast.error(t('backup.importFailed') + ' ' + errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t('backup.importTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void run('replace')} disabled={blocked}>
            {t('backup.replace')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void run('merge')} disabled={blocked} data-autofocus>
            {t('backup.merge')}
          </button>
        </>
      }
    >
      <p>{t('backup.contains', { date: formatDateTime(backup.exportedAt), invoices: backup.invoices.length, clients: backup.clients.length })}</p>
      {backup.profile && <p className="muted">{t('backup.containsProfile', { name: backup.profile.name })}</p>}
      <ul className="muted small">
        <li>{t('backup.mergeHint')}</li>
        <li>{t('backup.replaceHint')}</li>
      </ul>
      {changes.length > 0 && (
        <div className="notice notice-warn backup-changes">
          <strong>{t('backup.changesTitle')}</strong>
          <p className="small">{t('backup.changesIntro')}</p>
          <dl className="change-list">
            {changes.map((c) => (
              <div key={c.field}>
                <dt>{t(`backup.change.${c.field}`)}</dt>
                <dd>
                  <span className="change-from">{c.from || t('backup.notSet')}</span> → <strong className="change-to">{c.to || t('backup.notSet')}</strong>
                </dd>
              </div>
            ))}
          </dl>
          {clientIdChange && (
            <CheckboxField label={t('backup.importClientId')} hint={t('backup.importClientIdHint')} checked={importClientId} onChange={setImportClientId} disabled={busy} />
          )}
          {needsReview && <CheckboxField label={t('backup.confirmChanges')} checked={reviewed} onChange={setReviewed} disabled={busy} />}
        </div>
      )}
    </Dialog>
  )
}

export function BackupImport({ compact }: { compact?: boolean }) {
  const { t, lang } = useApp()
  const toast = useToast()
  const [pending, setPending] = useState<BackupFile | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const res = readBackupText(await file.text(), lang)
      if ('error' in res) toast.error(t('backup.invalidReason', { reason: res.error }))
      else setPending(res.backup)
    } catch (e) {
      toast.error(t('backup.importFailed') + ' ' + errorMessage(e, lang))
    } finally {
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <>
      <label className={`btn${compact ? ' btn-sm' : ''}`}>
        {t('backup.importFile')}
        <input ref={ref} type="file" accept="application/json,.json" className="visually-hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {pending && <ImportBackupDialog backup={pending} onClose={() => setPending(null)} />}
    </>
  )
}

export default function SettingsPage() {
  const { t, settings, saveSettings, repo, lang } = useApp()
  const toast = useToast()
  const [clientId, setClientId] = useState(settings.googleClientId ?? '')
  const [folder, setFolder] = useState(settings.driveFolderName)
  const [google, setGoogle] = useState<GoogleStatus>(() => getGoogleStatus(settings.googleClientId))
  const [lastBackup, setLastBackup] = useState(getLastBackupAt)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [indexInfo, setIndexInfo] = useState<RegistryIndexInfo | null | 'loading'>('loading')
  const [busy, setBusy] = useState<string | null>(null)
  const [driveBackup, setDriveBackup] = useState<BackupFile | null>(null)

  useEffect(() => setClientId(settings.googleClientId ?? ''), [settings.googleClientId])
  useEffect(() => setFolder(settings.driveFolderName), [settings.driveFolderName])

  useEffect(() => {
    let alive = true
    navigator.storage
      ?.persisted?.()
      .then((p) => alive && setPersisted(p))
      .catch(() => undefined)
    getIndexInfo()
      .then((info) => alive && setIndexInfo(info))
      .catch(() => alive && setIndexInfo(null))
    return () => {
      alive = false
    }
  }, [])

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const clientIdError = clientId.trim() && !GOOGLE_CLIENT_ID_RE.test(clientId.trim()) ? t('google.clientIdInvalid') : undefined

  const saveGoogle = () =>
    withBusy('google-save', async () => {
      if (clientIdError) throw new Error(clientIdError)
      const id = clientId.trim() || undefined
      await saveSettings({ googleClientId: id, driveFolderName: folder.trim() || settings.driveFolderName })
      setGoogle(getGoogleStatus(id))
      toast.success(t('common.saved'))
    })

  const connect = () =>
    withBusy('google-connect', async () => {
      if (!settings.googleClientId) throw new Error(t('google.needClientId'))
      setGoogle(await googleSignIn(settings.googleClientId, ['drive', 'gmail']))
      toast.success(t('google.connected'))
    })

  const disconnect = () =>
    withBusy('google-disconnect', async () => {
      await googleSignOut()
      setGoogle(getGoogleStatus(settings.googleClientId))
      toast.info(t('google.disconnected'))
    })

  const exportBackup = () =>
    withBusy('export', async () => {
      const backup = await repo.exportBackup()
      downloadBlob(new Blob([serializeBackup(backup)], { type: 'application/json' }), backupFileName())
      markBackupDone()
      setLastBackup(getLastBackupAt())
      toast.success(t('backup.exported'))
    })

  const toDrive = () =>
    withBusy('drive-backup', async () => {
      if (!settings.googleClientId) throw new Error(t('google.needClientId'))
      // Sign in first: the consent popup must open directly from the click.
      await googleSignIn(settings.googleClientId, ['drive'])
      const backup = await repo.exportBackup()
      const res = await backupToDrive(settings.googleClientId, serializeBackup(backup), settings.driveFolderName)
      markBackupDone()
      setLastBackup(getLastBackupAt())
      setGoogle(getGoogleStatus(settings.googleClientId))
      toast.success(t('backup.driveSaved', { time: formatDateTime(res.modifiedTime) }))
    })

  const fromDrive = () =>
    withBusy('drive-restore', async () => {
      if (!settings.googleClientId) throw new Error(t('google.needClientId'))
      await googleSignIn(settings.googleClientId, ['drive'])
      const json = await restoreFromDrive(settings.googleClientId, settings.driveFolderName)
      if (!json) {
        toast.info(t('backup.driveNone'))
        return
      }
      const res = readBackupText(json, lang)
      if ('error' in res) throw new Error(t('backup.invalidReason', { reason: res.error }))
      setDriveBackup(res.backup)
    })

  const persist = () =>
    withBusy('persist', async () => {
      const ok = await requestPersistentStorage()
      setPersisted(ok)
      if (ok) toast.success(t('data.persistGranted'))
      else toast.info(t('data.persistDenied'))
    })

  const hasGoogle = !!settings.googleClientId

  return (
    <div className="page page-narrow">
      <h1>{t('nav.settings')}</h1>
      <div className="stack">
        <Section id="set-lang" title={t('settings.general')}>
          <SelectField
            label={t('settings.uiLanguage')}
            value={lang}
            onChange={(uiLanguage) => void saveSettings({ uiLanguage })}
            options={[
              { value: 'et', label: 'Eesti' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Section>

        <Section id="set-google" title={t('google.title')} description={t('google.intro')}>
          <ol className="howto">
            <li>{t('google.step1')}</li>
            <li>{t('google.step2')}</li>
            <li>{t('google.step3')}</li>
          </ol>
          <p>
            <a href={GOOGLE_SETUP_URL} target="_blank" rel="noreferrer">
              {t('google.guideLink')} ↗
            </a>
          </p>
          <div className="grid">
            <TextField className="span-2" label={t('google.clientId')} value={clientId} onChange={setClientId} placeholder="123456789-abc.apps.googleusercontent.com" spellCheck={false} error={clientIdError} />
            <TextField label={t('google.folder')} value={folder} onChange={setFolder} hint={t('google.folderHint')} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => void saveGoogle()} disabled={busy !== null}>
              {t('common.save')}
            </button>
            {hasGoogle && !google.signedIn && (
              <button type="button" className="btn btn-primary" onClick={() => void connect()} disabled={busy !== null}>
                {t('google.connect')}
              </button>
            )}
            {google.signedIn && (
              <button type="button" className="btn" onClick={() => void disconnect()} disabled={busy !== null}>
                {t('google.disconnect')}
              </button>
            )}
          </div>
          <p className="status-line">
            <span className={`dot ${google.signedIn ? 'dot-ok' : hasGoogle ? 'dot-idle' : 'dot-off'}`} aria-hidden="true" />
            {google.signedIn ? t('google.statusSignedIn', { email: google.email ?? '' }) : hasGoogle ? t('google.statusConfigured') : t('google.statusOff')}
          </p>
        </Section>

        <Section id="set-data" title={t('data.title')} description={t('data.intro')}>
          <div className="setting-row">
            <div>
              <strong>{t('data.persistTitle')}</strong>
              <p className="muted small">{persisted === true ? t('data.persistOn') : persisted === false ? t('data.persistOff') : t('data.persistUnknown')}</p>
            </div>
            {persisted !== true && (
              <button type="button" className="btn" onClick={() => void persist()} disabled={busy !== null}>
                {t('data.persistRequest')}
              </button>
            )}
          </div>
          <div className="setting-row">
            <div>
              <strong>{t('backup.fileTitle')}</strong>
              <p className="muted small">{t('backup.fileHint')}</p>
              <p className="muted small">{lastBackup ? t('backup.last', { date: formatDateTime(lastBackup) }) : t('backup.never')}</p>
            </div>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => void exportBackup()} disabled={busy !== null}>
                {t('backup.export')}
              </button>
              <BackupImport />
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>{t('backup.driveTitle')}</strong>
              <p className="muted small">{hasGoogle ? t('backup.driveHint', { folder: settings.driveFolderName }) : t('google.needClientId')}</p>
            </div>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => void toDrive()} disabled={!hasGoogle || busy !== null}>
                {busy === 'drive-backup' ? t('common.working') : t('backup.toDrive')}
              </button>
              <button type="button" className="btn" onClick={() => void fromDrive()} disabled={!hasGoogle || busy !== null}>
                {busy === 'drive-restore' ? t('common.working') : t('backup.fromDrive')}
              </button>
            </div>
          </div>
        </Section>

        <Section id="set-registry" title={t('registry.title')}>
          <p>
            {indexInfo === 'loading'
              ? t('common.loading')
              : indexInfo === null
                ? t('registry.indexMissing')
                : t('registry.indexInfo', { count: indexInfo.count.toLocaleString('et-EE'), date: formatDateTime(indexInfo.dataDate || indexInfo.builtAt) })}
          </p>
          <CheckboxField label={t('registry.live')} hint={t('registry.liveHint')} checked={settings.registryLiveLookup} onChange={(registryLiveLookup) => void saveSettings({ registryLiveLookup })} />
          <RegistryAttribution lang={lang} />
        </Section>

        <Section id="set-about" title={t('about.title')}>
          <p>{t('about.text')}</p>
          <p className="notice notice-warn">{t('about.notLegalAdvice')}</p>
          <p>
            <a href={LEGAL_DOC_URL} target="_blank" rel="noreferrer">
              {t('about.legalLink')} ↗
            </a>
            {' · '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              {t('about.source')} ↗
            </a>
          </p>
        </Section>
      </div>
      {driveBackup && <ImportBackupDialog backup={driveBackup} onClose={() => setDriveBackup(null)} />}
    </div>
  )
}
