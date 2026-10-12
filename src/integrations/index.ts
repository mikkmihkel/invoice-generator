// OWNER: integrations agent. Google Drive / Gmail via Google Identity Services (token model, no backend),
// plus Web Share API and mailto fallbacks.
export interface EmailDraft {
  to: string[]
  cc?: string[]
  subject: string
  body: string
  attachments: { fileName: string; blob: Blob }[]
}

export interface GoogleStatus {
  configured: boolean
  signedIn: boolean
  email?: string
}

export function getGoogleStatus(): GoogleStatus {
  throw new Error('not implemented')
}
/** Load GIS script on demand and request an access token with the given scopes (incremental consent). */
export async function googleSignIn(_clientId: string, _scopes: ('drive' | 'gmail')[]): Promise<GoogleStatus> {
  throw new Error('not implemented')
}
export async function googleSignOut(): Promise<void> {
  throw new Error('not implemented')
}

/** Upload a file to Drive (scope drive.file) into folder `folderName` (created if missing). Returns webViewLink. */
export async function uploadToDrive(_clientId: string, _file: Blob, _fileName: string, _folderName: string): Promise<{ id: string; webViewLink: string }> {
  throw new Error('not implemented')
}

/** Send email with attachments through Gmail API (scope gmail.send). */
export async function sendViaGmail(_clientId: string, _draft: EmailDraft): Promise<void> {
  throw new Error('not implemented')
}

/** True if navigator.canShare({files}) is supported for these files. */
export function canShareFiles(_files: File[]): boolean {
  throw new Error('not implemented')
}
/** Web Share API with the PDF attached (opens native mail/share sheet). */
export async function shareFiles(_draft: EmailDraft): Promise<void> {
  throw new Error('not implemented')
}
/** mailto: URL (no attachments possible — UI downloads the PDF first and tells the user to attach it). */
export function buildMailtoUrl(_draft: Omit<EmailDraft, 'attachments'>): string {
  throw new Error('not implemented')
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(_blob: Blob, _fileName: string): void {
  throw new Error('not implemented')
}

/** Backup JSON to Drive appDataFolder-free location (drive.file) as "invoice-generator-backup.json" (overwrite). */
export async function backupToDrive(_clientId: string, _json: string, _folderName: string): Promise<{ id: string; modifiedTime: string }> {
  throw new Error('not implemented')
}
/** Fetch the latest backup JSON previously written by backupToDrive, or null. */
export async function restoreFromDrive(_clientId: string, _folderName: string): Promise<string | null> {
  throw new Error('not implemented')
}
