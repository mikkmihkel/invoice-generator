import { CheckCircleIcon, CircleIcon, CloudArrowDownIcon, CloudArrowUpIcon, KeyIcon } from '@phosphor-icons/react'
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { AutoBackupSettings, BackupFile } from '../../../domain'
import {
  getAutoBackupStatus,
  getBackupPassphrase,
  getPlaintextVersionCount,
  hasBackupPassphrase,
  normalizeAutoBackup,
  parseAutoBackupFileName,
  preferredRestoreFile,
  setBackupPassphrase,
  subscribeAutoBackupStatus,
  subscribeBackupPassphrase,
  subscribePlaintextVersionCount,
  trashPlaintextVersions,
  KEEP_VERSIONS_MAX,
  KEEP_VERSIONS_MIN,
} from '../../../integrations/autoBackup'
import { decryptText, isEncryptedEnvelope } from '../../../integrations/backupCrypto'
import { downloadDriveFile, type DriveBackupFile } from '../../../integrations/drive'
import { listRestorableBackups } from '../../../integrations/restoreList'
import { googleSignIn, hasAccessToken } from '../../../integrations/googleAuth'
import { driveFolderLabel, driveFolderRef, effectiveClientId } from '../../../integrations/googleClient'
import { useApp } from '../../AppContext'
import { Dialog, useConfirm } from '../../components/Dialog'
import { CheckboxField, NumberField, TextField } from '../../components/fields'
import { Section } from '../../components/misc'
import { formatDateTime } from '../../format'
import { useToast } from '../../Toasts'
import { performAutoBackup, type BackupContext } from '../../useAutoBackup'
import { errorMessage } from '../../util'
import { readBackupText } from '../backupReview'
import { ImportBackupDialog } from '../SettingsPage'

const MIN_PASSPHRASE = 8

