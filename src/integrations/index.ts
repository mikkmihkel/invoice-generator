// Google Drive / Gmail via Google Identity Services (token model, no backend),
// plus Web Share API and mailto fallbacks.
export type { EmailDraft, GoogleStatus } from './types'
export {
  getGoogleStatus,
  googleSignIn,
  googleSignOut,
  getAccessToken,
  getGrantedScopes,
  hasAccessToken,
  invalidateToken,
  loadGis,
  rememberedGoogleAccount,
  subscribeGoogleAuth,
  getGoogleAuthVersion,
  SCOPE_URLS,
  GIS_SCRIPT_URL,
} from './googleAuth'
export type { GoogleScope, TokenOptions } from './googleAuth'
export { googleFetch } from './http'
export {
  uploadToDrive,
  backupToDrive,
  restoreFromDrive,
  findOrCreateFolder,
  findOrCreateAppFolder,
  resolveDriveFolder,
  driveFolderKey,
  DRIVE_BACKUP_FILE_NAME,
  LEGACY_DRIVE_BACKUP_FILE_NAME,
  uploadBackupVersion,
  listDriveBackups,
  downloadDriveFile,
  trashDriveFile,
  BACKUP_VERSION_PROPERTY,
} from './drive'
export type { UploadOptions, DriveBackupFile, DriveCallOptions, DriveFolderRef } from './drive'
export {
  builtInGoogleConfig,
  effectiveClientId,
  ownClientId,
  usesBuiltInClient,
  isBuiltInClientId,
  availableScopes,
  canSendWithGmail,
  pickerConfig,
  driveFolderRef,
  driveFolderLabel,
  driveFolderUrl,
  autoSavePdfEnabled,
  DRIVE_APP_FOLDER_NAME,
  DRIVE_PDF_SUBFOLDER,
  DRIVE_BACKUP_SUBFOLDER,
} from './googleClient'
export type { BuiltInGoogleConfig, DriveFileKind } from './googleClient'
export { loadPicker, pickDriveFolder, GAPI_SCRIPT_URL } from './picker'
export type { PickFolderOptions } from './picker'
export { encryptText, decryptText, isEncryptedEnvelope, BackupCryptoError, PBKDF2_ITERATIONS, ENCRYPTED_BACKUP_FORMAT } from './backupCrypto'
export type { EncryptedEnvelope } from './backupCrypto'
export { sendViaGmail, buildGmailRaw } from './gmail'
export { buildMimeMessage, encodeHeaderWord, formatAddress, toBase64Url, asciiFileName, parseAddress, assertValidEmail, InvalidEmailAddressError } from './mime'
export type { MimeMessageInput, MimeAttachment, MimeBuildOptions } from './mime'
export { canShareFiles, shareFiles, buildMailtoUrl, downloadBlob } from './share'
export { GoogleApiError, friendlyGoogleMessage } from './errors'
export type { GoogleErrorCode, Bilingual } from './errors'
export {
  AUTO_BACKUP_FILE_PREFIX,
  KEEP_VERSIONS_DEFAULT,
  KEEP_VERSIONS_MIN,
  KEEP_VERSIONS_MAX,
  normalizeAutoBackup,
  autoBackupFileName,
  parseAutoBackupFileName,
  versionsToPrune,
  backupFingerprint,
  runAutoBackup,
  BackupScheduler,
  setBackupPassphrase,
  getBackupPassphrase,
  hasBackupPassphrase,
  subscribeBackupPassphrase,
  dismissPassphrasePrompt,
  wasPassphrasePromptDismissed,
  getAutoBackupStatus,
  setAutoBackupStatus,
  subscribeAutoBackupStatus,
  noteDeletedDocuments,
  deletedSinceBackup,
  clearDeletedDocuments,
  deletedCount,
} from './autoBackup'
export type { AutoBackupRunOptions, AutoBackupResult, AutoBackupStatus, AutoBackupPhase, ScheduledRunResult, SchedulerOptions } from './autoBackup'
