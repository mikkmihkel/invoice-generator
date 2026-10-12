// OWNER: platform agent. Google Drive / Gmail via Google Identity Services (token model, no backend),
// plus Web Share API and mailto fallbacks.
export type { EmailDraft, GoogleStatus } from './types'
export {
  getGoogleStatus,
  googleSignIn,
  googleSignOut,
  getAccessToken,
  getGrantedScopes,
  invalidateToken,
  loadGis,
  SCOPE_URLS,
  GIS_SCRIPT_URL,
} from './googleAuth'
export type { GoogleScope } from './googleAuth'
export { googleFetch } from './http'
export { uploadToDrive, backupToDrive, restoreFromDrive, findOrCreateFolder, DRIVE_BACKUP_FILE_NAME } from './drive'
export type { UploadOptions } from './drive'
export { sendViaGmail, buildGmailRaw } from './gmail'
export { buildMimeMessage, encodeHeaderWord, formatAddress, toBase64Url, asciiFileName, parseAddress, assertValidEmail, InvalidEmailAddressError } from './mime'
export type { MimeMessageInput, MimeAttachment, MimeBuildOptions } from './mime'
export { canShareFiles, shareFiles, buildMailtoUrl, downloadBlob } from './share'
export { GoogleApiError, friendlyGoogleMessage } from './errors'
export type { GoogleErrorCode, Bilingual } from './errors'
