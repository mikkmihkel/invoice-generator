// Which Google OAuth client the app uses, what it may ask for, and where in Drive files go.
//
// The published site has one shared client built in (VITE_GOOGLE_CLIENT_ID, plus an API key and app ID for the
// Google Picker). It asks only for non-sensitive scopes (openid, email, drive.file). A user may paste their own
// client ID in Settings ("advanced"); it overrides the built-in one and is the only way to send mail through Gmail
// (gmail.send is a sensitive scope that the shared client never requests).
import type { AppSettings, DriveFolderChoice } from '../domain'
import type { DriveFolderRef } from './drive'
import type { GoogleScope } from './googleAuth'

export interface BuiltInGoogleConfig {
  clientId?: string
  /** Browser API key for the Picker. */
  apiKey?: string
  /** Cloud project number of the client (the Picker's app ID). */
  appId?: string
}

const clean = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** The build-time configuration (read on every call, so tests can stub the environment). */
export function builtInGoogleConfig(): BuiltInGoogleConfig {
  const env = import.meta.env
  return { clientId: clean(env.VITE_GOOGLE_CLIENT_ID), apiKey: clean(env.VITE_GOOGLE_API_KEY), appId: clean(env.VITE_GOOGLE_APP_ID) }
}

type ClientSettings = Pick<AppSettings, 'googleClientId'>

/** The user's own client ID from Settings, unless it is just the built-in one pasted again. */
export function ownClientId(settings: ClientSettings): string | undefined {
  const own = clean(settings.googleClientId)
  return own && own !== builtInGoogleConfig().clientId ? own : undefined
}

/** The client ID to use: the user's own one, otherwise the built-in one; undefined when neither exists. */
export function effectiveClientId(settings: ClientSettings): string | undefined {
  return clean(settings.googleClientId) ?? builtInGoogleConfig().clientId
}

/** Whether the shared client of the site is in use (no override). */
export function usesBuiltInClient(settings: ClientSettings): boolean {
  return !clean(settings.googleClientId) && !!builtInGoogleConfig().clientId
}

/** Whether `clientId` is the site's shared client (which must never request gmail.send). */
export function isBuiltInClientId(clientId: string | undefined): boolean {
  const id = clean(clientId)
  return !!id && id === builtInGoogleConfig().clientId
}

/** Scopes the current client may request: Gmail only with the user's own client. */
export function availableScopes(settings: ClientSettings): GoogleScope[] {
  if (!effectiveClientId(settings)) return []
  return ownClientId(settings) ? ['drive', 'gmail'] : ['drive']
}

/** Whether "Send with Gmail" is offered. */
export function canSendWithGmail(settings: ClientSettings): boolean {
  return availableScopes(settings).includes('gmail')
}

/**
 * API key and app ID for the Google Picker, or null when the folder must be chosen without it (no key configured,
 * or the user's own client, whose project the built-in key and app ID do not belong to).
 */
export function pickerConfig(settings: ClientSettings): { apiKey: string; appId: string } | null {
  const b = builtInGoogleConfig()
  // The client in use decides, so the built-in ID pasted into Settings still gets the Picker.
  if (!isBuiltInClientId(effectiveClientId(settings)) || !b.apiKey || !b.appId) return null
  return { apiKey: b.apiKey, appId: b.appId }
}

// ---------- Drive folders ----------

/** The folder the app creates when the Picker is not available. */
export const DRIVE_APP_FOLDER_NAME = 'Arveldaja'
/** Subfolder of the chosen folder for invoice PDFs (fixed Estonian name). */
export const DRIVE_PDF_SUBFOLDER = 'Arved'
/** Subfolder of the chosen folder for backups (fixed Estonian name). */
export const DRIVE_BACKUP_SUBFOLDER = 'Varukoopiad'

type FolderSettings = Pick<AppSettings, 'driveFolder' | 'driveFolderName' | 'googleClientId'>
export type DriveFileKind = 'pdf' | 'backup'

/**
 * The chosen Drive folder, if it was chosen with the client now in use. The app may only open it through that
 * client (drive.file access is per client), so with another client (or none recorded) it counts as not chosen.
 */
export function chosenDriveFolder(settings: Pick<AppSettings, 'driveFolder' | 'googleClientId'>): DriveFolderChoice | undefined {
  const folder = settings.driveFolder
  const clientId = effectiveClientId(settings)
  return folder?.id && clientId && folder.clientId === clientId ? folder : undefined
}

/** Where PDFs or backups go: a subfolder of the chosen folder, or the folder named in settings (earlier versions). */
export function driveFolderRef(settings: FolderSettings, kind: DriveFileKind): DriveFolderRef {
  const chosen = chosenDriveFolder(settings)
  if (chosen) return { parentId: chosen.id, name: kind === 'pdf' ? DRIVE_PDF_SUBFOLDER : DRIVE_BACKUP_SUBFOLDER }
  return settings.driveFolderName?.trim() || DRIVE_PDF_SUBFOLDER
}

/** Human-readable location, e.g. "Arveldaja / Arved", or the legacy folder name. */
export function driveFolderLabel(settings: FolderSettings, kind: DriveFileKind): string {
  const ref = driveFolderRef(settings, kind)
  return typeof ref === 'string' ? ref : `${chosenDriveFolder(settings)!.name} / ${ref.name}`
}

/** Link to a folder in the Drive web app. */
export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`
}

/** Whether issued invoices' PDFs are uploaded automatically (a chosen folder and the option not switched off). */
export function autoSavePdfEnabled(settings: Pick<AppSettings, 'driveFolder' | 'autoSavePdf' | 'googleClientId'>): boolean {
  return !!chosenDriveFolder(settings) && settings.autoSavePdf !== false
}
