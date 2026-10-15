// Automatic, versioned backups to Google Drive: file naming, change detection, upload + pruning, rate limiting,
// and the session-only passphrase. UI-independent; the React side lives in src/ui/useAutoBackup.ts.
import type { AutoBackupSettings, BackupFile } from '../domain'
import { encryptText } from './backupCrypto'
import { listDriveBackups, trashDriveFile, uploadBackupVersion, type DriveBackupFile, type DriveCallOptions } from './drive'
import { GoogleApiError } from './errors'
import { hasAccessToken } from './googleAuth'

export const AUTO_BACKUP_FILE_PREFIX = 'arvegeneraator-backup-'
export const AUTO_BACKUP_DEBOUNCE_MS = 10_000
export const AUTO_BACKUP_MIN_INTERVAL_MS = 60_000
/** Retry after a failed upload (network, Drive error). */
export const AUTO_BACKUP_RETRY_MS = 5 * 60_000
export const KEEP_VERSIONS_DEFAULT = 10
export const KEEP_VERSIONS_MIN = 1
export const KEEP_VERSIONS_MAX = 100

/** Settings with defaults applied and keepVersions clamped to 1–100. */
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

/** `arvegeneraator-backup-YYYY-MM-DD-HHmmss.json` (`.json.enc` when encrypted), in local time. */
export function autoBackupFileName(date: Date = new Date(), encrypted = false): string {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const t = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${AUTO_BACKUP_FILE_PREFIX}${d}-${t}.json${encrypted ? '.enc' : ''}`
}

const NAME_RE = /^arvegeneraator-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.json(\.enc)?$/

/** Local time and encryption flag from an automatic backup's file name, or null for other names. */
export function parseAutoBackupFileName(name: string): { date: Date; encrypted: boolean } | null {
  const m = NAME_RE.exec(name)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number)
  const date = new Date(y, mo - 1, d, h, mi, s)
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return { date, encrypted: !!m[7] }
}

function fileTime(f: DriveBackupFile): number {
  const t = Date.parse(f.createdTime ?? '')
  if (!Number.isNaN(t)) return t
  return parseAutoBackupFileName(f.name)?.date.getTime() ?? 0
}

/** Automatic backup versions beyond the newest `keep` (other files in the folder are never touched). */
export function versionsToPrune(files: DriveBackupFile[], keep: number): DriveBackupFile[] {
  const auto = files.filter((f) => f.automatic && parseAutoBackupFileName(f.name))
  auto.sort((a, b) => fileTime(b) - fileTime(a) || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
  return auto.slice(Math.max(KEEP_VERSIONS_MIN, keep))
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
  /** Why a backup is waiting: no Google token in this session, or no passphrase for encryption. */
  reason?: 'signin' | 'passphrase'
  /** Last failure (phase 'error'). */
  error?: unknown
}

let status: AutoBackupStatus = { phase: 'idle' }
const statusListeners = new Set<() => void>()

export function getAutoBackupStatus(): AutoBackupStatus {
  return status
}
export function setAutoBackupStatus(next: AutoBackupStatus): void {
  if (next.phase === status.phase && next.reason === status.reason && next.error === status.error) return
  status = next
  for (const l of [...statusListeners]) l()
}
export function subscribeAutoBackupStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
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
  | { kind: 'uploaded'; file: DriveBackupFile; at: string; pruned: number; pruneFailed: boolean }
  | { kind: 'unchanged' }
  | { kind: 'needs-signin' }
  | { kind: 'needs-passphrase' }

/** Upload a new backup version if the data changed, then trash automatic versions beyond `keepVersions`. */
export function runAutoBackup(opts: AutoBackupRunOptions): Promise<AutoBackupResult> {
  const interactive = opts.interactive === true
  const call: DriveCallOptions | undefined = interactive ? undefined : { interactive: false }
  const { clientId, folderName, settings } = opts
  return withBackupLock(async (): Promise<AutoBackupResult> => {
    const backup = await opts.exportBackup()
    const hash = await backupFingerprint(backup)
    if (!interactive && readLastFingerprint(clientId, folderName) === hash) return { kind: 'unchanged' }
    if (!interactive && !hasAccessToken(clientId, ['drive'])) return { kind: 'needs-signin' }
    const secret = settings.encrypt ? opts.passphrase : null
    if (settings.encrypt && !secret) return { kind: 'needs-passphrase' }

    const now = opts.now?.() ?? new Date()
    const json = opts.serialize(backup)
    const content = secret ? await encryptText(json, secret) : json
    let file: DriveBackupFile
    try {
      file = await uploadBackupVersion(clientId, folderName, autoBackupFileName(now, !!secret), content, !!secret, call)
    } catch (e) {
      if (!interactive && e instanceof GoogleApiError && e.code === 'unauthorized') return { kind: 'needs-signin' }
      throw e
    }
    writeLastFingerprint(clientId, folderName, hash)

    let pruned = 0
    let pruneFailed = false
    try {
      const files = await listDriveBackups(clientId, folderName, call)
      if (!files.some((f) => f.id === file.id)) files.unshift(file)
      for (const old of versionsToPrune(files, settings.keepVersions)) {
        await trashDriveFile(clientId, old.id, call)
        pruned++
      }
    } catch {
      // The backup itself succeeded; old versions are pruned on the next run.
      pruneFailed = true
    }
    return { kind: 'uploaded', file, at: now.toISOString(), pruned, pruneFailed }
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
