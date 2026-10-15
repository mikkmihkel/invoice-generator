import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupFile } from '../domain'
import {
  autoBackupFileName,
  backupFingerprint,
  BackupScheduler,
  getAutoBackupStatus,
  getBackupPassphrase,
  normalizeAutoBackup,
  parseAutoBackupFileName,
  runAutoBackup,
  setAutoBackupStatus,
  setBackupPassphrase,
  subscribeAutoBackupStatus,
  subscribeBackupPassphrase,
  versionsToPrune,
  type AutoBackupRunOptions,
} from './autoBackup'
import { decryptText, isEncryptedEnvelope } from './backupCrypto'
import { listDriveBackups, trashDriveFile, uploadBackupVersion, type DriveBackupFile } from './drive'
import { GoogleApiError } from './errors'
import { hasAccessToken } from './googleAuth'

vi.mock('./drive', () => ({
  uploadBackupVersion: vi.fn(),
  listDriveBackups: vi.fn(async () => []),
  trashDriveFile: vi.fn(async () => undefined),
}))
vi.mock('./googleAuth', () => ({ hasAccessToken: vi.fn(() => true) }))

const CLIENT = '123-abc.apps.googleusercontent.com'

function backup(patch: Partial<BackupFile> = {}): BackupFile {
  return {
    app: 'invoice-generator',
    version: 2,
    exportedAt: new Date().toISOString(),
    profile: null,
    clients: [],
    invoices: [],
    settings: { uiLanguage: 'et', driveFolderName: 'Arved', registryLiveLookup: false, updatedAt: '2026-10-15T10:00:00Z' },
    ...patch,
  }
}

const auto = (id: string, createdTime: string, name = `arvegeneraator-backup-${createdTime.slice(0, 10)}-${id.padStart(6, '0')}.json`): DriveBackupFile => ({
  id,
  name,
  createdTime,
  encrypted: false,
  automatic: true,
})

describe('file names and settings', () => {
  it('names versions by local date and time', () => {
    const d = new Date(2026, 9, 15, 14, 23, 5)
    expect(autoBackupFileName(d)).toBe('arvegeneraator-backup-2026-10-15-142305.json')
    expect(autoBackupFileName(d, true)).toBe('arvegeneraator-backup-2026-10-15-142305.json.enc')
    expect(parseAutoBackupFileName('arvegeneraator-backup-2026-10-15-142305.json.enc')).toEqual({ date: d, encrypted: true })
    expect(parseAutoBackupFileName('arvegeneraator-backup-2026-02-30-120000.json')).toBeNull()
    expect(parseAutoBackupFileName('invoice-generator-backup.json')).toBeNull()
  })

  it('applies defaults and clamps keepVersions', () => {
    expect(normalizeAutoBackup(undefined)).toEqual({ enabled: false, encrypt: false, keepVersions: 10 })
    expect(normalizeAutoBackup({ enabled: true, encrypt: true, keepVersions: 0, lastBackupAt: '2026-10-15T10:00:00Z' })).toEqual({
      enabled: true,
      encrypt: true,
      keepVersions: 1,
      lastBackupAt: '2026-10-15T10:00:00Z',
    })
    expect(normalizeAutoBackup({ keepVersions: 5000 }).keepVersions).toBe(100)
    expect(normalizeAutoBackup({ keepVersions: Number.NaN }).keepVersions).toBe(10)
  })

  it('prunes only automatic versions beyond the newest N', () => {
    const files = [
      auto('3', '2026-10-15T10:00:00Z'),
      { ...auto('m', '2020-01-01T00:00:00Z', 'invoice-generator-backup.json'), automatic: false },
      auto('1', '2026-10-13T10:00:00Z'),
      auto('2', '2026-10-14T10:00:00Z'),
      { ...auto('x', '2019-01-01T00:00:00Z', 'other.json') },
    ]
    expect(versionsToPrune(files, 2).map((f) => f.id)).toEqual(['1'])
    expect(versionsToPrune(files, 10)).toEqual([])
    expect(versionsToPrune(files, 0).map((f) => f.id)).toEqual(['2', '1'])
  })
})

