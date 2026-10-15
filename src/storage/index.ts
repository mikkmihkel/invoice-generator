// IndexedDB persistence (via `idb`) + backup import/export + change notifications.
export type { Repository, ImportResult, ImportCount, RepositoryOptions, SaveProfileOptions } from './repository'
export {
  getRepository,
  createRepository,
  requestPersistentStorage,
  snapshotSeller,
  RepositoryError,
  InvoiceValidationError,
} from './repository'
export { subscribe, notifyChange } from './events'
export type { StorageChange, StorageArea, StorageListener } from './events'
export {
  validateBackup,
  parseBackup,
  serializeBackup,
  backupFileName,
  BackupFormatError,
  BACKUP_APP,
  BACKUP_VERSION,
  BACKUP_MIN_VERSION,
} from './backup'
export { DB_NAME, DB_VERSION, openInvoiceDb } from './db'
