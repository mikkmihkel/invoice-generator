import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupFile } from '../domain'
import {
  autoBackupFileName,
  backupFingerprint,
  backupHold,
  BackupScheduler,
  clearDeletedDocuments,
  deletedSinceBackup,
  issuedCount,
  noteDeletedDocuments,
  getAutoBackupStatus,
  getBackupDeviceId,
  getBackupPassphrase,
  getPlaintextVersionCount,
  normalizeAutoBackup,
  parseAutoBackupFileName,
  plaintextVersions,
  preferredRestoreFile,
  runAutoBackup,
  setAutoBackupStatus,
  setBackupPassphrase,
  setPlaintextVersionCount,
  subscribeAutoBackupStatus,
  subscribeBackupPassphrase,
  trashPlaintextVersions,
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

const issuedInvoice = (id: string) => ({ id, status: 'issued', number: id }) as never
const draftInvoice = (id: string) => ({ id, status: 'draft' }) as never

describe('file names and settings', () => {
  it('names versions by local date and time', () => {
    const d = new Date(2026, 9, 15, 14, 23, 5)
    expect(autoBackupFileName(d)).toBe('arveldaja-backup-2026-10-15-142305.json')
    expect(autoBackupFileName(d, true)).toBe('arveldaja-backup-2026-10-15-142305.json.enc')
    expect(parseAutoBackupFileName('arveldaja-backup-2026-10-15-142305.json.enc')).toEqual({ date: d, encrypted: true })
    expect(parseAutoBackupFileName('arveldaja-backup-2026-02-30-120000.json')).toBeNull()
    expect(parseAutoBackupFileName('invoice-generator-backup.json')).toBeNull()
    expect(parseAutoBackupFileName('arveldaja-backup.json')).toBeNull()
  })

  it('still recognises versions uploaded under the earlier name', () => {
    expect(parseAutoBackupFileName('arvegeneraator-backup-2026-10-15-142305.json')).toEqual({ date: new Date(2026, 9, 15, 14, 23, 5), encrypted: false })
    expect(parseAutoBackupFileName('arvegeneraator-backup-2026-10-15-142305.json.enc')?.encrypted).toBe(true)
    const current = { ...auto('new', '2026-10-20T10:00:00Z', 'arveldaja-backup-2026-10-20-100000.json'), device: 'me', issued: 5 }
    const old = ['1', '2', '3'].map((id) => ({ ...auto(id, `2026-10-1${id}T10:00:00Z`), device: 'me', issued: 5 }))
    expect(versionsToPrune([current, ...old], 3, 'me', current).map((f) => f.id)).toEqual(['1'])
  })

  it('applies defaults and clamps keepVersions', () => {
    expect(normalizeAutoBackup(undefined)).toEqual({ enabled: false, encrypt: false, keepVersions: 10 })
    expect(normalizeAutoBackup({ enabled: true, encrypt: true, keepVersions: 0, lastBackupAt: '2026-10-15T10:00:00Z' })).toEqual({
      enabled: true,
      encrypt: true,
      keepVersions: 3,
      lastBackupAt: '2026-10-15T10:00:00Z',
    })
    expect(normalizeAutoBackup({ keepVersions: 5000 }).keepVersions).toBe(100)
    expect(normalizeAutoBackup({ keepVersions: Number.NaN }).keepVersions).toBe(10)
  })

  it('prunes only this browser’s automatic versions beyond the newest N, keeping at least 3', () => {
    const mine = (id: string, time: string) => ({ ...auto(id, time), device: 'me', issued: 5 })
    const current = mine('5', '2026-10-16T10:00:00Z')
    const files = [
      current,
      mine('4', '2026-10-15T10:00:00Z'),
      { ...auto('m', '2020-01-01T00:00:00Z', 'invoice-generator-backup.json'), automatic: false },
      mine('2', '2026-10-13T10:00:00Z'),
      mine('3', '2026-10-14T10:00:00Z'),
      { ...mine('x', '2019-01-01T00:00:00Z'), name: 'other.json' },
      auto('legacy', '2018-01-01T00:00:00Z'),
      { ...auto('other', '2017-01-01T00:00:00Z'), device: 'other', issued: 1 },
    ]
    expect(versionsToPrune(files, 3, 'me', current).map((f) => f.id)).toEqual(['2'])
    expect(versionsToPrune(files, 10, 'me', current)).toEqual([])
    expect(versionsToPrune(files, 0, 'me', current).map((f) => f.id)).toEqual(['2'])
    expect(versionsToPrune(files, 1, 'someone-else', current)).toEqual([])
  })

  it('never trashes the backup of another computer or one with more issued documents', () => {
    const good = { ...auto('good', '2026-10-14T10:00:00Z'), device: 'old-pc', issued: 40 }
    const empty = { ...auto('empty', '2026-10-15T10:00:00Z'), device: 'new-pc', issued: 0 }
    expect(versionsToPrune([good, empty], 1, 'new-pc', empty)).toEqual([])
    expect(versionsToPrune([auto('legacy', '2026-10-14T10:00:00Z'), empty], 1, 'new-pc', empty)).toEqual([])

    // An older file restored by mistake on the same computer: the larger versions survive any number of uploads.
    const mine = (id: string, day: number, issued: number) => {
      const date = `2026-10-${String(day).padStart(2, '0')}`
      return { ...auto(id, `${date}T10:00:00Z`, `arvegeneraator-backup-${date}-100000.json`), device: 'pc', issued }
    }
    const before = [mine('a', 1, 40), mine('b', 2, 40), mine('c', 3, 40), mine('d', 4, 40)]
    const small = mine('s1', 5, 3)
    expect(versionsToPrune([small, ...before], 3, 'pc', small)).toEqual([])
    const smaller = [mine('s4', 9, 3), mine('s3', 8, 3), mine('s2', 7, 3), mine('s1', 6, 3)]
    expect(versionsToPrune([...smaller, ...before], 3, 'pc', smaller[0]).map((f) => f.id)).toEqual(['s1'])
    const grown = mine('g', 10, 41)
    expect(versionsToPrune([grown, ...smaller, ...before], 3, 'pc', grown).map((f) => f.id)).toEqual(['s2', 's1', 'd', 'c', 'b', 'a'])
  })

  it('holds a backup with less data than the newest one in Drive', () => {
    const good = { ...auto('good', '2026-10-14T10:00:00Z'), device: 'old-pc', issued: 40 }
    expect(backupHold([], 'new-pc', 0)).toBeNull()
    expect(backupHold([good], 'new-pc', 0)).toEqual({ local: 0, existing: 40 })
    expect(backupHold([good], 'new-pc', 39)).toEqual({ local: 39, existing: 40 })
    expect(backupHold([good], 'new-pc', 40)).toBeNull()
    expect(backupHold([{ ...good, device: 'new-pc' }], 'new-pc', 12)).toEqual({ local: 12, existing: 40 })
    expect(backupHold([{ ...good, issued: 0 }], 'new-pc', 0)).toBeNull()
    // Older versions and the manual file carry no count: only an empty database is held back.
    const legacy = auto('legacy', '2026-10-14T10:00:00Z')
    expect(backupHold([legacy], 'new-pc', 0)).toEqual({ local: 0 })
    expect(backupHold([legacy], 'new-pc', 1)).toBeNull()
    const manual = { ...auto('m', '2026-01-01T00:00:00Z', 'invoice-generator-backup.json'), automatic: false, modifiedTime: '2026-10-20T00:00:00Z' }
    expect(backupHold([manual], 'new-pc', 0)).toEqual({ local: 0 })
    // A newer empty backup of a third computer does not hide the larger one.
    const empty = { ...auto('empty', '2026-10-15T10:00:00Z'), device: 'third-pc', issued: 0 }
    expect(backupHold([empty, good], 'new-pc', 0)).toEqual({ local: 0, existing: 40 })
    // After "Back up anyway" this browser's own newest version is the reference.
    const mine = { ...empty, device: 'new-pc' }
    expect(backupHold([mine, good, legacy], 'new-pc', 0)).toBeNull()
    expect(backupHold([{ ...mine, issued: 5 }, good], 'new-pc', 4)).toEqual({ local: 4, existing: 5 })
  })

  it('preselects the newest restore candidate that is not smaller than the others', () => {
    const good = { ...auto('good', '2026-10-14T10:00:00Z'), device: 'old-pc', issued: 40 }
    const empty = { ...auto('empty', '2026-10-15T10:00:00Z'), device: 'new-pc', issued: 0 }
    const legacy = auto('legacy', '2026-10-13T10:00:00Z')
    expect(preferredRestoreFile([empty, good, legacy])?.id).toBe('good')
    expect(preferredRestoreFile([empty, legacy])?.id).toBe('legacy')
    expect(preferredRestoreFile([{ ...good, issued: 41, id: 'newer', createdTime: '2026-10-16T10:00:00Z' }, good])?.id).toBe('newer')
    expect(preferredRestoreFile([empty])?.id).toBe('empty')
    expect(preferredRestoreFile([])).toBeUndefined()
  })

  it('counts deleted documents too, so a newer version after a deletion is not passed over for an older one', () => {
    const before = { ...auto('before', '2026-10-14T10:00:00Z'), device: 'pc', issued: 10 }
    const after = { ...auto('9', '2026-10-15T10:00:00Z'), device: 'pc', issued: 9, deleted: 1 }
    expect(preferredRestoreFile([after, before])?.id).toBe('9')
    expect(preferredRestoreFile([{ ...after, deleted: undefined }, before])?.id).toBe('before')
    // Pruning treats it the same way: the older, larger-looking version may go.
    const own = ['1', '2', '3'].map((id) => ({ ...auto(id, `2026-10-1${id}T09:00:00Z`), device: 'pc', issued: 10 }))
    expect(versionsToPrune([after, ...own], 3, 'pc', after).map((f) => f.id)).toEqual(['1'])
  })

  it('counts reopened drafts and issued documents, not plain drafts', () => {
    const reopened = { id: 'r', status: 'draft', number: 'A-1', reopenedAt: '2026-10-15T10:00:00Z' } as never
    expect(issuedCount(backup({ invoices: [issuedInvoice('a'), draftInvoice('d'), reopened] }))).toBe(2)
  })

  it('finds plaintext versions superseded by an encrypted one', () => {
    const enc = { ...auto('enc', '2026-10-15T10:00:00Z'), encrypted: true, issued: 10 }
    const files = [
      enc,
      { ...auto('later', '2026-10-16T10:00:00Z') },
      auto('old', '2026-10-14T10:00:00Z'),
      { ...auto('bigger', '2026-10-13T10:00:00Z'), issued: 11 },
      { ...auto('m', '2026-10-01T10:00:00Z', 'invoice-generator-backup.json'), automatic: false },
    ]
    expect(plaintextVersions(files).map((f) => f.id)).toEqual(['old'])
    expect(plaintextVersions(files.filter((f) => f.id !== 'enc'))).toEqual([])
  })

  it('keeps a per-browser device id', () => {
    localStorage.clear()
    const id = getBackupDeviceId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(getBackupDeviceId()).toBe(id)
    expect(localStorage.getItem('invoice-generator:backupDeviceId')).toBe(id)
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
    expect(uploadBackupVersion).toHaveBeenCalledWith(CLIENT, 'Arved', 'arveldaja-backup-2026-10-15-142305.json', JSON.stringify(data), false, { interactive: false }, { device: getBackupDeviceId(), issued: 0, deleted: 0 })
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
    expect(res).toMatchObject({ kind: 'uploaded', file: { name: 'arveldaja-backup-2026-10-15-142305.json.enc', encrypted: true } })
    const [, , , content, encrypted] = vi.mocked(uploadBackupVersion).mock.calls[0]
    expect(encrypted).toBe(true)
    expect(isEncryptedEnvelope(content)).toBe(true)
    expect(JSON.parse(await decryptText(content, 'salajane parool'))).toEqual(data)
  })

  it('moves this browser’s automatic versions beyond keepVersions to the trash', async () => {
    const mine = (id: string, time: string) => ({ ...auto(id, time), device: getBackupDeviceId(), issued: 0 })
    vi.mocked(listDriveBackups).mockResolvedValue([
      mine('4', '2026-10-14T10:00:00Z'),
      mine('2', '2026-10-12T10:00:00Z'),
      mine('3', '2026-10-13T10:00:00Z'),
      mine('1', '2026-10-11T10:00:00Z'),
      auto('legacy', '2026-10-10T10:00:00Z'),
    ])
    const res = await run()
    expect(res).toMatchObject({ kind: 'uploaded', pruned: 2, pruneFailed: false })
    expect(vi.mocked(trashDriveFile).mock.calls.map((c) => c[1])).toEqual(['2', '1'])
    expect(trashDriveFile).toHaveBeenCalledWith(CLIENT, '2', { interactive: false })
    expect(listDriveBackups).toHaveBeenCalledTimes(1)
  })

  it('still reports the upload when pruning fails', async () => {
    const mine = (id: string, time: string) => ({ ...auto(id, time), device: getBackupDeviceId(), issued: 0 })
    vi.mocked(listDriveBackups).mockResolvedValue(['1', '2', '3', '4'].map((id) => mine(id, `2026-10-1${id}T10:00:00Z`)))
    vi.mocked(trashDriveFile).mockRejectedValueOnce(new GoogleApiError('network'))
    expect(await run()).toMatchObject({ kind: 'uploaded', pruneFailed: true })
  })

  it('does not hold back a backup after documents were deleted on purpose in this browser', async () => {
    const mine = { ...auto('mine', '2026-10-14T10:00:00Z'), device: getBackupDeviceId(), issued: 3 }
    vi.mocked(listDriveBackups).mockResolvedValue([mine])
    data = backup({ invoices: [issuedInvoice('a'), issuedInvoice('b')] })
    expect(await run()).toEqual({ kind: 'held', hold: { local: 2, existing: 3 } })
    noteDeletedDocuments(1, CLIENT, 'Arved')
    expect(deletedSinceBackup(CLIENT, 'Arved')).toBe(1)
    expect((await run()).kind).toBe('uploaded')
    // Counted from the new version on.
    expect(deletedSinceBackup(CLIENT, 'Arved')).toBe(0)
    noteDeletedDocuments(2, CLIENT, 'Arved')
    noteDeletedDocuments(-5, CLIENT, 'Arved')
    expect(deletedSinceBackup(CLIENT, 'Arved')).toBe(0)
  })

  it('keeps deletions made while a backup runs for the next one', async () => {
    const mine = { ...auto('mine', '2026-10-14T10:00:00Z'), device: getBackupDeviceId(), issued: 2 }
    vi.mocked(listDriveBackups).mockResolvedValue([mine])
    data = backup({ invoices: [issuedInvoice('a'), issuedInvoice('b')] })
    // Deleted after the data was read: the uploaded version still has the document.
    const exportBackup = async () => {
      const exported = data
      noteDeletedDocuments(1, CLIENT, 'Arved')
      return exported
    }
    expect((await run({ exportBackup })).kind).toBe('uploaded')
    expect(deletedSinceBackup(CLIENT, 'Arved')).toBe(1)
    vi.mocked(listDriveBackups).mockResolvedValue([{ ...mine, id: 'v2', createdTime: '2026-10-15T11:23:05Z' }])
    data = backup({ invoices: [issuedInvoice('a')] })
    expect((await run()).kind).toBe('uploaded')
    expect(deletedSinceBackup(CLIENT, 'Arved')).toBe(0)
  })

  it('keeps the deletion count per destination and clears it on request', () => {
    noteDeletedDocuments(2, CLIENT, 'Arved')
    expect(deletedSinceBackup(CLIENT, 'Muu kaust')).toBe(0)
    expect(deletedSinceBackup('other-client', 'Arved')).toBe(0)
    noteDeletedDocuments(1, CLIENT, 'Muu kaust')
    expect(deletedSinceBackup(CLIENT, 'Muu kaust')).toBe(1)
    expect(deletedSinceBackup(CLIENT, 'Arved')).toBe(0)
    clearDeletedDocuments()
    expect(deletedSinceBackup(CLIENT, 'Muu kaust')).toBe(0)
  })

  it('records the deletion records of a version in Drive', async () => {
    data = backup({ invoices: [issuedInvoice('a')], deleted: [{ id: 'b', number: 'b', type: 'invoice', deletedAt: '2026-10-15T09:00:00Z' }] })
    expect(await run()).toMatchObject({ kind: 'uploaded', file: { issued: 1, deleted: 1 } })
    expect(vi.mocked(uploadBackupVersion).mock.calls[0][6]).toMatchObject({ issued: 1, deleted: 1 })
  })

  it('holds the first background backup of an empty browser when Drive has another computer’s backups', async () => {
    const good = { ...auto('good', '2026-10-14T10:00:00Z'), device: 'old-pc', issued: 40 }
    vi.mocked(listDriveBackups).mockResolvedValue([good])
    data = backup({ invoices: [draftInvoice('d1')] })
    expect(await run()).toEqual({ kind: 'held', hold: { local: 0, existing: 40 } })
    expect(uploadBackupVersion).not.toHaveBeenCalled()
    expect(trashDriveFile).not.toHaveBeenCalled()
    // Not recorded as backed up: the next run checks again.
    expect((await run()).kind).toBe('held')

    // "Back up anyway" uploads, tagged, and trashes nothing.
    const res = await run({ interactive: true, settings: { enabled: true, encrypt: false, keepVersions: 1 } })
    expect(res).toMatchObject({ kind: 'uploaded', pruned: 0, file: { device: getBackupDeviceId(), issued: 0 } })
    expect(trashDriveFile).not.toHaveBeenCalled()
  })

  it('holds a background backup after an older file was restored over newer data', async () => {
    const mine = (id: string, time: string, issued: number) => ({ ...auto(id, time), device: getBackupDeviceId(), issued })
    vi.mocked(listDriveBackups).mockResolvedValue([mine('a', '2026-10-14T10:00:00Z', 2)])
    data = backup({ invoices: [issuedInvoice('i1')] })
    expect(await run()).toEqual({ kind: 'held', hold: { local: 1, existing: 2 } })
    data = backup({ invoices: [issuedInvoice('i1'), issuedInvoice('i2'), draftInvoice('d')] })
    expect(await run()).toMatchObject({ kind: 'uploaded', file: { issued: 2 } })
    expect(vi.mocked(uploadBackupVersion).mock.calls[0][6]).toEqual({ device: getBackupDeviceId(), issued: 2, deleted: 0 })
  })

  it('uploads an encrypted version when encryption is switched on, and reports superseded plaintext versions', async () => {
    vi.mocked(listDriveBackups).mockResolvedValue([auto('plain', '2026-10-14T10:00:00Z')])
    vi.mocked(uploadBackupVersion).mockImplementation(async (_c, _f, name, _content, encrypted) => ({ id: 'new', name, encrypted, automatic: true, createdTime: '2026-10-15T11:23:05Z' }))
    data = backup({ invoices: [issuedInvoice('i1')] })
    expect((await run()).kind).toBe('uploaded')
    expect(await run()).toEqual({ kind: 'unchanged' })
    const settings = { enabled: true, encrypt: true, keepVersions: 10 }
    const res = await run({ settings, passphrase: 'salajane parool' })
    expect(res).toMatchObject({ kind: 'uploaded', file: { encrypted: true }, plaintextVersions: 1 })
    expect(await run({ settings, passphrase: 'salajane parool' })).toEqual({ kind: 'unchanged' })
  })

  it('moves superseded plaintext versions to the trash on request', async () => {
    vi.mocked(listDriveBackups).mockResolvedValue([
      { ...auto('enc', '2026-10-15T10:00:00Z'), encrypted: true },
      auto('p1', '2026-10-14T10:00:00Z'),
      auto('p2', '2026-10-13T10:00:00Z'),
    ])
    setPlaintextVersionCount(2)
    expect(await trashPlaintextVersions(CLIENT, 'Arved')).toBe(2)
    expect(vi.mocked(trashDriveFile).mock.calls.map((c) => c[1])).toEqual(['p1', 'p2'])
    expect(getPlaintextVersionCount()).toBe(0)
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
