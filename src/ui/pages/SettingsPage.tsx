import { useEffect, useRef, useState } from 'react'
import type { BackupFile } from '../../domain'
import { backupToDrive, downloadBlob, getGoogleStatus, googleSignIn, googleSignOut, restoreFromDrive, type GoogleStatus } from '../../integrations'
import { getIndexInfo } from '../../registry'
import { requestPersistentStorage } from '../../storage'
import { useApp } from '../AppContext'
import { Dialog, useConfirm } from '../components/Dialog'
import { CheckboxField, SelectField, TextField } from '../components/fields'
import { Section } from '../components/misc'
import { formatDateTime } from '../format'
import { useToast } from '../Toasts'
import { errorMessage, localTodayISO } from '../util'

export const REPO_URL = 'https://github.com/mikkmihkel/invoice-generator'
export const GOOGLE_SETUP_URL = `${REPO_URL}/blob/main/docs/google-setup.md`
export const LEGAL_DOC_URL = `${REPO_URL}/blob/main/docs/legal-requirements.md`

export function parseBackup(json: string): BackupFile | null {
  try {
    const data = JSON.parse(json) as Partial<BackupFile>
    if (data && data.app === 'invoice-generator' && data.version === 1 && Array.isArray(data.invoices) && Array.isArray(data.clients)) return data as BackupFile
  } catch {
    /* not JSON */
  }
  return null
}

function safeGoogleStatus(): GoogleStatus {
  try {
    return getGoogleStatus()
  } catch {
    return { configured: false, signedIn: false }
  }
}

/** Shows what a backup contains and imports it with merge or replace. */
export function ImportBackupDialog({ backup, onClose }: { backup: BackupFile; onClose: () => void }) {
  const { t, repo, reload } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)

  const run = async (mode: 'merge' | 'replace') => {
    if (mode === 'replace') {
      const ok = await confirm({ title: t('backup.replaceTitle'), message: t('backup.replaceConfirm'), confirmLabel: t('backup.replace'), cancelLabel: t('common.cancel'), danger: true })
      if (!ok) return
    }
    setBusy(true)
    try {
      await repo.importBackup(backup, mode)
      await reload()
      toast.success(t('backup.imported'))
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
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void run('replace')} disabled={busy}>
            {t('backup.replace')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void run('merge')} disabled={busy} data-autofocus>
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
    </Dialog>
  )
}

export function BackupImport({ compact }: { compact?: boolean }) {
  const { t } = useApp()
  const toast = useToast()
  const [pending, setPending] = useState<BackupFile | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    const backup = parseBackup(text)
    if (ref.current) ref.current.value = ''
    if (!backup) {
      toast.error(t('backup.invalid'))
      return
    }
    setPending(backup)
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
  const [google, setGoogle] = useState<GoogleStatus>(safeGoogleStatus)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [indexInfo, setIndexInfo] = useState<{ builtAt: string; count: number; source: string } | null | 'error'>(null)
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
      .catch(() => alive && setIndexInfo('error'))
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

  const saveGoogle = () =>
    withBusy('google-save', async () => {
      await saveSettings({ googleClientId: clientId.trim() || undefined, driveFolderName: folder.trim() || settings.driveFolderName })
      setGoogle(safeGoogleStatus())
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
      setGoogle(safeGoogleStatus())
      toast.info(t('google.disconnected'))
    })

  const exportBackup = () =>
    withBusy('export', async () => {
      const backup = await repo.exportBackup()
      downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `invoice-generator-backup-${localTodayISO()}.json`)
      toast.success(t('backup.exported'))
    })

  const toDrive = () =>
    withBusy('drive-backup', async () => {
      if (!settings.googleClientId) throw new Error(t('google.needClientId'))
      await googleSignIn(settings.googleClientId, ['drive'])
      const backup = await repo.exportBackup()
      const res = await backupToDrive(settings.googleClientId, JSON.stringify(backup), settings.driveFolderName)
      setGoogle(safeGoogleStatus())
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
      const backup = parseBackup(json)
      if (!backup) throw new Error(t('backup.invalid'))
      setDriveBackup(backup)
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
            <TextField className="span-2" label={t('google.clientId')} value={clientId} onChange={setClientId} placeholder="123456789-abc.apps.googleusercontent.com" spellCheck={false} />
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
            {indexInfo === 'error' || indexInfo === null
              ? t('registry.indexMissing')
              : t('registry.indexInfo', { count: indexInfo.count.toLocaleString('et-EE'), date: formatDateTime(indexInfo.builtAt) })}
          </p>
          <CheckboxField label={t('registry.live')} hint={t('registry.liveHint')} checked={settings.registryLiveLookup} onChange={(registryLiveLookup) => void saveSettings({ registryLiveLookup })} />
          <p className="muted small">
            {t('registry.attribution')}
            {indexInfo && indexInfo !== 'error' && indexInfo.source ? ` (${indexInfo.source})` : ''}{' '}
            <a href="https://avaandmed.ariregister.rik.ee/" target="_blank" rel="noreferrer">
              avaandmed.ariregister.rik.ee ↗
            </a>
          </p>
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
