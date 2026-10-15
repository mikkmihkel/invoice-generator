// Automatic, versioned backups to Google Drive: file naming, change detection, upload + pruning, rate limiting,
// and the session-only passphrase. UI-independent; the React side lives in src/ui/useAutoBackup.ts.
import { holdsNumber, type AutoBackupSettings, type BackupFile } from '../domain'
import { encryptText } from './backupCrypto'
import { listDriveBackups, trashDriveFile, uploadBackupVersion, type DriveBackupFile, type DriveCallOptions } from './drive'
import { GoogleApiError } from './errors'
import { hasAccessToken } from './googleAuth'

export const AUTO_BACKUP_FILE_PREFIX = 'arveldaja-backup-'
export const AUTO_BACKUP_DEBOUNCE_MS = 10_000
export const AUTO_BACKUP_MIN_INTERVAL_MS = 60_000
/** Retry after a failed upload (network, Drive error). */
export const AUTO_BACKUP_RETRY_MS = 5 * 60_000
export const KEEP_VERSIONS_DEFAULT = 10
export const KEEP_VERSIONS_MIN = 3
export const KEEP_VERSIONS_MAX = 100

/** Settings with defaults applied and keepVersions clamped to 3–100. */
export function normalizeAutoBackup(s: Partial<AutoBackupSettings> | null | undefined): AutoBackupSettings {
  const keep = Number.isFinite(s?.keepVersions) ? Math.round(s!.keepVersions!) : KEEP_VERSIONS_DEFAULT
  const out: AutoBackupSettings = {
    enabled: s?.enabled === true,
    encrypt: s?.encrypt === true,
    keepVersions: Math.min(KEEP_VERSIONS_MAX, Math.max(KEEP_VERSIONS_MIN, keep)),
  }
  if (typeof s?.lastBackupAt === 'string') out.lastBackupAt = s.lastBackupAt
  return out
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** `arveldaja-backup-YYYY-MM-DD-HHmmss.json` (`.json.enc` when encrypted), in local time. */
export function autoBackupFileName(date: Date = new Date(), encrypted = false): string {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const t = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${AUTO_BACKUP_FILE_PREFIX}${d}-${t}.json${encrypted ? '.enc' : ''}`
}

const NAME_RE = /^(?:arveldaja|arvegeneraator)-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.json(\.enc)?$/

/** Local time and encryption flag from an automatic backup's file name (current or earlier prefix), or null for other names. */
export function parseAutoBackupFileName(name: string): { date: Date; encrypted: boolean } | null {
  const m = NAME_RE.exec(name)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number)
  const date = new Date(y, mo - 1, d, h, mi, s)
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return { date, encrypted: !!m[7] }
}

/** When the file's content was last written (the manual backup file is overwritten in place). */
function fileTime(f: DriveBackupFile): number {
  const times = [f.createdTime, f.modifiedTime].map((v) => Date.parse(v ?? '')).filter((t) => !Number.isNaN(t))
  if (times.length) return Math.max(...times)
  return parseAutoBackupFileName(f.name)?.date.getTime() ?? 0
}

const newestFirst = (files: DriveBackupFile[]) =>
  [...files].sort((a, b) => fileTime(b) - fileTime(a) || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))

/**
 * Issued (numbered) documents in a backup. A backup with fewer is normally missing data; documents deleted on
 * purpose in this browser are accounted for with noteDeletedDocuments.
 */
export function issuedCount(backup: BackupFile): number {
  return backup.invoices.filter(holdsNumber).length
}

/** Deletion records in a backup: documents deleted on purpose before it was taken. */
export function deletedCount(backup: BackupFile): number {
  return backup.deleted?.length ?? 0
}

/** Issued plus deleted documents of a version: grows with the data even when documents are deleted. */
function versionSize(f: DriveBackupFile): number | undefined {
  return f.issued === undefined ? undefined : f.issued + (f.deleted ?? 0)
}

const DELETED_KEY = 'invoice-generator:deletedSinceBackup'
let sessionDeleted: { dest: string; count: number } | null = null

function readDeleted(): { dest: string; count: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(DELETED_KEY) ?? 'null') as { dest?: unknown; count?: unknown } | null
    return v && typeof v.dest === 'string' && Number.isSafeInteger(v.count) && (v.count as number) > 0 ? { dest: v.dest, count: v.count as number } : null
  } catch {
    return sessionDeleted
  }
}

/** Issued documents deleted in this browser since its last backup uploaded to this destination. */
export function deletedSinceBackup(clientId: string, folderName: string): number {
  const v = readDeleted()
  return v && v.dest === destination(clientId, folderName) ? v.count : 0
}

/**
 * Record issued documents deleted on purpose (negative after an undo or a failed deletion), so the next background
 * backup to this destination is not held back for having fewer documents than the previous one. The uploaded
 * backup subtracts what it accounted for.
 */
export function noteDeletedDocuments(delta: number, clientId: string, folderName: string): void {
  const dest = destination(clientId, folderName)
  const count = Math.max(0, deletedSinceBackup(clientId, folderName) + Math.trunc(delta))
  sessionDeleted = count ? { dest, count } : null
  try {
    if (count) localStorage.setItem(DELETED_KEY, JSON.stringify({ dest, count }))
    else localStorage.removeItem(DELETED_KEY)
  } catch {
    // storage unavailable: kept for this session
  }
}

/** Forget recorded deletions (after the data was replaced from a backup). */
export function clearDeletedDocuments(): void {
  sessionDeleted = null
  try {
    localStorage.removeItem(DELETED_KEY)
  } catch {
    // storage unavailable
  }
}

/**
 * This browser's automatic versions to move to the trash after uploading `current`: those beyond the newest
 * `keep` (at least KEEP_VERSIONS_MIN). Versions of other browsers, older untagged versions and the manual file are
 * never touched, nor is a version with more issued and deleted documents than `current`. Nothing is pruned when
 * `current` has fewer of them than the newest other backup in the folder.
 */
export function versionsToPrune(files: DriveBackupFile[], keep: number, device: string, current: DriveBackupFile): DriveBackupFile[] {
  const floor = versionSize(current)
  const newestOther = newestFirst(files.filter((f) => f.id !== current.id))[0]
  const otherSize = newestOther && versionSize(newestOther)
  if (floor !== undefined && otherSize !== undefined && floor < otherSize) return []
  const own = newestFirst(files.filter((f) => f.automatic && f.device === device && parseAutoBackupFileName(f.name)))
  return own.slice(Math.max(KEEP_VERSIONS_MIN, keep)).filter((f) => {
    const size = versionSize(f)
    return f.id !== current.id && (floor === undefined || (size !== undefined && size <= floor))
  })
}

/** Why a background backup is held back instead of uploaded. */
export interface BackupHold {
  /** Issued documents in this browser. */
  local: number
  /** Issued documents in the newest backup in Drive, when known. */
  existing?: number
}

/**
 * Hold a background backup when it would push a backup with less data on top of the existing ones (typically a new
 * computer, or an older file restored by mistake). Once this browser has versions of its own, it is compared with
 * its newest one; otherwise with the largest backup in Drive, and an empty database is also held back when a backup
 * of unknown size exists (older versions and the manual file carry no count).
 */
export function backupHold(files: DriveBackupFile[], device: string, local: number): BackupHold | null {
  const own = newestFirst(files.filter((f) => f.device === device && f.issued !== undefined))[0]
  if (own) return local < own.issued! ? { local, existing: own.issued } : null
  const most = Math.max(-1, ...files.map((f) => f.issued ?? -1))
  if (local < most) return { local, existing: most }
  return local === 0 && files.some((f) => f.issued === undefined) ? { local } : null
}

/**
 * Plaintext automatic versions superseded by the newest encrypted one: older than it and without more issued
 * documents. Offered for the trash after encryption is switched on.
 */
export function plaintextVersions(files: DriveBackupFile[]): DriveBackupFile[] {
  const encrypted = newestFirst(files.filter((f) => f.automatic && f.encrypted))[0]
  if (!encrypted) return []
  const limit = encrypted.issued
  return files.filter(
    (f) =>
      f.automatic &&
      !f.encrypted &&
      fileTime(f) <= fileTime(encrypted) &&
      (limit === undefined || f.issued === undefined || f.issued <= limit),
  )
}

/**
 * The backup to preselect for a restore: the newest one that has at least as many issued plus deleted documents as
 * any other (an unknown count counts as large; a deletion does not make a newer version look smaller), and never
 * an empty one while another backup may hold documents.
 */
export function preferredRestoreFile(files: DriveBackupFile[]): DriveBackupFile | undefined {
  const sorted = newestFirst(files)
  const most = Math.max(0, ...sorted.map((f) => versionSize(f) ?? 0))
  const hasData = sorted.some((f) => f.issued !== 0)
  return sorted.find((f) => (versionSize(f) ?? Infinity) >= most && !(f.issued === 0 && hasData)) ?? sorted[0]
}

const DEVICE_KEY = 'invoice-generator:backupDeviceId'
let sessionDeviceId: string | null = null

/** Random id of this browser (shared by its tabs), recorded on each uploaded version so pruning stays local. */
export function getBackupDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY)
    if (stored && /^[0-9a-f]{32}$/.test(stored)) return stored
  } catch {
    // storage unavailable: an id for this session only
  }
  if (!sessionDeviceId) {
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    sessionDeviceId = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  try {
    localStorage.setItem(DEVICE_KEY, sessionDeviceId)
    return localStorage.getItem(DEVICE_KEY) ?? sessionDeviceId
  } catch {
    return sessionDeviceId
  }
}

/** The backup without fields that change on every export or by the backup itself (export time, backup bookkeeping). */
function stableContent(backup: BackupFile): string {
  const settings = backup.settings ? { ...backup.settings, updatedAt: '', autoBackup: undefined } : null
  return JSON.stringify({ ...backup, exportedAt: '', settings })
}

function fallbackHash(text: string): string {
  // FNV-1a over UTF-16 code units, two lanes; only used where Web Crypto is missing.
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x811c9dc5)
  }
  return `fnv-${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}-${text.length}`
}

/** Content hash used to skip uploads when nothing changed since the last backup. */
export async function backupFingerprint(backup: BackupFile): Promise<string> {
  const text = stableContent(backup)
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return fallbackHash(text)
  const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const FINGERPRINT_KEY = 'invoice-generator:autoBackupFingerprint'

function destination(clientId: string, folderName: string) {
  return `${clientId.trim()}|${folderName.trim()}`
}

/** Fingerprint of the last backup uploaded to this destination (shared by all tabs). */
export function readLastFingerprint(clientId: string, folderName: string): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(FINGERPRINT_KEY) ?? 'null') as { dest?: unknown; hash?: unknown } | null
    return v && v.dest === destination(clientId, folderName) && typeof v.hash === 'string' ? v.hash : null
  } catch {
    return null
  }
}

function writeLastFingerprint(clientId: string, folderName: string, hash: string) {
  try {
    localStorage.setItem(FINGERPRINT_KEY, JSON.stringify({ dest: destination(clientId, folderName), hash }))
  } catch {
    // storage unavailable: the next check uploads again
  }
}

// ---------- Session passphrase (memory only) ----------

let passphrase: string | null = null
let passphrasePromptDismissed = false
const passphraseListeners = new Set<() => void>()

/** Keep the encryption passphrase in memory for this session (null forgets it). Never persisted. */
export function setBackupPassphrase(value: string | null): void {
  passphrase = value || null
  if (passphrase) passphrasePromptDismissed = false
  for (const l of [...passphraseListeners]) l()
}
export function getBackupPassphrase(): string | null {
  return passphrase
}
export function hasBackupPassphrase(): boolean {
  return passphrase !== null
}
export function subscribeBackupPassphrase(listener: () => void): () => void {
  passphraseListeners.add(listener)
  return () => passphraseListeners.delete(listener)
}
/** The user postponed the passphrase prompt: don't ask again automatically in this session. */
export function dismissPassphrasePrompt(): void {
  passphrasePromptDismissed = true
}
export function wasPassphrasePromptDismissed(): boolean {
  return passphrasePromptDismissed
}

// ---------- Status (shared between the background hook and the settings section) ----------

export type AutoBackupPhase = 'idle' | 'running' | 'pending' | 'error'

export interface AutoBackupStatus {
  phase: AutoBackupPhase
  /**
   * Why a backup is waiting: no Google token in this session, no passphrase for encryption, or held back because
   * Drive has a backup with more data (`hold`).
   */
  reason?: 'signin' | 'passphrase' | 'held'
  hold?: BackupHold
  /** Last failure (phase 'error'). */
  error?: unknown
}

let status: AutoBackupStatus = { phase: 'idle' }
const statusListeners = new Set<() => void>()

export function getAutoBackupStatus(): AutoBackupStatus {
  return status
}
export function setAutoBackupStatus(next: AutoBackupStatus): void {
  const sameHold = next.hold?.local === status.hold?.local && next.hold?.existing === status.hold?.existing
  if (next.phase === status.phase && next.reason === status.reason && next.error === status.error && sameHold) return
  status = next
  for (const l of [...statusListeners]) l()
}
export function subscribeAutoBackupStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

let plaintextCount = 0
const plaintextListeners = new Set<() => void>()

/** Plaintext automatic versions left in Drive after the last encrypted backup (see plaintextVersions). */
export function getPlaintextVersionCount(): number {
  return plaintextCount
}
export function setPlaintextVersionCount(n: number): void {
  if (n === plaintextCount) return
  plaintextCount = n
  for (const l of [...plaintextListeners]) l()
}
export function subscribePlaintextVersionCount(listener: () => void): () => void {
  plaintextListeners.add(listener)
  return () => plaintextListeners.delete(listener)
}

// ---------- Running a backup ----------

const LOCK_NAME = 'invoice-generator-auto-backup'
let localChain: Promise<unknown> = Promise.resolve()

/** Serialise backup runs within the tab and, where Web Locks exist, across tabs. */
function withBackupLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  if (locks?.request) return locks.request(LOCK_NAME, fn) as Promise<T>
  const run = localChain.then(fn, fn)
  localChain = run.catch(() => undefined)
  return run
}

export interface AutoBackupRunOptions {
  clientId: string
  folderName: string
  settings: AutoBackupSettings
  exportBackup: () => Promise<BackupFile>
  serialize: (backup: BackupFile) => string
  /**
   * True for a user-initiated backup: uploads even if nothing changed, and Google sign-in may open a popup
   * (sign in from the click handler first). False: only with a token already in memory, never a popup.
   */
  interactive?: boolean
  passphrase?: string | null
  now?: () => Date
}

export type AutoBackupResult =
  | {
      kind: 'uploaded'
      file: DriveBackupFile
      at: string
      pruned: number
      pruneFailed: boolean
      /** After an encrypted upload: superseded plaintext automatic versions still in Drive. */
      plaintextVersions: number
    }
  | { kind: 'held'; hold: BackupHold }
  | { kind: 'unchanged' }
  | { kind: 'needs-signin' }
  | { kind: 'needs-passphrase' }

/**
 * Upload a new backup version if the data changed, then trash this browser's versions beyond `keepVersions`.
 * A background run first checks Drive and holds back (kind 'held') a backup with less data than the newest one
 * there; a user-initiated run always uploads.
 */
export function runAutoBackup(opts: AutoBackupRunOptions): Promise<AutoBackupResult> {
  const interactive = opts.interactive === true
  const call: DriveCallOptions | undefined = interactive ? undefined : { interactive: false }
  const { clientId, folderName, settings } = opts
  return withBackupLock(async (): Promise<AutoBackupResult> => {
    // Deletions recorded from here on are not in this backup's count: only these are settled by its upload.
    const deletedBefore = deletedSinceBackup(clientId, folderName)
    const backup = await opts.exportBackup()
    // Switching encryption on must produce an encrypted version even when the data did not change.
    const hash = `${await backupFingerprint(backup)}${settings.encrypt ? ':enc' : ''}`
    if (!interactive && readLastFingerprint(clientId, folderName) === hash) return { kind: 'unchanged' }
    if (!interactive && !hasAccessToken(clientId, ['drive'])) return { kind: 'needs-signin' }
    const secret = settings.encrypt ? opts.passphrase : null
    if (settings.encrypt && !secret) return { kind: 'needs-passphrase' }

    const device = getBackupDeviceId()
    const issued = issuedCount(backup)
    const deleted = deletedCount(backup)
    const now = opts.now?.() ?? new Date()
    let existing: DriveBackupFile[] | null = null
    let file: DriveBackupFile
    try {
      if (!interactive) {
        existing = await listDriveBackups(clientId, folderName, call)
        const hold = backupHold(existing, device, issued + deletedBefore)
        if (hold) return { kind: 'held', hold }
      }
      const json = opts.serialize(backup)
      const content = secret ? await encryptText(json, secret) : json
      const name = autoBackupFileName(now, !!secret)
      file = await uploadBackupVersion(clientId, folderName, name, content, !!secret, call, { device, issued, deleted })
      file = { ...file, device, issued, deleted }
    } catch (e) {
      if (!interactive && e instanceof GoogleApiError && e.code === 'unauthorized') return { kind: 'needs-signin' }
      throw e
    }
    writeLastFingerprint(clientId, folderName, hash)
    noteDeletedDocuments(-deletedBefore, clientId, folderName)

    let pruned = 0
    let pruneFailed = false
    let files = existing ? [...existing] : []
    try {
      if (!existing) files = await listDriveBackups(clientId, folderName, call)
      files = [file, ...files.filter((f) => f.id !== file.id)]
      for (const old of versionsToPrune(files, settings.keepVersions, device, file)) {
        await trashDriveFile(clientId, old.id, call)
        files = files.filter((f) => f.id !== old.id)
        pruned++
      }
    } catch {
      // The backup itself succeeded; old versions are pruned on the next run.
      pruneFailed = true
    }
    const plaintext = secret ? plaintextVersions(files).length : 0
    return { kind: 'uploaded', file, at: now.toISOString(), pruned, pruneFailed, plaintextVersions: plaintext }
  })
}

/** Move the plaintext automatic versions superseded by an encrypted one (plaintextVersions) to the Drive trash. */
export function trashPlaintextVersions(clientId: string, folderName: string): Promise<number> {
  return withBackupLock(async () => {
    const files = await listDriveBackups(clientId, folderName)
    let trashed = 0
    for (const f of plaintextVersions(files)) {
      await trashDriveFile(clientId, f.id)
      trashed++
    }
    setPlaintextVersionCount(0)
    return trashed
  })
}

// ---------- Scheduling ----------

export interface SchedulerOptions {
  debounceMs?: number
  minIntervalMs?: number
  retryMs?: number
  now?: () => number
}

/** What a scheduled run reports back: whether it uploaded (rate limit) and whether to try again later. */
export interface ScheduledRunResult {
  uploaded: boolean
  retry?: boolean
}

/**
 * Debounces change notifications and limits uploads to one per `minIntervalMs`. Runs never overlap; a change
 * during a run schedules another one afterwards.
 */
export class BackupScheduler {
  private readonly debounceMs: number
  private readonly minIntervalMs: number
  private readonly retryMs: number
  private readonly now: () => number
  private timer: ReturnType<typeof setTimeout> | undefined
  private dueAt = Infinity
  private running = false
  private dirty = false
  private disposed = false
  private lastUpload = -Infinity
  private readonly run: () => Promise<ScheduledRunResult>

  constructor(run: () => Promise<ScheduledRunResult>, options: SchedulerOptions = {}) {
    this.run = run
    this.debounceMs = options.debounceMs ?? AUTO_BACKUP_DEBOUNCE_MS
    this.minIntervalMs = options.minIntervalMs ?? AUTO_BACKUP_MIN_INTERVAL_MS
    this.retryMs = options.retryMs ?? AUTO_BACKUP_RETRY_MS
    this.now = options.now ?? Date.now
  }

  /** Data changed: run after the debounce delay (restarted by further changes). */
  notify(): void {
    this.dirty = true
    this.schedule(this.debounceMs, true)
  }

  /** Run as soon as the rate limit allows (e.g. a token or passphrase became available). */
  flush(): void {
    this.dirty = true
    this.schedule(0, true)
  }

  get isScheduled(): boolean {
    return this.timer !== undefined || this.running
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedule(delay: number, restart: boolean) {
    if (this.disposed || this.running) return
    const at = Math.max(this.now() + delay, this.lastUpload + this.minIntervalMs)
    if (this.timer !== undefined && !restart && at >= this.dueAt) return
    clearTimeout(this.timer)
    this.dueAt = at
    this.timer = setTimeout(() => void this.fire(), Math.max(0, at - this.now()))
  }

  private async fire() {
    this.timer = undefined
    this.dueAt = Infinity
    if (this.disposed || !this.dirty) return
    this.dirty = false
    this.running = true
    let retry = false
    try {
      const res = await this.run()
      if (res.uploaded) this.lastUpload = this.now()
      retry = !!res.retry
    } catch {
      retry = true
    } finally {
      this.running = false
    }
    if (this.disposed) return
    if (this.dirty) this.schedule(this.debounceMs, true)
    else if (retry) {
      this.dirty = true
      this.schedule(this.retryMs, false)
    }
  }
}
