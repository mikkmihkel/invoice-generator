import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSettings, type AppSettings } from '../domain'
import { findDriveFolders, listDriveBackups, listDriveBackupsIn, type DriveBackupFile } from './drive'
import { listRestorableBackups } from './restoreList'

vi.mock('./drive', () => ({
  listDriveBackups: vi.fn(async () => []),
  listDriveBackupsIn: vi.fn(async () => []),
  findDriveFolders: vi.fn(async () => []),
}))

const CLIENT = '222-own.apps.googleusercontent.com'
const chosen = { id: 'chosen-123456', name: 'Firma', clientId: CLIENT }
const settings = (patch: Partial<AppSettings> = {}): AppSettings => ({ ...createDefaultSettings(), googleClientId: CLIENT, ...patch })
const file = (id: string, createdTime: string): DriveBackupFile => ({ id, name: `${id}.json`, createdTime, encrypted: false, automatic: true })

beforeEach(() => {
  vi.mocked(listDriveBackups).mockReset().mockResolvedValue([])
  vi.mocked(listDriveBackupsIn).mockReset().mockResolvedValue([])
  vi.mocked(findDriveFolders).mockReset().mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('listRestorableBackups', () => {
  it('lists only the named folder before a folder is chosen', async () => {
    vi.mocked(listDriveBackups).mockResolvedValue([file('a', '2026-10-01T10:00:00Z')])
    const files = await listRestorableBackups(CLIENT, settings({ driveFolderName: 'Minu arved' }))
    expect(listDriveBackups).toHaveBeenCalledWith(CLIENT, 'Minu arved', undefined)
    expect(findDriveFolders).not.toHaveBeenCalled()
    expect(files.map((f) => f.id)).toEqual(['a'])
    expect(files[0].location).toBeUndefined()
  })

  it('also lists the earlier name-based folder once a folder is chosen, newest first and labelled by location', async () => {
    vi.mocked(listDriveBackups).mockResolvedValue([file('new', '2026-10-10T10:00:00Z')])
    // The chosen folder's own "Arved" subfolder (PDFs) has the same name and is skipped.
    vi.mocked(findDriveFolders).mockResolvedValue([
      { id: 'old-folder', parents: ['root'] },
      { id: 'pdf-sub', parents: [chosen.id] },
    ])
    vi.mocked(listDriveBackupsIn).mockResolvedValue([file('old', '2026-09-01T10:00:00Z'), file('older', '2026-08-01T10:00:00Z')])
    const files = await listRestorableBackups(CLIENT, settings({ driveFolder: chosen }), { interactive: false })
    expect(listDriveBackups).toHaveBeenCalledWith(CLIENT, { parentId: chosen.id, name: 'Varukoopiad' }, { interactive: false })
    expect(findDriveFolders).toHaveBeenCalledWith(CLIENT, 'Arved', { interactive: false })
    expect(listDriveBackupsIn).toHaveBeenCalledTimes(1)
    expect(listDriveBackupsIn).toHaveBeenCalledWith(CLIENT, 'old-folder', { interactive: false })
    expect(files.map((f) => [f.id, f.location])).toEqual([
      ['new', 'Firma / Varukoopiad'],
      ['old', 'Arved'],
      ['older', 'Arved'],
    ])
  })

  it('finds old backups even when the new folder has none yet', async () => {
    vi.mocked(findDriveFolders).mockResolvedValue([{ id: 'old-folder', parents: ['root'] }])
    vi.mocked(listDriveBackupsIn).mockResolvedValue([file('old', '2026-09-01T10:00:00Z')])
    const files = await listRestorableBackups(CLIENT, settings({ driveFolder: chosen, driveFolderName: 'Raamatupidamine' }))
    expect(findDriveFolders).toHaveBeenCalledWith(CLIENT, 'Raamatupidamine', undefined)
    expect(files).toEqual([expect.objectContaining({ id: 'old', location: 'Raamatupidamine' })])
  })

  it('keeps the current folder’s backups when the earlier folder cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(listDriveBackups).mockResolvedValue([file('new', '2026-10-10T10:00:00Z')])
    vi.mocked(findDriveFolders).mockRejectedValue(new Error('offline'))
    const files = await listRestorableBackups(CLIENT, settings({ driveFolder: chosen }))
    expect(files.map((f) => f.id)).toEqual(['new'])
  })
})