describe('change detection', () => {
  it('ignores export time and backup bookkeeping', async () => {
    const a = backup()
    const b = backup({
      exportedAt: '2030-01-01T00:00:00Z',
      settings: { ...a.settings!, updatedAt: '2030-01-01T00:00:00Z', autoBackup: { enabled: true, encrypt: false, keepVersions: 10, lastBackupAt: '2030-01-01T00:00:00Z' } },
    })
    expect(await backupFingerprint(a)).toBe(await backupFingerprint(b))
    expect(await backupFingerprint(a)).not.toBe(await backupFingerprint(backup({ settings: { ...a.settings!, uiLanguage: 'en' } })))
    expect(await backupFingerprint(a)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('runAutoBackup', () => {
  let data: BackupFile
  const run = (patch: Partial<AutoBackupRunOptions> = {}) =>
    runAutoBackup({
      clientId: CLIENT,
      folderName: 'Arved',
      settings: { enabled: true, encrypt: false, keepVersions: 3 },
      exportBackup: async () => data,
      serialize: (b) => JSON.stringify(b),
      now: () => new Date(2026, 9, 15, 14, 23, 5),
      ...patch,
    })

  beforeEach(() => {
    localStorage.clear()
    data = backup()
    vi.mocked(hasAccessToken).mockReturnValue(true)
    vi.mocked(uploadBackupVersion).mockReset()
    vi.mocked(uploadBackupVersion).mockImplementation(async (_c, _f, name, _content, encrypted) => ({ id: 'new', name, encrypted, automatic: true, createdTime: '2026-10-15T11:23:05Z' }))
    vi.mocked(listDriveBackups).mockReset()
    vi.mocked(listDriveBackups).mockResolvedValue([])
    vi.mocked(trashDriveFile).mockClear()
  })

  it('uploads a version, then skips until the data changes', async () => {
    const res = await run()
    expect(res).toMatchObject({ kind: 'uploaded', at: new Date(2026, 9, 15, 14, 23, 5).toISOString(), pruned: 0 })
    expect(uploadBackupVersion).toHaveBeenCalledWith(CLIENT, 'Arved', 'arvegeneraator-backup-2026-10-15-142305.json', JSON.stringify(data), false, { interactive: false })
    expect(await run()).toEqual({ kind: 'unchanged' })
    data = backup({ exportedAt: '2031-01-01T00:00:00Z' })
    expect(await run()).toEqual({ kind: 'unchanged' })
    data = backup({ clients: [{ id: 'c1' } as never] })
    expect((await run()).kind).toBe('uploaded')
    expect(uploadBackupVersion).toHaveBeenCalledTimes(2)
  })

  it('uploads on request even without changes, with the interactive token source', async () => {
    await run()
    expect((await run({ interactive: true })).kind).toBe('uploaded')
    expect(vi.mocked(uploadBackupVersion).mock.calls[1][5]).toBeUndefined()
  })

  it('waits for a token instead of signing in, but only when there is something to back up', async () => {
    vi.mocked(hasAccessToken).mockReturnValue(false)
    expect(await run()).toEqual({ kind: 'needs-signin' })
    expect(uploadBackupVersion).not.toHaveBeenCalled()
    vi.mocked(hasAccessToken).mockReturnValue(true)
    await run()
    vi.mocked(hasAccessToken).mockReturnValue(false)
    expect(await run()).toEqual({ kind: 'unchanged' })
  })

  it('treats an expired token during upload as waiting for sign-in and retries the same data later', async () => {
    vi.mocked(uploadBackupVersion).mockRejectedValueOnce(new GoogleApiError('unauthorized'))
    expect(await run()).toEqual({ kind: 'needs-signin' })
    expect((await run()).kind).toBe('uploaded')
  })

  it('propagates other Drive errors', async () => {
    vi.mocked(uploadBackupVersion).mockRejectedValueOnce(new GoogleApiError('network'))
    await expect(run()).rejects.toMatchObject({ code: 'network' })
    expect((await run()).kind).toBe('uploaded')
  })

  it('asks for the passphrase when encryption is on, and uploads an encrypted envelope', async () => {
    const settings = { enabled: true, encrypt: true, keepVersions: 3 }
    expect(await run({ settings })).toEqual({ kind: 'needs-passphrase' })
    const res = await run({ settings, passphrase: 'salajane parool' })
    expect(res).toMatchObject({ kind: 'uploaded', file: { name: 'arvegeneraator-backup-2026-10-15-142305.json.enc', encrypted: true } })
    const [, , , content, encrypted] = vi.mocked(uploadBackupVersion).mock.calls[0]
    expect(encrypted).toBe(true)
    expect(isEncryptedEnvelope(content)).toBe(true)
    expect(JSON.parse(await decryptText(content, 'salajane parool'))).toEqual(data)
  })

  it('moves automatic versions beyond keepVersions to the trash', async () => {
    vi.mocked(listDriveBackups).mockResolvedValue([
      auto('4', '2026-10-14T10:00:00Z'),
      auto('2', '2026-10-12T10:00:00Z'),
      auto('3', '2026-10-13T10:00:00Z'),
      auto('1', '2026-10-11T10:00:00Z'),
    ])
    const res = await run()
    expect(res).toMatchObject({ kind: 'uploaded', pruned: 2, pruneFailed: false })
    expect(vi.mocked(trashDriveFile).mock.calls.map((c) => c[1])).toEqual(['2', '1'])
    expect(trashDriveFile).toHaveBeenCalledWith(CLIENT, '2', { interactive: false })
  })

  it('still reports the upload when pruning fails', async () => {
    vi.mocked(listDriveBackups).mockRejectedValue(new GoogleApiError('network'))
    expect(await run()).toMatchObject({ kind: 'uploaded', pruneFailed: true })
  })
})

describe('BackupScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces changes and uploads at most once per minute', async () => {
    const run = vi.fn(async () => ({ uploaded: true }))
    const s = new BackupScheduler(run, { debounceMs: 10_000, minIntervalMs: 60_000 })
    s.notify()
    await vi.advanceTimersByTimeAsync(5_000)
    s.notify()
    await vi.advanceTimersByTimeAsync(9_000)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledTimes(1)

    s.notify()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(2)
    s.dispose()
  })

  it('does not rate-limit checks that uploaded nothing', async () => {
    const run = vi.fn(async () => ({ uploaded: false }))
    const s = new BackupScheduler(run, { debounceMs: 10_000, minIntervalMs: 60_000 })
    s.notify()
    await vi.advanceTimersByTimeAsync(10_000)
    s.notify()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(2)
    s.dispose()
  })

  it('never overlaps runs and repeats once for changes made during a run', async () => {
    let finish: () => void = () => undefined
    const run = vi.fn(() => new Promise<{ uploaded: boolean }>((resolve) => (finish = () => resolve({ uploaded: false }))))
    const s = new BackupScheduler(run, { debounceMs: 1_000, minIntervalMs: 0 })
    s.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    s.notify()
    s.notify()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledTimes(2)
    finish()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(2)
    s.dispose()
  })

  it('retries failed runs later and stops after dispose', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ uploaded: true })
    const s = new BackupScheduler(run, { debounceMs: 1_000, minIntervalMs: 60_000, retryMs: 300_000 })
    s.notify()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(299_000)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledTimes(2)
    s.notify()
    s.dispose()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('session state', () => {
  it('keeps the passphrase in memory and notifies listeners', () => {
    const l = vi.fn()
    const off = subscribeBackupPassphrase(l)
    setBackupPassphrase('parool123')
    expect(getBackupPassphrase()).toBe('parool123')
    setBackupPassphrase(null)
    expect(getBackupPassphrase()).toBeNull()
    expect(l).toHaveBeenCalledTimes(2)
    off()
    expect(JSON.stringify(localStorage)).not.toContain('parool123')
  })

  it('publishes status changes only when something changed', () => {
    const l = vi.fn()
    const off = subscribeAutoBackupStatus(l)
    setAutoBackupStatus({ phase: 'pending', reason: 'signin' })
    setAutoBackupStatus({ phase: 'pending', reason: 'signin' })
    expect(getAutoBackupStatus()).toEqual({ phase: 'pending', reason: 'signin' })
    setAutoBackupStatus({ phase: 'idle' })
    expect(l).toHaveBeenCalledTimes(2)
    off()
  })
})
