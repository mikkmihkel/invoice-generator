import { FolderPlusIcon, FolderOpenIcon } from '@phosphor-icons/react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppSettings, BackupFile, DriveFolderChoice } from '../../domain'
// Submodules rather than the integrations barrel: UI tests replace the barrel with a small mock.
import { normalizeAutoBackup } from '../../integrations/autoBackup'
import { findOrCreateAppFolder, listDriveBackups, type DriveBackupFile } from '../../integrations/drive'
import { getAccessToken, googleSignIn } from '../../integrations/googleAuth'
import {
  availableScopes,
  chosenDriveFolder,
  DRIVE_APP_FOLDER_NAME,
  DRIVE_BACKUP_SUBFOLDER,
  DRIVE_PDF_SUBFOLDER,
  driveFolderRef,
  driveFolderUrl,
  effectiveClientId,
  pickerConfig,
} from '../../integrations/googleClient'
import { pickDriveFolder } from '../../integrations/picker'
import { useApp } from '../AppContext'
import { Dialog } from '../components/Dialog'
import { RestoreDialog } from '../pages/settings/BackupSection'
import { ImportBackupDialog } from '../pages/SettingsPage'
import { useToast } from '../Toasts'
import { errorMessage } from '../util'

import { DriveConnectContext, type ConnectResult, type DriveConnectApi } from './driveConnectContext'

type Phase =
  | null
  | { kind: 'folder'; pickerFailed?: boolean }
  | { kind: 'picking' }
  | { kind: 'restore'; files: DriveBackupFile[]; clientId: string }
  | { kind: 'import'; backup: BackupFile }

