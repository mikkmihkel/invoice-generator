// Backups to offer for a restore: the current backup folder and, once a folder has been chosen, also the folder
// named in the settings of earlier versions (default "Arved"), where older backups stay.
import type { AppSettings } from '../domain'
import { findDriveFolders, listDriveBackups, listDriveBackupsIn, type DriveBackupFile, type DriveCallOptions } from './drive'
import { chosenDriveFolder, driveFolderLabel, driveFolderRef, DRIVE_PDF_SUBFOLDER } from './googleClient'

type Settings = Pick<AppSettings, 'driveFolder' | 'driveFolderName' | 'googleClientId'>

const time = (f: DriveBackupFile) => f.createdTime ?? f.modifiedTime ?? ''

/**
 * Backups in the backup folder and, when a folder is chosen, in the name-based folder used before (never created
 * here; the chosen folder's own subfolders are skipped). Newest first; with backups from both places, each one
 * carries its `location`. A failure to read the old folder only leaves its backups out.
 */
export async function listRestorableBackups(clientId: string, settings: Settings, options?: DriveCallOptions): Promise<DriveBackupFile[]> {
  const current = listDriveBackups(clientId, driveFolderRef(settings, 'backup'), options)
  const chosen = chosenDriveFolder(settings)
  if (!chosen) return current
  const legacyName = settings.driveFolderName?.trim() || DRIVE_PDF_SUBFOLDER
  const legacy = (async () => {
    const folders = (await findDriveFolders(clientId, legacyName, options)).filter((f) => !f.parents.includes(chosen.id))
    const lists = await Promise.all(folders.map((f) => listDriveBackupsIn(clientId, f.id, options)))
    return lists.flat()
  })().catch((e: unknown) => {
    console.warn('Could not list backups of the earlier Drive folder', e)
    return [] as DriveBackupFile[]
  })
  const [main, old] = await Promise.all([current, legacy])
  if (old.length === 0) return main
  const here = driveFolderLabel(settings, 'backup')
  const seen = new Set<string>()
  return [...main.map((f) => ({ ...f, location: here })), ...old.map((f) => ({ ...f, location: legacyName }))]
    .filter((f) => !seen.has(f.id) && seen.add(f.id))
    .sort((a, b) => (time(a) < time(b) ? 1 : time(a) > time(b) ? -1 : 0))
}
