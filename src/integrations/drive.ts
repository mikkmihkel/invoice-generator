// Google Drive REST v3 with the non-sensitive drive.file scope: the app only sees files/folders it created.
import type { TokenOptions } from './googleAuth'
import { googleFetch } from './http'

const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const DRIVE_BACKUP_FILE_NAME = 'arveldaja-backup.json'
/** The manual backup file of earlier versions: still listed, restored and overwritten in place. */
export const LEGACY_DRIVE_BACKUP_FILE_NAME = 'invoice-generator-backup.json'

/** Drive query for the manual backup file (current or earlier name) in a folder. */
function manualBackupQuery(folderId: string): string {
  return `(name=${driveQueryString(DRIVE_BACKUP_FILE_NAME)} or name=${driveQueryString(LEGACY_DRIVE_BACKUP_FILE_NAME)}) and ${driveQueryString(folderId)} in parents and trashed=false`
}

interface DriveFile {
  id: string
  name?: string
  webViewLink?: string
  modifiedTime?: string
  createdTime?: string
  /** Bytes, as a decimal string. */
  size?: string
  appProperties?: Record<string, string>
}

/** Options for Drive calls; `interactive: false` for background work that must never open a popup. */
export type DriveCallOptions = TokenOptions

const drive = (clientId: string, url: string, init?: RequestInit, options?: DriveCallOptions) =>
  options ? googleFetch(clientId, ['drive'], url, init, options) : googleFetch(clientId, ['drive'], url, init)

/** Escape a value for a Drive `q` string literal. */
export function driveQueryString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

async function findFile(clientId: string, q: string, fields = 'id,name,webViewLink,modifiedTime', options?: DriveCallOptions): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    q,
    spaces: 'drive',
    fields: `files(${fields})`,
    orderBy: 'modifiedTime desc',
    pageSize: '1',
  })
  const res = await drive(clientId, `${API}?${params}`, undefined, options)
  const data = (await res.json()) as { files?: DriveFile[] }
  return data.files?.[0] ?? null
}

/** Find (or, unless `create` is false, create) a folder with this name in the user's Drive. */
export async function findOrCreateFolder(clientId: string, folderName: string, create = true, options?: DriveCallOptions): Promise<string | null> {
  // Not cached on purpose: the user may trash/rename the folder at any time.
  const name = folderName.trim() || 'Arved'
  const found = await findFile(clientId, `mimeType=${driveQueryString(FOLDER_MIME)} and name=${driveQueryString(name)} and trashed=false`, 'id,name', options)
  let id = found?.id ?? null
  if (!id && create) {
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    }
    const res = await drive(clientId, `${API}?fields=id`, init, options)
    id = ((await res.json()) as DriveFile).id
  }
  return id
}

