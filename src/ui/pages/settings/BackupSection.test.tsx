import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSettings, type AppSettings } from '../../../domain'
import { getAutoBackupStatus, setAutoBackupStatus, setBackupPassphrase, setPlaintextVersionCount } from '../../../integrations/autoBackup'
import { encryptText } from '../../../integrations/backupCrypto'
import { downloadDriveFile, listDriveBackups, trashDriveFile, uploadBackupVersion, type DriveBackupFile } from '../../../integrations/drive'
import { googleSignIn, hasAccessToken } from '../../../integrations/googleAuth'
import { AppProvider } from '../../AppContext'
import { ConfirmProvider } from '../../components/Dialog'
import { createMemoryRepo, sampleProfile } from '../../testing/memoryRepo'
import { ToastProvider } from '../../Toasts'
import { useAutoBackup } from '../../useAutoBackup'
import { BackupSection } from './BackupSection'

vi.mock('../../../registry', async () => (await import('../../testing/mocks')).registryMock())
vi.mock('../../../integrations/drive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../integrations/drive')>()),
  uploadBackupVersion: vi.fn(async (_c: string, _f: string, name: string, _content: string, encrypted: boolean) => ({ id: 'v1', name, encrypted, automatic: true })),
  listDriveBackups: vi.fn(async () => []),
  downloadDriveFile: vi.fn(async () => ''),
  trashDriveFile: vi.fn(async () => undefined),
}))
vi.mock('../../../integrations/googleAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../integrations/googleAuth')>()),
  googleSignIn: vi.fn(async () => ({ configured: true, signedIn: true })),
  hasAccessToken: vi.fn(() => false),
}))

const CLIENT_ID = '123456-abc.apps.googleusercontent.com'

const FAST = { debounceMs: 20, minIntervalMs: 0, tokenPollMs: 20 }

function Shell() {
  const prompt = useAutoBackup(FAST)
  return (
    <>
      <BackupSection />
      {prompt}
    </>
  )
}

function setup(settings: Partial<AppSettings> = {}) {
  const repo = createMemoryRepo({ profile: sampleProfile(), settings: { ...createDefaultSettings(), googleClientId: CLIENT_ID, ...settings } })
  render(
    <AppProvider repository={repo}>
      <ToastProvider>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </ToastProvider>
    </AppProvider>,
  )
  return repo
}

const savedAutoBackup = (repo: ReturnType<typeof createMemoryRepo>) => repo.saveSettings.mock.calls.at(-1)?.[0].autoBackup

beforeEach(() => {
  window.location.hash = '#/settings'
  localStorage.clear()
  setBackupPassphrase(null)
  setAutoBackupStatus({ phase: 'idle' })
  setPlaintextVersionCount(0)
  vi.mocked(listDriveBackups).mockReset()
  vi.mocked(listDriveBackups).mockResolvedValue([])
  vi.mocked(trashDriveFile).mockClear()
  vi.mocked(hasAccessToken).mockReturnValue(false)
  vi.mocked(googleSignIn).mockClear()
  vi.mocked(uploadBackupVersion).mockClear()
})
afterEach(async () => {
  cleanup()
  // A background run still in flight would report into the next test.
  await waitFor(() => expect(getAutoBackupStatus().phase).not.toBe('running'))
})