/** Asks for the backup encryption passphrase twice. It is kept in memory only (see setBackupPassphrase). */
export function PassphraseDialog({ mode, onSubmit, onClose }: { mode: 'new' | 'session'; onSubmit: (passphrase: string) => void; onClose: () => void }) {
  const { t } = useApp()
  const [value, setValue] = useState('')
  const [repeat, setRepeat] = useState('')
  const [tried, setTried] = useState(false)
  const tooShort = value.length < MIN_PASSPHRASE
  const mismatch = !tooShort && value !== repeat

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    setTried(true)
    if (!tooShort && !mismatch) onSubmit(value)
  }
  const autoComplete = mode === 'new' ? 'new-password' : 'current-password'

  return (
    <Dialog
      title={t(mode === 'new' ? 'autoBackup.passTitleNew' : 'autoBackup.passTitleSession')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {mode === 'new' ? t('common.cancel') : t('autoBackup.passLater')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => submit()}>
            {t('autoBackup.passConfirm')}
          </button>
        </>
      }
    >
      <form className="stack-sm" onSubmit={submit} noValidate>
        <p>{t(mode === 'new' ? 'autoBackup.passIntroNew' : 'autoBackup.passIntroSession')}</p>
        <p className="notice notice-warn">{t('autoBackup.passWarn')}</p>
        <TextField
          type="password"
          label={t('autoBackup.passphrase')}
          value={value}
          onChange={setValue}
          autoComplete={autoComplete}
          error={tried && tooShort ? t('autoBackup.passTooShort') : undefined}
          data-autofocus
        />
        <TextField
          type="password"
          label={t('autoBackup.passphraseRepeat')}
          value={repeat}
          onChange={setRepeat}
          autoComplete={autoComplete}
          error={tried && mismatch ? t('autoBackup.passMismatch') : undefined}
        />
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

function backupLabel(f: DriveBackupFile): string {
  return formatDateTime(f.createdTime ?? f.modifiedTime ?? parseAutoBackupFileName(f.name)?.date.toISOString())
}

/**
 * Pick a Drive backup, decrypt it if needed and hand the parsed backup to the usual import review. `title`, `intro`
 * and `cancelLabel` adapt it for the offer after signing in on a new computer.
 */
export function RestoreDialog({
  files,
  clientId,
  onClose,
  onBackup,
  title,
  intro,
  cancelLabel,
}: {
  files: DriveBackupFile[]
  clientId: string
  onClose: () => void
  onBackup: (backup: BackupFile) => void
  title?: string
  intro?: string
  cancelLabel?: string
}) {
  const { t, lang } = useApp()
  const [selected, setSelected] = useState(() => preferredRestoreFile(files)?.id ?? '')
  const [passphrase, setPassphrase] = useState(() => getBackupPassphrase() ?? '')
  const [busy, setBusy] = useState<'download' | 'decrypt' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const file = files.find((f) => f.id === selected)
  const sizeFormat = new Intl.NumberFormat(lang === 'et' ? 'et-EE' : 'en-GB', { maximumFractionDigits: 1 })
  const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${sizeFormat.format(bytes / 1024 / 1024)} MB` : `${sizeFormat.format(Math.max(0.1, bytes / 1024))} kB`)

  const restore = async () => {
    if (!file) return
    setError(null)
    setBusy('download')
    try {
      let text = await downloadDriveFile(clientId, file.id)
      if (isEncryptedEnvelope(text)) {
        setBusy('decrypt')
        text = await decryptText(text, passphrase)
      }
      const res = readBackupText(text, lang)
      if ('error' in res) {
        setError(t('backup.invalidReason', { reason: res.error }))
        setBusy(null)
        return
      }
      onBackup(res.backup)
    } catch (e) {
      setError(errorMessage(e, lang))
      setBusy(null)
    }
  }

  return (
    <Dialog
      title={title ?? t('autoBackup.restoreTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      dismissible={busy === null}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy !== null}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void restore()} disabled={!file || busy !== null || (file.encrypted && !passphrase)}>
            {busy === 'decrypt' ? t('autoBackup.decrypting') : busy ? t('common.working') : t('autoBackup.restoreContinue')}
          </button>
        </>
      }
    >
      <p>{intro ?? t('autoBackup.restoreIntro')}</p>
      <fieldset className="template-picker" disabled={busy !== null}>
        <legend className="visually-hidden">{t('autoBackup.restoreList')}</legend>
        <div className="template-list">
          {files.map((f) => {
            const details = [
              f.issued !== undefined ? t('autoBackup.issuedCount', { n: f.issued }) : '',
              f.size != null ? size(f.size) : '',
              f.encrypted ? t('autoBackup.encrypted') : '',
              f.automatic ? '' : t('autoBackup.manualFile'),
              f.location ? t('autoBackup.inFolder', { folder: f.location }) : '',
            ].filter(Boolean)
            return (
              <label key={f.id} className={`template-option${selected === f.id ? ' selected' : ''}`}>
                <input type="radio" name="drive-backup" value={f.id} checked={selected === f.id} onChange={() => setSelected(f.id)} />
                <span className="tpl-text">
                  <span className="tpl-name">{backupLabel(f) || f.name}</span>
                  {details.length > 0 && <span className="tpl-desc">{details.join(' · ')}</span>}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>
      {file?.encrypted && (
        <TextField type="password" label={t('autoBackup.restorePassphrase')} value={passphrase} onChange={setPassphrase} autoComplete="current-password" disabled={busy !== null} />
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}

/** Scroll to the Google section on the same settings page and focus its first field (the OAuth client ID). */
function showGoogleSettings() {
  const section = document.getElementById('set-google')
  section?.scrollIntoView?.({ block: 'start' })
  section?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
}

/** Settings: automatic versioned backups to the app's Google Drive folder, optional encryption, restore. */
export function BackupSection() {
  const { t, settings, saveSettings, repo } = useApp()
  const toast = useToast()
  const status = useSyncExternalStore(subscribeAutoBackupStatus, getAutoBackupStatus)
  const hasPassphrase = useSyncExternalStore(subscribeBackupPassphrase, hasBackupPassphrase)
  const plaintextLeft = useSyncExternalStore(subscribePlaintextVersionCount, getPlaintextVersionCount)
  const confirm = useConfirm()
  const cfg = normalizeAutoBackup(settings.autoBackup)
  const clientId = effectiveClientId(settings)
  const [busy, setBusy] = useState<'backup' | 'restore' | 'trash' | null>(null)
  const [askPassphrase, setAskPassphrase] = useState<{ mode: 'new' | 'session'; then: (passphrase: string) => void } | null>(null)
  const [restoreFiles, setRestoreFiles] = useState<DriveBackupFile[] | null>(null)
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null)

  const settingsRef = useRef(settings)
  // Layout effect: a click right after the settings change must already see them.
  useLayoutEffect(() => {
    settingsRef.current = settings
  }, [settings])
  const ctx: BackupContext = { repo, getSettings: () => settingsRef.current, saveSettings }

  const update = (patch: Partial<AutoBackupSettings>) => saveSettings({ autoBackup: { ...normalizeAutoBackup(settingsRef.current.autoBackup), ...patch } })

  const withBusy = async (key: 'backup' | 'restore' | 'trash', fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const toggleEnabled = async (enabled: boolean) => {
    // Connect right away (this is a click) so the first backup does not have to wait.
    const signIn = enabled && clientId && !hasAccessToken(clientId, ['drive']) ? googleSignIn(clientId, ['drive']).then(() => null, (e: unknown) => e) : null
    try {
      await update({ enabled })
    } catch (e) {
      toast.error(errorMessage(e))
    }
    const signInError = await signIn
    if (signInError) toast.error(errorMessage(signInError))
  }

  const toggleEncrypt = (encrypt: boolean) => {
    if (!encrypt) {
      setBackupPassphrase(null)
      void update({ encrypt: false })
      return
    }
    setAskPassphrase({
      mode: 'new',
      then: (passphrase) => {
        setBackupPassphrase(passphrase)
        void update({ encrypt: true })
      },
    })
  }

  const backupNow = () => {
    if (!clientId) return
    const run = () =>
      withBusy('backup', async () => {
        await googleSignIn(clientId, ['drive'])
        const res = await performAutoBackup(ctx, true)
        if (res.kind === 'uploaded') toast.success(t('autoBackup.saved', { time: formatDateTime(res.at) }))
        else if (res.kind === 'error') toast.error(errorMessage(res.error))
      })
    if (cfg.encrypt && !hasBackupPassphrase()) {
      setAskPassphrase({
        mode: 'session',
        then: (passphrase) => {
          setBackupPassphrase(passphrase)
          void run()
        },
      })
    } else void run()
  }

  const restore = () =>
    withBusy('restore', async () => {
      if (!clientId) return
      await googleSignIn(clientId, ['drive'])
      const files = await listRestorableBackups(clientId, settingsRef.current)
      if (files.length === 0) toast.info(t('backup.driveNone'))
      else setRestoreFiles(files)
    })

  const backupAnyway = async () => {
    const ok = await confirm({
      title: t('autoBackup.anywayTitle'),
      message: t('autoBackup.anywayText'),
      confirmLabel: t('autoBackup.anywayConfirm'),
      cancelLabel: t('common.cancel'),
    })
    if (ok) backupNow()
  }

  const trashPlaintext = async () => {
    if (!clientId) return
    const ok = await confirm({
      title: t('autoBackup.plaintextTitle'),
      message: t('autoBackup.plaintextText'),
      confirmLabel: t('autoBackup.plaintextConfirm'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok) return
    await withBusy('trash', async () => {
      await googleSignIn(clientId, ['drive'])
      const n = await trashPlaintextVersions(clientId, driveFolderRef(settingsRef.current, 'backup'))
      toast.success(t('autoBackup.plaintextDone', { n }))
    })
  }

  const disabled = !clientId || busy !== null
  const running = status.phase === 'running' || busy === 'backup'
  const hold = cfg.enabled && status.phase === 'pending' && status.reason === 'held' ? status.hold : undefined

  return (
    <Section id="set-autobackup" title={t('autoBackup.title')} description={t('autoBackup.intro')}>
      {!clientId && (
        <p className="notice notice-info">
          {t('autoBackup.needClientId')}{' '}
          <button type="button" className="link-btn" onClick={showGoogleSettings}>
            {t('autoBackup.toGoogleSettings')}
          </button>
        </p>
      )}
      <CheckboxField
        label={t('autoBackup.enable')}
        hint={t('autoBackup.enableHint', { folder: driveFolderLabel(settings, 'backup') })}
        checked={cfg.enabled}
        onChange={(v) => void toggleEnabled(v)}
        disabled={!clientId}
      />
      <div className="grid">
        <NumberField
          label={t('autoBackup.keep')}
          suffix={t('autoBackup.keepSuffix')}
          hint={t('autoBackup.keepDeviceHint')}
          value={cfg.keepVersions}
          inputMode="numeric"
          onChange={(v) => {
            if (v == null) return
            const keepVersions = Math.min(KEEP_VERSIONS_MAX, Math.max(KEEP_VERSIONS_MIN, Math.round(v)))
            if (keepVersions !== cfg.keepVersions) void update({ keepVersions })
          }}
          disabled={!clientId}
        />
      </div>
      <CheckboxField label={t('autoBackup.encrypt')} hint={`${t('autoBackup.encryptHint')} ${t('autoBackup.passWarn')}`} checked={cfg.encrypt} onChange={toggleEncrypt} disabled={!clientId} />
      {cfg.encrypt && (
        <div className="btn-row">
          <p className={`status-line${hasPassphrase ? ' status-ok' : ''}`}>
            {hasPassphrase ? <CheckCircleIcon /> : <CircleIcon />}
            {hasPassphrase ? t('autoBackup.passphraseSet') : t('autoBackup.passphraseMissing')}
          </p>
          {!hasPassphrase && (
            <button type="button" className="btn btn-sm" onClick={() => setAskPassphrase({ mode: 'session', then: (p) => setBackupPassphrase(p) })}>
              <KeyIcon />
              {t('autoBackup.enterPassphrase')}
            </button>
          )}
        </div>
      )}
      <p className="status-line" aria-live="polite">
        {running ? t('autoBackup.running') : cfg.lastBackupAt ? t('autoBackup.last', { date: formatDateTime(cfg.lastBackupAt) }) : cfg.enabled ? t('autoBackup.never') : t('autoBackup.off')}
      </p>
      {cfg.enabled && status.phase === 'pending' && status.reason !== 'held' && (
        <p className="notice notice-warn">{t(status.reason === 'passphrase' ? 'autoBackup.pendingPassphrase' : 'autoBackup.pendingSignin')}</p>
      )}
      {hold && (
        <div className="notice notice-warn stack-sm" role="status">
          <p>{hold.existing !== undefined ? t('autoBackup.heldFewer', { existing: hold.existing, local: hold.local }) : t('autoBackup.heldEmpty')}</p>
          <div className="btn-row">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void restore()} disabled={disabled}>
              <CloudArrowDownIcon />
              {t('autoBackup.heldRestore')}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void backupAnyway()} disabled={disabled}>
              <CloudArrowUpIcon />
              {t('autoBackup.heldBackupAnyway')}
            </button>
          </div>
        </div>
      )}
      {cfg.encrypt && plaintextLeft > 0 && (
        <div className="notice notice-info stack-sm">
          <p>{t('autoBackup.plaintextLeft', { n: plaintextLeft })}</p>
          <div className="btn-row">
            <button type="button" className="btn btn-sm" onClick={() => void trashPlaintext()} disabled={disabled}>
              {busy === 'trash' ? t('common.working') : t('autoBackup.plaintextTrash')}
            </button>
          </div>
        </div>
      )}
      {status.phase === 'error' && (
        <p className="notice notice-error" role="alert">
          {t('autoBackup.failed', { reason: errorMessage(status.error) })}
        </p>
      )}
      <div className="btn-row">
        <button type="button" className="btn" onClick={backupNow} disabled={disabled}>
          <CloudArrowUpIcon />
          {busy === 'backup' ? t('common.working') : t('autoBackup.backupNow')}
        </button>
        <button type="button" className="btn" onClick={() => void restore()} disabled={disabled}>
          <CloudArrowDownIcon />
          {busy === 'restore' ? t('common.working') : t('autoBackup.restore')}
        </button>
      </div>

      {askPassphrase && (
        <PassphraseDialog
          mode={askPassphrase.mode}
          onClose={() => setAskPassphrase(null)}
          onSubmit={(p) => {
            setAskPassphrase(null)
            askPassphrase.then(p)
          }}
        />
      )}
      {restoreFiles && clientId && (
        <RestoreDialog
          files={restoreFiles}
          clientId={clientId}
          onClose={() => setRestoreFiles(null)}
          onBackup={(backup) => {
            setRestoreFiles(null)
            setPendingImport(backup)
          }}
        />
      )}
      {pendingImport && <ImportBackupDialog backup={pendingImport} onClose={() => setPendingImport(null)} />}
    </Section>
  )
}