/** Hosts the connect flow and its dialogs above the routes, so they survive the onboarding → app switch. */
export function DriveConnectProvider({ children }: { children: ReactNode }) {
  const { t, settings, saveSettings, invoices, clients, lang } = useApp()
  const toast = useToast()
  const [phase, setPhase] = useState<Phase>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const latest = useRef({ settings, empty: true })
  // Layout effect: a click right after a settings change must already see it.
  useLayoutEffect(() => {
    latest.current = { settings, empty: invoices.length === 0 && clients.length === 0 }
  }, [settings, invoices.length, clients.length])
  const done = useRef<((r: ConnectResult) => void) | null>(null)

  const finish = useCallback((result: ConnectResult) => {
    setPhase(null)
    const resolve = done.current
    done.current = null
    resolve?.(result)
  }, [])

  /** After sign-in and folder choice: on an empty app, look for backups in the folder and offer a restore. */
  const offerRestore = useCallback(
    async (s: AppSettings) => {
      const clientId = effectiveClientId(s)
      if (!clientId || !latest.current.empty) return finish('connected')
      let files: DriveBackupFile[] = []
      try {
        files = await listDriveBackups(clientId, driveFolderRef(s, 'backup'))
      } catch (e) {
        // Not finding backups must not spoil the sign-in; restore stays available in Settings.
        console.warn('Could not list Drive backups', e)
      }
      if (files.length > 0) setPhase({ kind: 'restore', files, clientId })
      else finish('connected')
    },
    [finish],
  )

  const adoptFolder = useCallback(
    async (folder: DriveFolderChoice, message: string) => {
      const s = latest.current.settings
      const patch: Partial<AppSettings> = { driveFolder: { id: folder.id, name: folder.name, clientId: effectiveClientId(s) } }
      // Signed in with a folder: automatic backup is on unless the user decided about it before.
      if (!s.autoBackup) patch.autoBackup = { ...normalizeAutoBackup(undefined), enabled: true }
      await saveSettings(patch)
      toast.success(message, { label: t('gdrive.openInDrive'), href: driveFolderUrl(folder.id) })
      await offerRestore({ ...s, ...patch })
    },
    [saveSettings, toast, t, offerRestore],
  )

  const connect = useCallback(
    async (options: { chooseFolder?: boolean } = {}): Promise<ConnectResult> => {
      const s = latest.current.settings
      const clientId = effectiveClientId(s)
      if (!clientId || done.current) return 'failed'
      setBusy(true)
      try {
        await googleSignIn(clientId, availableScopes(s))
      } catch (e) {
        toast.error(errorMessage(e))
        return 'failed'
      } finally {
        setBusy(false)
      }
      return new Promise<ConnectResult>((resolve) => {
        done.current = resolve
        if (options.chooseFolder || !chosenDriveFolder(s)) setPhase({ kind: 'folder' })
        else {
          toast.success(t('google.connected'))
          void offerRestore(s)
        }
      })
    },
    [toast, t, offerRestore],
  )

  const pick = async () => {
    const s = latest.current.settings
    const clientId = effectiveClientId(s)
    const cfg = pickerConfig(s)
    if (!clientId || !cfg) return
    // The picker is its own overlay: close ours meanwhile so nothing sits on top of it.
    setPhase({ kind: 'picking' })
    try {
      const accessToken = await getAccessToken(clientId, ['drive'])
      const folder = await pickDriveFolder({ accessToken, ...cfg, locale: lang, title: t('gdrive.pickerTitle') })
      if (!folder) setPhase({ kind: 'folder' })
      else await adoptFolder(folder, t('gdrive.folderChosen', { folder: folder.name }))
    } catch (e) {
      console.warn('Google Picker failed', e)
      setPhase({ kind: 'folder', pickerFailed: true })
    }
  }

  const create = async () => {
    const clientId = effectiveClientId(latest.current.settings)
    if (!clientId) return
    setCreating(true)
    try {
      const folder = await findOrCreateAppFolder(clientId, DRIVE_APP_FOLDER_NAME)
      await adoptFolder(folder, t(folder.created ? 'gdrive.folderCreated' : 'gdrive.folderFound', { folder: folder.name }))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setCreating(false)
    }
  }

  const api = useMemo<DriveConnectApi>(() => ({ connect, busy }), [connect, busy])
  const canPick = !!pickerConfig(settings)

  return (
    <DriveConnectContext.Provider value={api}>
      {children}
      {phase?.kind === 'folder' && (
        <Dialog
          title={t('gdrive.folderTitle')}
          onClose={() => finish('connected')}
          closeLabel={t('common.close')}
          dismissible={!creating}
          footer={
            <>
              <button type="button" className="btn" onClick={() => finish('connected')} disabled={creating}>
                {t('gdrive.later')}
              </button>
              <button type="button" className={`btn${canPick && !phase.pickerFailed ? '' : ' btn-primary'}`} onClick={() => void create()} disabled={creating}>
                <FolderPlusIcon />
                {creating ? t('common.working') : t('gdrive.createFolder', { name: DRIVE_APP_FOLDER_NAME })}
              </button>
              {canPick && !phase.pickerFailed && (
                <button type="button" className="btn btn-primary" onClick={() => void pick()} disabled={creating} data-autofocus>
                  <FolderOpenIcon />
                  {t('gdrive.pickFolder')}
                </button>
              )}
            </>
          }
        >
          <p>{t('gdrive.folderIntro', { pdf: DRIVE_PDF_SUBFOLDER, backup: DRIVE_BACKUP_SUBFOLDER })}</p>
          {phase.pickerFailed && (
            <p className="notice notice-warn" role="alert">
              {t('gdrive.pickerFailed', { name: DRIVE_APP_FOLDER_NAME })}
            </p>
          )}
          <p className="muted small">{t('gdrive.createFolderHint')}</p>
        </Dialog>
      )}
      {phase?.kind === 'picking' && (
        <p className="drive-picking" role="status">
          {t('gdrive.openingPicker')}
        </p>
      )}
      {phase?.kind === 'restore' && (
        <RestoreDialog
          files={phase.files}
          clientId={phase.clientId}
          title={t('gdrive.restoreTitle')}
          intro={t('gdrive.restoreIntro')}
          cancelLabel={t('gdrive.startEmpty')}
          onClose={() => finish('connected')}
          onBackup={(backup) => setPhase({ kind: 'import', backup })}
        />
      )}
      {phase?.kind === 'import' && <ImportBackupDialog backup={phase.backup} onClose={() => finish('connected')} />}
    </DriveConnectContext.Provider>
  )
}