function randomBoundary(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `invoice-generator-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** multipart/related body for `uploadType=multipart`: JSON metadata part + media part. */
export function buildDriveMultipart(metadata: object, content: Blob | string, contentType: string, boundary = randomBoundary()) {
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    content,
    `\r\n--${boundary}--\r\n`,
  ])
  return { body, contentType: `multipart/related; boundary=${boundary}` }
}

async function createFile(
  clientId: string,
  folderId: string,
  name: string,
  content: Blob | string,
  mime: string,
  fields: string,
  extra?: { appProperties?: Record<string, string> },
  options?: DriveCallOptions,
) {
  const { body, contentType } = buildDriveMultipart({ name, mimeType: mime, parents: [folderId], ...extra }, content, mime)
  const init = { method: 'POST', headers: { 'Content-Type': contentType }, body }
  const res = await drive(clientId, `${UPLOAD_API}?uploadType=multipart&fields=${fields}`, init, options)
  return (await res.json()) as DriveFile
}

async function updateFileContent(clientId: string, fileId: string, content: Blob | string, mime: string, fields: string) {
  const res = await googleFetch(clientId, ['drive'], `${UPLOAD_API}/${encodeURIComponent(fileId)}?uploadType=media&fields=${fields}`, {
    method: 'PATCH',
    headers: { 'Content-Type': mime },
    body: content,
  })
  return (await res.json()) as DriveFile
}

async function withFolder<T>(clientId: string, folderName: string, fn: (folderId: string) => Promise<T>): Promise<T> {
  return fn((await findOrCreateFolder(clientId, folderName))!)
}

export interface UploadOptions {
  /** If a file with the same name exists in the folder, replace its content instead of creating a duplicate. Default true. */
  overwrite?: boolean
}

/** Upload a file to Drive (scope drive.file) into folder `folderName` (created if missing). Returns webViewLink. */
export async function uploadToDrive(
  clientId: string,
  file: Blob,
  fileName: string,
  folderName: string,
  options: UploadOptions = {},
): Promise<{ id: string; webViewLink: string }> {
  const mime = file.type || 'application/pdf'
  const fields = 'id,webViewLink'
  const result = await withFolder(clientId, folderName, async (folderId) => {
    const existing =
      options.overwrite === false
        ? null
        : await findFile(clientId, `name=${driveQueryString(fileName)} and ${driveQueryString(folderId)} in parents and trashed=false`, 'id')
    return existing ? updateFileContent(clientId, existing.id, file, mime, fields) : createFile(clientId, folderId, fileName, file, mime, fields)
  })
  return { id: result.id, webViewLink: result.webViewLink ?? `https://drive.google.com/file/d/${result.id}/view` }
}

/**
 * Backup JSON to Drive (drive.file) as "arveldaja-backup.json" in the folder. Overwrites the existing manual backup
 * file, also one saved under the earlier name.
 */
export async function backupToDrive(clientId: string, json: string, folderName: string): Promise<{ id: string; modifiedTime: string }> {
  const fields = 'id,modifiedTime'
  const mime = 'application/json'
  const result = await withFolder(clientId, folderName, async (folderId) => {
    const existing = await findFile(clientId, manualBackupQuery(folderId), 'id')
    return existing
      ? updateFileContent(clientId, existing.id, json, mime, fields)
      : createFile(clientId, folderId, DRIVE_BACKUP_FILE_NAME, json, mime, fields)
  })
  return { id: result.id, modifiedTime: result.modifiedTime ?? new Date().toISOString() }
}

/** Fetch the latest backup JSON previously written by backupToDrive, or null. */
export async function restoreFromDrive(clientId: string, folderName: string): Promise<string | null> {
  const folderId = await findOrCreateFolder(clientId, folderName, false)
  if (!folderId) return null
  const file = await findFile(clientId, manualBackupQuery(folderId), 'id')
  if (!file) return null
  const res = await googleFetch(clientId, ['drive'], `${API}/${encodeURIComponent(file.id)}?alt=media`)
  return res.text()
}

/** appProperties key that marks the versioned backups this app uploads (value 'auto'). */
export const BACKUP_VERSION_PROPERTY = 'invoiceGeneratorBackup'
/** appProperties key with the id of the browser that uploaded a version. */
export const BACKUP_DEVICE_PROPERTY = 'device'
/** appProperties key with the number of issued documents in a version. */
export const BACKUP_ISSUED_PROPERTY = 'issued'

export interface DriveBackupFile {
  id: string
  name: string
  /** Bytes, when Drive reports it. */
  size?: number
  createdTime?: string
  modifiedTime?: string
  encrypted: boolean
  /** True for versioned backups uploaded by the automatic backup; false for the single manual backup file. */
  automatic: boolean
  /** Browser that uploaded the version (missing on older versions and the manual file). */
  device?: string
  /** Issued (non-draft) documents in the backup, when recorded at upload. */
  issued?: number
}

/** What uploadBackupVersion records about a version besides encryption. */
export interface BackupVersionTags {
  device?: string
  issued?: number
}

