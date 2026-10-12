// Google Drive REST v3 with the non-sensitive drive.file scope: the app only sees files/folders it created.
import { googleFetch } from './http'

const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const DRIVE_BACKUP_FILE_NAME = 'invoice-generator-backup.json'

interface DriveFile {
  id: string
  name?: string
  webViewLink?: string
  modifiedTime?: string
}

/** Escape a value for a Drive `q` string literal. */
export function driveQueryString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

async function findFile(clientId: string, q: string, fields = 'id,name,webViewLink,modifiedTime'): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    q,
    spaces: 'drive',
    fields: `files(${fields})`,
    orderBy: 'modifiedTime desc',
    pageSize: '1',
  })
  const res = await googleFetch(clientId, ['drive'], `${API}?${params}`)
  const data = (await res.json()) as { files?: DriveFile[] }
  return data.files?.[0] ?? null
}

/** Find (or, unless `create` is false, create) a folder with this name in the user's Drive. */
export async function findOrCreateFolder(clientId: string, folderName: string, create = true): Promise<string | null> {
  // Not cached on purpose: the user may trash/rename the folder at any time.
  const name = folderName.trim() || 'Arved'
  const found = await findFile(clientId, `mimeType=${driveQueryString(FOLDER_MIME)} and name=${driveQueryString(name)} and trashed=false`, 'id,name')
  let id = found?.id ?? null
  if (!id && create) {
    const res = await googleFetch(clientId, ['drive'], `${API}?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    })
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

async function createFile(clientId: string, folderId: string, name: string, content: Blob | string, mime: string, fields: string) {
  const { body, contentType } = buildDriveMultipart({ name, mimeType: mime, parents: [folderId] }, content, mime)
  const res = await googleFetch(clientId, ['drive'], `${UPLOAD_API}?uploadType=multipart&fields=${fields}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  })
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

/** Backup JSON to Drive (drive.file) as "invoice-generator-backup.json" in the folder (overwrite). */
export async function backupToDrive(clientId: string, json: string, folderName: string): Promise<{ id: string; modifiedTime: string }> {
  const fields = 'id,modifiedTime'
  const mime = 'application/json'
  const result = await withFolder(clientId, folderName, async (folderId) => {
    const existing = await findFile(clientId, `name=${driveQueryString(DRIVE_BACKUP_FILE_NAME)} and ${driveQueryString(folderId)} in parents and trashed=false`, 'id')
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
  const file = await findFile(clientId, `name=${driveQueryString(DRIVE_BACKUP_FILE_NAME)} and ${driveQueryString(folderId)} in parents and trashed=false`, 'id')
  if (!file) return null
  const res = await googleFetch(clientId, ['drive'], `${API}/${encodeURIComponent(file.id)}?alt=media`)
  return res.text()
}
