import { ArrowSquareOutIcon, CloudArrowDownIcon, CloudArrowUpIcon, DownloadSimpleIcon, ShieldCheckIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import type { BackupFile } from '../../domain'
import { RegistryAttribution } from '../components/CompanySearch'
import { backupToDrive, clearDeletedDocuments, downloadBlob, googleSignIn, restoreFromDrive } from '../../integrations'
import { driveFolderLabel, driveFolderRef, effectiveClientId } from '../../integrations/googleClient'
import { getIndexInfo, type RegistryIndexInfo } from '../../registry'
import { backupFileName, requestPersistentStorage, serializeBackup } from '../../storage'
import { useApp } from '../AppContext'
import { BackupSection } from './settings/BackupSection'
import ExportSection from './settings/ExportSection'
import { GoogleSection } from './settings/GoogleSection'
import { backupContents, changesHeading, keepClientId, keepDriveFolder, paymentDetailChanges, readBackupText } from './backupReview'
import { Dialog, useConfirm } from '../components/Dialog'
import { CheckboxField } from '../components/fields'
import { Section } from '../components/misc'
import { Segmented } from '../components/ui'
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
      const res = await repo.importBackup(keepDriveFolder(importClientId ? backup : keepClientId(backup, settings.googleClientId), settings), mode)
      // The deletions recorded here belong to the data that was just replaced.
      if (mode === 'replace') clearDeletedDocuments()
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
      <p>{backupContents(backup, t)}</p>
      {backup.profile && <p className="muted">{t('backup.containsProfile', { name: backup.profile.name })}</p>}
      <ul className="muted small">
        <li>{t('backup.mergeHint')}</li>
        <li>{t('backup.replaceHint')}</li>
      </ul>
      {changes.length > 0 && (
        <div className="notice notice-warn backup-changes">
          <strong>{changesHeading(changes, t).title}</strong>
          <p className="small">{changesHeading(changes, t).intro}</p>
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
        <UploadSimpleIcon />
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
  const [lastBackup, setLastBackup] = useState(getLastBackupAt)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [indexInfo, setIndexInfo] = useState<RegistryIndexInfo | null | 'loading'>('loading')
  const [busy, setBusy] = useState<string | null>(null)
  const [driveBackup, setDriveBackup] = useState<BackupFile | null>(null)

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

  const exportBackup = () =>
    withBusy('export', async () => {
      const backup = await repo.exportBackup()
      downloadBlob(new Blob([serializeBackup(backup)], { type: 'application/json' }), backupFileName())
      markBackupDone()
      setLastBackup(getLastBackupAt())
      toast.success(t('backup.exported'))
    })

  const clientId = effectiveClientId(settings)

  const toDrive = () =>
    withBusy('drive-backup', async () => {
      if (!clientId) throw new Error(t('google.needClientId'))
      // Sign in first: the consent popup must open directly from the click.
      await googleSignIn(clientId, ['drive'])
      const backup = await repo.exportBackup()
      const res = await backupToDrive(clientId, serializeBackup(backup), driveFolderRef(settings, 'backup'))
      markBackupDone()
      setLastBackup(getLastBackupAt())
      toast.success(t('backup.driveSaved', { time: formatDateTime(res.modifiedTime) }))
    })

  const fromDrive = () =>
    withBusy('drive-restore', async () => {
      if (!clientId) throw new Error(t('google.needClientId'))
      await googleSignIn(clientId, ['drive'])
      const json = await restoreFromDrive(clientId, driveFolderRef(settings, 'backup'))
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

  const hasGoogle = !!clientId

  return (
    <div className="page page-form form-page">
      <div className="page-head">
        <h1>{t('nav.settings')}</h1>
      </div>
      <div className="stack">
        <Section id="set-lang" title={t('settings.general')}>
          <div className="field">
            <span className="label">{t('settings.uiLanguage')}</span>
            <div>
              <Segmented
                label={t('settings.uiLanguage')}
                value={lang}
                onChange={(uiLanguage) => void saveSettings({ uiLanguage })}
                options={[
                  { value: 'et', label: 'Eesti' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </div>
            <div className="field-hint">{t('settings.languageHint')}</div>
          </div>
          <div className="field">
            <span className="label">{t('settings.theme')}</span>
            <div>
              <Segmented
                label={t('settings.theme')}
                value={settings.theme ?? 'auto'}
                onChange={(theme) => void saveSettings({ theme })}
                options={[
                  { value: 'auto', label: t('settings.theme.auto') },
                  { value: 'light', label: t('settings.theme.light') },
                  { value: 'dark', label: t('settings.theme.dark') },
                ]}
              />
            </div>
            <div className="field-hint">{t('settings.themeHint')}</div>
          </div>
        </Section>

        <GoogleSection />

        <BackupSection />

        <Section id="set-data" title={t('data.title')} description={t('data.intro')}>
          <div className="setting-row">
            <div>
              <strong>{t('data.persistTitle')}</strong>
              <p className="setting-desc">{persisted === true ? t('data.persistOn') : persisted === false ? t('data.persistOff') : t('data.persistUnknown')}</p>
            </div>
            {persisted !== true && (
              <button type="button" className="btn" onClick={() => void persist()} disabled={busy !== null}>
                <ShieldCheckIcon />
                {t('data.persistRequest')}
              </button>
            )}
          </div>
          <div className="setting-row">
            <div>
              <strong>{t('backup.fileTitle')}</strong>
              <p className="setting-desc">{t('backup.fileHint')}</p>
              <p className={`setting-desc${lastBackup ? '' : ' setting-warn'}`}>{lastBackup ? t('backup.last', { date: formatDateTime(lastBackup) }) : t('backup.never')}</p>
            </div>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => void exportBackup()} disabled={busy !== null}>
                <DownloadSimpleIcon />
                {t('backup.export')}
              </button>
              <BackupImport />
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>{t('backup.driveTitle')}</strong>
              <p className="setting-desc">{hasGoogle ? t('backup.driveHint', { folder: driveFolderLabel(settings, 'backup') }) : t('google.needClientId')}</p>
            </div>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => void toDrive()} disabled={!hasGoogle || busy !== null}>
                <CloudArrowUpIcon />
                {busy === 'drive-backup' ? t('common.working') : t('backup.toDrive')}
              </button>
              <button type="button" className="btn" onClick={() => void fromDrive()} disabled={!hasGoogle || busy !== null}>
                <CloudArrowDownIcon />
                {busy === 'drive-restore' ? t('common.working') : t('backup.fromDrive')}
              </button>
            </div>
          </div>
        </Section>

        <ExportSection />

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
          <p className="notice notice-info">{t('about.notLegalAdvice')}</p>
          <p className="link-row">
            <a href={LEGAL_DOC_URL} target="_blank" rel="noreferrer" className="ext-link">
              {t('about.legalLink')}
              <ArrowSquareOutIcon size={14} />
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="ext-link">
              {t('about.source')}
              <ArrowSquareOutIcon size={14} />
            </a>
          </p>
        </Section>
      </div>
      {driveBackup && <ImportBackupDialog backup={driveBackup} onClose={() => setDriveBackup(null)} />}
    </div>
  )
}