function toBackupFile(f: DriveFile): DriveBackupFile {
  const name = f.name ?? ''
  const size = f.size != null && /^\d+$/.test(f.size) ? Number(f.size) : undefined
  const props = f.appProperties ?? {}
  const out: DriveBackupFile = {
    id: f.id,
    name,
    size,
    createdTime: f.createdTime,
    modifiedTime: f.modifiedTime,
    encrypted: props.encrypted === '1' || name.endsWith('.enc'),
    automatic: props[BACKUP_VERSION_PROPERTY] === 'auto',
  }
  const device = props[BACKUP_DEVICE_PROPERTY]
  if (device) out.device = device
  const issued = props[BACKUP_ISSUED_PROPERTY]
  if (issued != null && /^\d{1,15}$/.test(issued)) out.issued = Number(issued)
  return out
}

const BACKUP_FIELDS = 'id,name,size,createdTime,modifiedTime,appProperties'

/** Upload a new backup version (never overwrites) into the folder, marked so it can be listed and pruned later. */
export async function uploadBackupVersion(
  clientId: string,
  folderName: string,
  fileName: string,
  content: string,
  encrypted: boolean,
  options?: DriveCallOptions,
  tags: BackupVersionTags = {},
): Promise<DriveBackupFile> {
  const folderId = (await findOrCreateFolder(clientId, folderName, true, options))!
  const appProperties: Record<string, string> = { [BACKUP_VERSION_PROPERTY]: 'auto', encrypted: encrypted ? '1' : '0' }
  if (tags.device) appProperties[BACKUP_DEVICE_PROPERTY] = tags.device
  if (tags.issued !== undefined) appProperties[BACKUP_ISSUED_PROPERTY] = String(tags.issued)
  const file = await createFile(clientId, folderId, fileName, content, 'application/json', BACKUP_FIELDS, { appProperties }, options)
  return toBackupFile({ name: fileName, appProperties, ...file })
}

const MAX_LIST_PAGES = 10

/**
 * Backups in the folder, newest first: the versioned automatic backups and the manual backup file.
 * Returns [] when the folder does not exist.
 */
export async function listDriveBackups(clientId: string, folderName: string, options?: DriveCallOptions): Promise<DriveBackupFile[]> {
  const folderId = await findOrCreateFolder(clientId, folderName, false, options)
  if (!folderId) return []
  const q =
    `${driveQueryString(folderId)} in parents and trashed=false and ` +
    `(appProperties has { key=${driveQueryString(BACKUP_VERSION_PROPERTY)} and value='auto' } or ` +
    `name=${driveQueryString(DRIVE_BACKUP_FILE_NAME)} or name=${driveQueryString(LEGACY_DRIVE_BACKUP_FILE_NAME)})`
  const out: DriveBackupFile[] = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const params = new URLSearchParams({ q, spaces: 'drive', fields: `nextPageToken,files(${BACKUP_FIELDS})`, orderBy: 'createdTime desc', pageSize: '100' })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await drive(clientId, `${API}?${params}`, undefined, options)
    const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string }
    out.push(...(data.files ?? []).map(toBackupFile))
    pageToken = data.nextPageToken
    if (!pageToken) break
  }
  const time = (f: DriveBackupFile) => f.createdTime ?? f.modifiedTime ?? ''
  return out.sort((a, b) => (time(a) < time(b) ? 1 : time(a) > time(b) ? -1 : 0))
}

/** Download a file's content as text. */
export async function downloadDriveFile(clientId: string, fileId: string, options?: DriveCallOptions): Promise<string> {
  const res = await drive(clientId, `${API}/${encodeURIComponent(fileId)}?alt=media`, undefined, options)
  return res.text()
}

/** Move a file to the Drive trash (Drive empties it after 30 days). */
export async function trashDriveFile(clientId: string, fileId: string, options?: DriveCallOptions): Promise<void> {
  const init = { method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ trashed: true }) }
  await drive(clientId, `${API}/${encodeURIComponent(fileId)}?fields=id`, init, options)
}