describe('automatic backup settings', () => {
  it('needs a Google client ID first, and points to the Google section on the same page', async () => {
    const google = document.createElement('section')
    google.id = 'set-google'
    const input = document.createElement('input')
    google.append(input)
    document.body.append(google)
    setup({ googleClientId: undefined })
    expect(await screen.findByText(/lisa jaotises „Google Drive ja Gmail“ oma OAuth-kliendi ID/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ava Google’i seaded' }))
    expect(input).toHaveFocus()
    expect(window.location.hash).toBe('#/settings')
    google.remove()
    expect(screen.getByRole('checkbox', { name: 'Varunda automaatselt pärast muudatusi' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Varunda nüüd' })).toBeDisabled()
  })

  it('turns automatic backup on and connects Google from the click', async () => {
    const repo = setup()
    expect(await screen.findByText(/Raamatupidamise seaduse järgi tuleb arveid säilitada seitse aastat/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Varunda automaatselt pärast muudatusi' }))
    await waitFor(() => expect(savedAutoBackup(repo)).toEqual({ enabled: true, encrypt: false, keepVersions: 10 }))
    expect(googleSignIn).toHaveBeenCalledWith(CLIENT_ID, ['drive'])

    fireEvent.change(screen.getByLabelText('Säilita viimased'), { target: { value: '25' } })
    await waitFor(() => expect(savedAutoBackup(repo)).toMatchObject({ keepVersions: 25 }))
  })

  it('asks for a passphrase twice before turning encryption on, and keeps it out of storage', async () => {
    const repo = setup({ autoBackup: { enabled: true, encrypt: false, keepVersions: 10 } })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Krüpteeri parooliga' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Varukoopiate parool' }))
    fireEvent.change(dialog.getByLabelText('Parool'), { target: { value: 'lühike' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Kinnita' }))
    expect(dialog.getByText('Parool peab olema vähemalt 8 märki pikk.')).toBeInTheDocument()
    fireEvent.change(dialog.getByLabelText('Parool'), { target: { value: 'pikk parool 1' } })
    fireEvent.change(dialog.getByLabelText('Korda parooli'), { target: { value: 'pikk parool 2' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Kinnita' }))
    expect(dialog.getByText('Paroolid ei ühti.')).toBeInTheDocument()
    fireEvent.change(dialog.getByLabelText('Korda parooli'), { target: { value: 'pikk parool 1' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Kinnita' }))
    await waitFor(() => expect(savedAutoBackup(repo)).toMatchObject({ encrypt: true }))
    expect(screen.getByText('Parool on selle seansi jaoks sisestatud.')).toBeInTheDocument()
    expect(JSON.stringify(repo.saveSettings.mock.calls)).not.toContain('pikk parool')
    expect(JSON.stringify(localStorage)).not.toContain('pikk parool')
  })

  it('backs up on request and records the time', async () => {
    const repo = setup({ autoBackup: { enabled: true, encrypt: false, keepVersions: 10 } })
    fireEvent.click(await screen.findByRole('button', { name: 'Varunda nüüd' }))
    await waitFor(() => expect(uploadBackupVersion).toHaveBeenCalledTimes(1))
    expect(googleSignIn).toHaveBeenCalledWith(CLIENT_ID, ['drive'])
    expect(vi.mocked(uploadBackupVersion).mock.calls[0][2]).toMatch(/^arveldaja-backup-\d{4}-\d{2}-\d{2}-\d{6}\.json$/)
    await waitFor(() => expect(savedAutoBackup(repo)?.lastBackupAt).toBeTruthy())
    expect(await screen.findByText(/Varukoopia salvestatud Drive’i/)).toBeInTheDocument()
    expect(await screen.findByText(/Viimane automaatne varundus:/)).toBeInTheDocument()
  })

  it('restores an encrypted backup through the usual import review', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    const json = JSON.stringify(await repo.exportBackup())
    const envelope = await encryptText(json, 'taasta mind')
    vi.mocked(listDriveBackups).mockResolvedValueOnce([
      { id: 'enc', name: 'arvegeneraator-backup-2026-10-15-142305.json.enc', createdTime: '2026-10-15T11:23:05Z', size: 3000, encrypted: true, automatic: true },
      { id: 'old', name: 'invoice-generator-backup.json', modifiedTime: '2026-09-01T10:00:00Z', encrypted: false, automatic: false },
    ])
    vi.mocked(downloadDriveFile).mockResolvedValueOnce(envelope).mockResolvedValueOnce(envelope)
    setup({ autoBackup: { enabled: true, encrypt: true, keepVersions: 10 } })
    fireEvent.click(await screen.findByRole('button', { name: 'Taasta Drive’ist' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Taasta varukoopia Drive’ist' }))
    expect(dialog.getAllByRole('radio')).toHaveLength(2)
    expect(dialog.getByText(/2,9 kB · krüpteeritud/)).toBeInTheDocument()
    expect(dialog.getByText('käsitsi salvestatud')).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Jätka' })).toBeDisabled()

    fireEvent.change(dialog.getByLabelText('Varukoopia parool'), { target: { value: 'vale parool' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Jätka' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('Kontrolli parooli')

    fireEvent.change(dialog.getByLabelText('Varukoopia parool'), { target: { value: 'taasta mind' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Jätka' }))
    expect(await screen.findByRole('dialog', { name: 'Impordi varukoopia' }, { timeout: 8000 })).toBeInTheDocument()
  }, 15_000)
})

describe('background backup', () => {
  it('reminds once outside Settings that backups wait for Google, and backs up from the reminder', async () => {
    window.location.hash = '#/'
    setup({ autoBackup: { enabled: true, encrypt: false, keepVersions: 10 } })
    const toasts = within(document.querySelector<HTMLElement>('.toasts')!)
    expect(await toasts.findByText('Automaatne varundus ootab: Google’i konto pole selles seansis ühendatud.')).toBeInTheDocument()
    fireEvent.click(toasts.getByRole('button', { name: 'Varunda nüüd' }))
    expect(googleSignIn).toHaveBeenCalledWith(CLIENT_ID, ['drive'])
    await waitFor(() => expect(uploadBackupVersion).toHaveBeenCalledTimes(1))
    expect(vi.mocked(uploadBackupVersion).mock.calls[0][5]).toBeUndefined()
    expect(await toasts.findByText(/Varukoopia salvestatud Drive’i/)).toBeInTheDocument()

    cleanup()
    vi.mocked(hasAccessToken).mockReturnValue(false)
    setup({ autoBackup: { enabled: true, encrypt: false, keepVersions: 10 } })
    expect(await screen.findByText(/Varundus ootab: Google’i konto ei ole/)).toBeInTheDocument()
    expect(screen.queryByText('Automaatne varundus ootab: Google’i konto pole selles seansis ühendatud.')).not.toBeInTheDocument()
  })

  it('waits without a popup when there is no Google token, and runs once a token appears', async () => {
    setup({ autoBackup: { enabled: true, encrypt: false, keepVersions: 10 } })
    expect(await screen.findByText(/Varundus ootab: Google’i konto ei ole selles seansis ühendatud/)).toBeInTheDocument()
    expect(googleSignIn).not.toHaveBeenCalled()
    expect(uploadBackupVersion).not.toHaveBeenCalled()

    vi.mocked(hasAccessToken).mockReturnValue(true)
    await waitFor(() => expect(uploadBackupVersion).toHaveBeenCalledTimes(1))
    expect(vi.mocked(uploadBackupVersion).mock.calls[0][5]).toEqual({ interactive: false })
    await waitFor(() => expect(screen.queryByText(/Varundus ootab/)).not.toBeInTheDocument())
  })

  it('asks for the passphrase before the first encrypted backup of the session', async () => {
    vi.mocked(hasAccessToken).mockReturnValue(true)
    setup({ autoBackup: { enabled: true, encrypt: true, keepVersions: 10 } })
    const dialog = within(await screen.findByRole('dialog', { name: 'Sisesta varukoopiate parool' }))
    expect(uploadBackupVersion).not.toHaveBeenCalled()
    fireEvent.click(dialog.getByRole('button', { name: 'Hiljem' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/Varundus ootab krüpteerimise parooli/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Varunda nüüd' }))
    const again = within(screen.getByRole('dialog', { name: 'Sisesta varukoopiate parool' }))
    fireEvent.change(again.getByLabelText('Parool'), { target: { value: 'pikk parool' } })
    fireEvent.change(again.getByLabelText('Korda parooli'), { target: { value: 'pikk parool' } })
    fireEvent.click(again.getByRole('button', { name: 'Kinnita' }))
    await waitFor(() => expect(uploadBackupVersion).toHaveBeenCalledTimes(1))
    expect(vi.mocked(uploadBackupVersion).mock.calls[0][2]).toMatch(/\.json\.enc$/)
  })
})

describe('protecting existing backups', () => {
  const good: DriveBackupFile = { id: 'good', name: 'arvegeneraator-backup-2026-10-14-100000.json', createdTime: '2026-10-14T07:00:00Z', encrypted: false, automatic: true, device: 'old-pc', issued: 40 }
  const empty: DriveBackupFile = { id: 'empty', name: 'arvegeneraator-backup-2026-10-15-100000.json', createdTime: '2026-10-15T07:00:00Z', encrypted: false, automatic: true, device: 'other-pc', issued: 0 }

  it('does not back up an empty browser over another computer’s backups, and offers restore or an explicit backup', async () => {
    vi.mocked(hasAccessToken).mockReturnValue(true)
    vi.mocked(listDriveBackups).mockResolvedValue([empty, good])
    setup({ autoBackup: { enabled: true, encrypt: false, keepVersions: 10 } })
    expect(await screen.findByText(/Automaatne varundus on peatatud: Drive’is on varukoopia, milles on rohkem väljastatud dokumente \(40\) kui selles brauseris \(0\)/)).toBeInTheDocument()
    expect(uploadBackupVersion).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Taasta' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Taasta varukoopia Drive’ist' }))
    const radios = dialog.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.checked)).toEqual([false, true])
    expect(dialog.getByText(/väljastatud dokumente: 40/)).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'Loobu' }))

    fireEvent.click(screen.getByRole('button', { name: 'Varunda siiski' }))
    const confirm = within(await screen.findByRole('dialog', { name: 'Kas varundada siiski?' }))
    fireEvent.click(confirm.getByRole('button', { name: 'Varunda' }))
    await waitFor(() => expect(uploadBackupVersion).toHaveBeenCalledTimes(1))
    expect(vi.mocked(uploadBackupVersion).mock.calls[0][5]).toBeUndefined()
    await waitFor(() => expect(screen.queryByText(/Automaatne varundus on peatatud/)).not.toBeInTheDocument())
    expect(trashDriveFile).not.toHaveBeenCalled()
  })

  it('offers to move plaintext versions to the trash after the first encrypted backup', async () => {
    const plain: DriveBackupFile = { ...good, id: 'plain', createdTime: '2020-01-01T00:00:00Z', issued: 0 }
    const enc: DriveBackupFile = { ...good, id: 'enc', name: 'arvegeneraator-backup-2026-10-15-100000.json.enc', createdTime: '2026-10-15T07:00:00Z', encrypted: true, issued: 0 }
    vi.mocked(hasAccessToken).mockReturnValue(true)
    vi.mocked(listDriveBackups).mockResolvedValueOnce([plain]).mockResolvedValue([enc, plain])
    setBackupPassphrase('pikk parool')
    setup({ autoBackup: { enabled: true, encrypt: true, keepVersions: 10 } })
    expect(await screen.findByText(/Drive’is on veel krüpteerimata automaatseid varukoopiaid \(1\)/)).toBeInTheDocument()
    expect(vi.mocked(uploadBackupVersion).mock.calls[0][4]).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Vii krüpteerimata varukoopiad prügikasti' }))
    const confirm = within(await screen.findByRole('dialog', { name: 'Kas viia krüpteerimata varukoopiad prügikasti?' }))
    fireEvent.click(confirm.getByRole('button', { name: 'Vii prügikasti' }))
    expect(await screen.findByText('Krüpteerimata varukoopiad viidi prügikasti (1).')).toBeInTheDocument()
    expect(vi.mocked(trashDriveFile).mock.calls.map((c) => c[1])).toEqual(['plain'])
    expect(screen.queryByText(/krüpteerimata automaatseid varukoopiaid/)).not.toBeInTheDocument()
  })
})
