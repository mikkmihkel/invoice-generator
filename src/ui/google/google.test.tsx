import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { createDefaultSettings, newId, type AppSettings, type BackupFile, type Invoice } from '../../domain'
import { googleSignIn as barrelSignIn, uploadToDrive } from '../../integrations'
import { getBackupPassphrase, setBackupPassphrase } from '../../integrations/autoBackup'
import { findOrCreateAppFolder, listDriveBackups, downloadDriveFile, type DriveBackupFile } from '../../integrations/drive'
import type { GisTokenClientConfig, GoogleGlobal } from '../../integrations/gis-types'
import { __resetGoogleAuthForTests, SCOPE_URLS } from '../../integrations/googleAuth'
import { pickDriveFolder } from '../../integrations/picker'
import { serializeBackup } from '../../storage'
import { AppProvider, useApp } from '../AppContext'
import { createMemoryRepo, sampleProfile } from '../testing/memoryRepo'
import { ToastProvider } from '../Toasts'
import { addDaysISO, localTodayISO } from '../util'
import { __resetNudgeForTests } from './nudge'
import { useAutoSavePdf } from './useAutoSavePdf'

vi.mock('../../registry', async () => (await import('../testing/mocks')).registryMock())
vi.mock('../../pdf', async () => (await import('../testing/mocks')).pdfMock())
vi.mock('../../integrations', async () => (await import('../testing/mocks')).integrationsMock())
vi.mock('../../einvoice', async () => (await import('../testing/mocks')).einvoiceMock())
vi.mock('../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../storage')>()),
  getRepository: () => {
    throw new Error('tests pass a repository explicitly')
  },
  subscribe: () => () => undefined,
}))
// Fake Drive: no network.
vi.mock('../../integrations/drive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../integrations/drive')>()),
  findOrCreateAppFolder: vi.fn(),
  listDriveBackups: vi.fn(async () => []),
  downloadDriveFile: vi.fn(async () => ''),
  uploadBackupVersion: vi.fn(async (_c: string, _f: unknown, name: string) => ({ id: 'v1', name, encrypted: false, automatic: true })),
  trashDriveFile: vi.fn(async () => undefined),
}))
vi.mock('../../integrations/picker', () => ({ pickDriveFolder: vi.fn() }))

const BUILT_IN = '111-shared.apps.googleusercontent.com'
const OWN = '222-own.apps.googleusercontent.com'
const FOLDER = { id: 'folder-123456', name: 'Firma', clientId: BUILT_IN }

/** Fake Google Identity Services (token model) answering every request with the requested scopes. */
let gisRequests: GisTokenClientConfig[]
function installFakeGis() {
  gisRequests = []
  const google: GoogleGlobal = {
    accounts: {
      oauth2: {
        initTokenClient: (config) => ({
          requestAccessToken: () => {
            gisRequests.push(config)
            queueMicrotask(() => config.callback({ access_token: `tok-${gisRequests.length}`, expires_in: 3599, scope: config.scope }))
          },
        }),
        hasGrantedAllScopes: (resp, ...scopes) => scopes.every((s) => resp.scope.split(' ').includes(s)),
        hasGrantedAnyScope: () => true,
        revoke: (_t, done) => done?.({ successful: true }),
      },
    },
  }
  window.google = google
}

function env(values: { clientId?: string; apiKey?: string; appId?: string } = {}) {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', values.clientId ?? '')
  vi.stubEnv('VITE_GOOGLE_API_KEY', values.apiKey ?? '')
  vi.stubEnv('VITE_GOOGLE_APP_ID', values.appId ?? '')
}

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

beforeEach(() => {
  localStorage.clear()
  setBackupPassphrase(null)
  __resetGoogleAuthForTests()
  __resetNudgeForTests()
  installFakeGis()
  // Only the userinfo call of the sign-in reaches fetch; anything else would be network in a test.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/oauth2/v3/userinfo')) return new Response(JSON.stringify({ email: 'omanik@gmail.com' }), { status: 200 })
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
  vi.mocked(findOrCreateAppFolder).mockReset()
  vi.mocked(findOrCreateAppFolder).mockResolvedValue({ id: 'app-folder-1', name: 'Arveldaja', created: true })
  vi.mocked(listDriveBackups).mockReset()
  vi.mocked(listDriveBackups).mockResolvedValue([])
  vi.mocked(pickDriveFolder).mockReset()
  vi.mocked(uploadToDrive).mockClear()
  vi.mocked(barrelSignIn).mockClear()
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
  delete window.google
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

const settings = (patch: Partial<AppSettings> = {}): AppSettings => ({ ...createDefaultSettings(), ...patch })
const lastSaved = (repo: ReturnType<typeof createMemoryRepo>) => repo.saveSettings.mock.calls.at(-1)?.[0]

describe('onboarding: Google Drive step', () => {
  it('is left out when no Google client is available (local development)', async () => {
    env()
    renderAt('#/', createMemoryRepo())
    expect(await screen.findByRole('heading', { level: 2, name: 'Ettevõte' })).toBeInTheDocument()
    expect(screen.queryByText('Salvesta oma Google Drive’i (soovitatav)')).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Seadistamise sammud' })).getAllByRole('listitem')).toHaveLength(3)
  })

  it('comes first with the built-in client, explains the benefits and lets the user continue without an account', async () => {
    env({ clientId: BUILT_IN })
    renderAt('#/', createMemoryRepo())
    expect(await screen.findByRole('heading', { level: 2, name: 'Salvesta oma Google Drive’i (soovitatav)' })).toBeInTheDocument()
    const steps = within(screen.getByRole('list', { name: 'Seadistamise sammud' })).getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    expect(steps[0]).toHaveTextContent('1Google Drive')
    expect(screen.getByText('Teises arvutis logid sisse ja saad kõik andmed tagasi.')).toBeInTheDocument()
    expect(screen.getByText(/Meie serverisse ei saadeta midagi/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Logi sisse Google’iga' })).toHaveClass('btn-primary')
    fireEvent.click(screen.getByRole('button', { name: 'Jätka ilma kontota' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Ettevõte' })).toBeInTheDocument()
    expect(gisRequests).toHaveLength(0)
    // And back again.
    fireEvent.click(screen.getByRole('button', { name: 'Tagasi' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Salvesta oma Google Drive’i (soovitatav)' })).toBeInTheDocument()
  })

  it('signs in with non-sensitive scopes only, creates the app folder when the Picker is not configured, stores it by ID and turns on backups', async () => {
    env({ clientId: BUILT_IN })
    const repo = createMemoryRepo()
    renderAt('#/', repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Logi sisse Google’iga' }))
    const dialog = await screen.findByRole('dialog', { name: 'Vali Drive’i kaust' })
    expect(gisRequests[0].client_id).toBe(BUILT_IN)
    expect(gisRequests[0].scope.split(' ').sort()).toEqual(['email', 'openid', SCOPE_URLS.drive].sort())
    expect(within(dialog).getByText(/alamkausta „Arved“ ja varukoopiad alamkausta „Varukoopiad“/)).toBeInTheDocument()
    // No API key / app ID: no Picker, creating the folder is the way.
    expect(within(dialog).queryByRole('button', { name: 'Vali kaust Drive’ist' })).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Loo kaust „Arveldaja“' }))
    })
    expect(findOrCreateAppFolder).toHaveBeenCalledWith(BUILT_IN, 'Arveldaja')
    expect(lastSaved(repo)).toMatchObject({ driveFolder: { id: 'app-folder-1', name: 'Arveldaja', clientId: BUILT_IN }, autoBackup: { enabled: true, encrypt: false }, autoSavePdf: true })
    // Looks for backups in the new folder's backup subfolder (none here), then goes on to the company.
    expect(listDriveBackups).toHaveBeenCalledWith(BUILT_IN, { parentId: 'app-folder-1', name: 'Varukoopiad' })
    expect(await screen.findByRole('heading', { level: 2, name: 'Ettevõte' })).toBeInTheDocument()
    const toast = await screen.findByText(/Sinu Drive’i loodi kaust „Arveldaja“/)
    expect(within(toast.closest('.toast') as HTMLElement).getByRole('link', { name: 'Ava Drive’is' })).toHaveAttribute('href', 'https://drive.google.com/drive/folders/app-folder-1')
  })

  it('offers to restore a backup found in the chosen folder on a new computer', async () => {
    env({ clientId: BUILT_IN })
    const source = createMemoryRepo({ profile: sampleProfile() })
    const json = serializeBackup(await source.exportBackup())
    const file: DriveBackupFile = { id: 'b1', name: 'arveldaja-backup-2026-10-14-101500.json', createdTime: '2026-10-14T10:15:00Z', encrypted: false, automatic: true, issued: 3 }
    vi.mocked(findOrCreateAppFolder).mockResolvedValue({ id: 'app-folder-1', name: 'Arveldaja', created: false })
    vi.mocked(listDriveBackups).mockResolvedValue([file])
    vi.mocked(downloadDriveFile).mockResolvedValue(json)
    const repo = createMemoryRepo()
    renderAt('#/', repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Logi sisse Google’iga' }))
    const folderDialog = await screen.findByRole('dialog', { name: 'Vali Drive’i kaust' })
    await act(async () => {
      fireEvent.click(within(folderDialog).getByRole('button', { name: 'Loo kaust „Arveldaja“' }))
    })
    const offer = await screen.findByRole('dialog', { name: 'Drive’ist leiti varukoopiad' })
    expect(within(offer).getByText(/Kui jätkad teises arvutis, vali varukoopia/)).toBeInTheDocument()
    expect(within(offer).getByText('väljastatud dokumente: 3', { exact: false })).toBeInTheDocument()
    expect(within(offer).getByRole('button', { name: 'Alusta tühjalt' })).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(offer).getByRole('button', { name: 'Jätka' }))
    })
    expect(downloadDriveFile).toHaveBeenCalledWith(BUILT_IN, 'b1')
    const review = await screen.findByRole('dialog', { name: 'Impordi varukoopia' })
    fireEvent.click(within(review).getByRole('checkbox', { name: 'Olen muudatused üle vaadanud ja kinnitan need' }))
    await act(async () => {
      fireEvent.click(within(review).getByRole('button', { name: 'Ühenda' }))
    })
    expect(repo.importBackup).toHaveBeenCalledTimes(1)
    // The folder chosen on this computer is kept.
    const [imported] = repo.importBackup.mock.calls[0] as unknown as [BackupFile]
    expect(imported.settings).toMatchObject({ driveFolder: { id: 'app-folder-1', name: 'Arveldaja' } })
  })

  it('starts from scratch when the user declines the restore', async () => {
    env({ clientId: BUILT_IN })
    vi.mocked(listDriveBackups).mockResolvedValue([{ id: 'b1', name: 'arveldaja-backup.json', encrypted: false, automatic: false }])
    renderAt('#/', createMemoryRepo())
    fireEvent.click(await screen.findByRole('button', { name: 'Logi sisse Google’iga' }))
    const folderDialog = await screen.findByRole('dialog', { name: 'Vali Drive’i kaust' })
    await act(async () => {
      fireEvent.click(within(folderDialog).getByRole('button', { name: 'Loo kaust „Arveldaja“' }))
    })
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Drive’ist leiti varukoopiad' })).getByRole('button', { name: 'Alusta tühjalt' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Ettevõte' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('folder dialog options', () => {
  async function openFolderDialog(repo: ReturnType<typeof createMemoryRepo>) {
    renderAt('#/', repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Logi sisse Google’iga' }))
    return screen.findByRole('dialog', { name: 'Vali Drive’i kaust' })
  }

  it('shows automatic backup as a ticked option with advice to encrypt, and saves what the user chose', async () => {
    env({ clientId: BUILT_IN })
    const repo = createMemoryRepo()
    const dialog = await openFolderDialog(repo)
    const backup = within(dialog).getByRole('checkbox', { name: /Varunda automaatselt sellesse kausta/ })
    expect(backup).toBeChecked()
    expect(within(dialog).getByText(/Varukoopiad on krüpteerimata/)).toBeInTheDocument()
    const pdf = within(dialog).getByRole('checkbox', { name: 'Salvesta väljastatud arvete PDF-failid sellesse kausta' })
    expect(pdf).toBeChecked()
    fireEvent.click(backup)
    fireEvent.click(pdf)
    expect(within(dialog).queryByText(/Varukoopiad on krüpteerimata/)).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Loo kaust „Arveldaja“' }))
    })
    expect(lastSaved(repo)).toMatchObject({ autoBackup: { enabled: false }, autoSavePdf: false })
  })

  it('sets a passphrase from the dialog, so the first backups are already encrypted', async () => {
    env({ clientId: BUILT_IN })
    const repo = createMemoryRepo()
    const dialog = await openFolderDialog(repo)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Määra parool' }))
    const pass = await screen.findByRole('dialog', { name: 'Varukoopiate parool' })
    fireEvent.change(within(pass).getByLabelText('Parool'), { target: { value: 'pikk parool 1' } })
    fireEvent.change(within(pass).getByLabelText('Korda parooli'), { target: { value: 'pikk parool 1' } })
    fireEvent.click(within(pass).getByRole('button', { name: 'Kinnita' }))
    expect(await within(dialog).findByText('Varukoopiad krüpteeritakse sinu parooliga.')).toBeInTheDocument()
    expect(getBackupPassphrase()).toBe('pikk parool 1')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Loo kaust „Arveldaja“' }))
    })
    expect(lastSaved(repo)).toMatchObject({ autoBackup: { enabled: true, encrypt: true } })
  })

  it('starts from the earlier decision when automatic backup was switched off before', async () => {
    env({ clientId: BUILT_IN })
    const dialog = await openFolderDialog(createMemoryRepo({ settings: settings({ autoBackup: { enabled: false, encrypt: false, keepVersions: 10 } }) }))
    expect(within(dialog).getByRole('checkbox', { name: /Varunda automaatselt sellesse kausta/ })).not.toBeChecked()
  })
})

describe('choosing the Drive folder with the Google Picker', () => {
  it('opens the Picker with the token, API key and app ID, and stores the picked folder by ID', async () => {
    env({ clientId: BUILT_IN, apiKey: 'AIza-key', appId: '123456' })
    vi.mocked(pickDriveFolder).mockResolvedValue({ id: 'picked-123456', name: 'Raamatupidamine' })
    const repo = createMemoryRepo()
    renderAt('#/', repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Logi sisse Google’iga' }))
    const dialog = await screen.findByRole('dialog', { name: 'Vali Drive’i kaust' })
    const pick = within(dialog).getByRole('button', { name: 'Vali kaust Drive’ist' })
    expect(pick).toHaveClass('btn-primary')
    await act(async () => {
      fireEvent.click(pick)
    })
    expect(pickDriveFolder).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'tok-1', apiKey: 'AIza-key', appId: '123456', locale: 'et' }))
    expect(lastSaved(repo)).toMatchObject({ driveFolder: { id: 'picked-123456', name: 'Raamatupidamine' } })
    expect(await screen.findByText('Failid salvestatakse kausta „Raamatupidamine“.')).toBeInTheDocument()
  })

  it('falls back to creating the folder when the Picker fails', async () => {
    env({ clientId: BUILT_IN, apiKey: 'AIza-key', appId: '123456' })
    vi.mocked(pickDriveFolder).mockRejectedValue(new Error('blocked'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const repo = createMemoryRepo()
    renderAt('#/', repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Logi sisse Google’iga' }))
    const first = await screen.findByRole('dialog', { name: 'Vali Drive’i kaust' })
    await act(async () => {
      fireEvent.click(within(first).getByRole('button', { name: 'Vali kaust Drive’ist' }))
    })
    const dialog = await screen.findByRole('dialog', { name: 'Vali Drive’i kaust' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Kausta valikut ei õnnestunud avada. Loo selle asemel kaust „Arveldaja“.')
    expect(within(dialog).queryByRole('button', { name: 'Vali kaust Drive’ist' })).not.toBeInTheDocument()
    const create = within(dialog).getByRole('button', { name: 'Loo kaust „Arveldaja“' })
    expect(create).toHaveClass('btn-primary')
    await act(async () => {
      fireEvent.click(create)
    })
    expect(lastSaved(repo)).toMatchObject({ driveFolder: { id: 'app-folder-1', name: 'Arveldaja' } })
  })

  it('does not use the Picker with the user’s own client (the built-in key belongs to another project)', async () => {
    env({ clientId: BUILT_IN, apiKey: 'AIza-key', appId: '123456' })
    const repo = createMemoryRepo({ profile: sampleProfile(), settings: settings({ googleClientId: OWN }) })
    renderAt('#/settings', repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Vali kaust' }))
    const dialog = await screen.findByRole('dialog', { name: 'Vali Drive’i kaust' })
    expect(within(dialog).queryByRole('button', { name: 'Vali kaust Drive’ist' })).not.toBeInTheDocument()
    // The user's own client asks for Gmail as well.
    expect(gisRequests[0].client_id).toBe(OWN)
    expect(gisRequests[0].scope).toContain(SCOPE_URLS.gmail)
  })
})

describe('app shell', () => {
  it('nudges towards Drive until dismissed, and remembers the dismissal', async () => {
    env({ clientId: BUILT_IN })
    const repo = createMemoryRepo({ profile: sampleProfile() })
    renderAt('#/', repo)
    const nudge = (await screen.findByText('Hoia arveid ja varukoopiaid oma Google Drive’is')).closest('aside')!
    expect(within(nudge).getByRole('button', { name: 'Logi sisse Google’iga' })).toBeInTheDocument()
    fireEvent.click(within(nudge).getByRole('button', { name: 'Peida 30 päevaks' }))
    expect(screen.queryByText('Hoia arveid ja varukoopiaid oma Google Drive’is')).not.toBeInTheDocument()
    expect(localStorage.getItem('arveldaja:driveNudgeDismissedAt')).toBeTruthy()
    cleanup()
    renderAt('#/products', repo)
    expect(await screen.findByRole('heading', { level: 1, name: 'Tooted ja teenused' })).toBeInTheDocument()
    expect(screen.queryByText('Hoia arveid ja varukoopiaid oma Google Drive’is')).not.toBeInTheDocument()
  })

  it('shows neither nudge nor account chip without a Google client', async () => {
    env()
    renderAt('#/products', createMemoryRepo({ profile: sampleProfile() }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Tooted ja teenused' })).toBeInTheDocument()
    expect(screen.queryByText('Hoia arveid ja varukoopiaid oma Google Drive’is')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Google’i konto/ })).not.toBeInTheDocument()
  })

  it('shows the signed-in account in the top bar after signing in from the nudge, with sign-out', async () => {
    env({ clientId: BUILT_IN })
    renderAt('#/products', createMemoryRepo({ profile: sampleProfile(), settings: settings({ driveFolder: FOLDER }) }))
    const nudge = (await screen.findByText('Hoia arveid ja varukoopiaid oma Google Drive’is')).closest('aside')!
    await act(async () => {
      fireEvent.click(within(nudge).getByRole('button', { name: 'Logi sisse Google’iga' }))
    })
    // A folder was already chosen: no folder dialog, the nudge gives way to the account chip.
    const chip = await screen.findByRole('button', { name: 'Google’i konto omanik@gmail.com' })
    expect(screen.queryByText('Hoia arveid ja varukoopiaid oma Google Drive’is')).not.toBeInTheDocument()
    fireEvent.click(chip)
    expect(screen.getByRole('menuitem', { name: 'Ava Drive’i kaust' })).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Logi välja' }))
    })
    expect(await screen.findByText('Google’i kontost välja logitud. Andmed jäävad sellesse brauserisse.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Google’i konto/ })).not.toBeInTheDocument()
  })

  it('keeps the account in the chip after a reload, marked as not connected in this session', async () => {
    env({ clientId: BUILT_IN })
    localStorage.setItem('invoice-generator.google', JSON.stringify({ clientId: BUILT_IN, email: 'omanik@gmail.com' }))
    renderAt('#/products', createMemoryRepo({ profile: sampleProfile() }))
    const chip = await screen.findByRole('button', { name: 'Google’i konto omanik@gmail.com, Selles seansis pole ühendatud' })
    expect(chip).toHaveClass('acct-idle')
    fireEvent.click(chip)
    expect(screen.getByRole('menuitem', { name: 'Ühenda uuesti' })).toBeInTheDocument()
    expect(screen.queryByText('Hoia arveid ja varukoopiaid oma Google Drive’is')).not.toBeInTheDocument()
  })
})

describe('Settings → Google', () => {
  it('without any client: explains it and opens the advanced own-client fields', async () => {
    env()
    renderAt('#/settings', createMemoryRepo({ profile: sampleProfile() }))
    expect(await screen.findByText(/Selles versioonis pole Google’i sisselogimine seadistatud/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^OAuth-kliendi ID/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Logi sisse Google’iga' })).not.toBeInTheDocument()
  })

  it('with the built-in client: account, folder of earlier versions until one is chosen, PDF option needs a folder', async () => {
    env({ clientId: BUILT_IN })
    renderAt('#/settings', createMemoryRepo({ profile: sampleProfile(), settings: settings({ driveFolderName: 'Minu arved' }) }))
    const section = (await screen.findByRole('heading', { name: 'Google’i konto ja Drive' })).closest('section')!
    expect(within(section).getByText('Sisse logimata. Andmed on ainult selles brauseris.')).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Logi sisse Google’iga' })).toBeInTheDocument()
    expect(within(section).getByText('Kausta pole valitud. Seni kasutatakse kausta „Minu arved“.')).toBeInTheDocument()
    expect(within(section).getByRole('checkbox', { name: /Salvesta väljastatud arvete PDF-failid automaatselt Drive’i/ })).toBeDisabled()
    expect(within(section).getByText('Täpsemad seaded: oma OAuth-kliendi ID (Gmailiga saatmiseks)').closest('details')).not.toHaveAttribute('open')
  })

  it('with a chosen folder: shows it with its subfolders and a Drive link, and the PDF option can be switched off', async () => {
    env({ clientId: BUILT_IN })
    const repo = createMemoryRepo({ profile: sampleProfile(), settings: settings({ driveFolder: FOLDER, autoBackup: { enabled: true, encrypt: false, keepVersions: 10 } }) })
    renderAt('#/settings', repo)
    const section = (await screen.findByRole('heading', { name: 'Google’i konto ja Drive' })).closest('section')!
    expect(within(section).getByText('PDF-failid: Firma / Arved · varukoopiad: Firma / Varukoopiad')).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Ava Drive’is' })).toHaveAttribute('href', 'https://drive.google.com/drive/folders/folder-123456')
    expect(within(section).getByText('Sees, kausta „Firma / Varukoopiad“')).toBeInTheDocument()
    const pdf = within(section).getByRole('checkbox', { name: /Salvesta väljastatud arvete PDF-failid automaatselt Drive’i/ })
    expect(pdf).toBeChecked()
    await act(async () => {
      fireEvent.click(pdf)
    })
    expect(lastSaved(repo)).toMatchObject({ autoSavePdf: false })
  })
})

describe('folder and client', () => {
  it('forgets a folder chosen with the built-in client when the user saves an own client ID', async () => {
    env({ clientId: BUILT_IN })
    const repo = createMemoryRepo({ profile: sampleProfile(), settings: settings({ driveFolder: FOLDER }) })
    renderAt('#/settings', repo)
    const section = (await screen.findByRole('heading', { name: 'Google’i konto ja Drive' })).closest('section')!
    expect(within(section).getByText('PDF-failid: Firma / Arved · varukoopiad: Firma / Varukoopiad')).toBeInTheDocument()
    fireEvent.change(within(section).getByLabelText(/^OAuth-kliendi ID/), { target: { value: OWN } })
    await act(async () => {
      fireEvent.click(within(section).getByRole('button', { name: 'Salvesta' }))
    })
    expect(lastSaved(repo)).toMatchObject({ googleClientId: OWN, driveFolder: undefined })
    expect(await within(section).findByText('Kausta pole valitud. Seni kasutatakse kausta „Arved“.')).toBeInTheDocument()
  })

  it('treats a folder chosen with another client as not chosen instead of failing', async () => {
    env({ clientId: BUILT_IN })
    renderAt('#/settings', createMemoryRepo({ profile: sampleProfile(), settings: settings({ driveFolder: { ...FOLDER, clientId: OWN } }) }))
    const section = (await screen.findByRole('heading', { name: 'Google’i konto ja Drive' })).closest('section')!
    expect(within(section).getByText('Kausta pole valitud. Seni kasutatakse kausta „Arved“.')).toBeInTheDocument()
    expect(within(section).getByRole('checkbox', { name: /Salvesta väljastatud arvete PDF-failid automaatselt Drive’i/ })).toBeDisabled()
  })
})

describe('Gmail', () => {
  const today = localTodayISO()
  const profile = sampleProfile()
  const issued = (): Invoice => ({
    id: newId(),
    number: '2026-0004',
    type: 'invoice',
    status: 'issued',
    issueDate: addDaysISO(today, -3),
    dueDate: addDaysISO(today, 11),
    seller: { ...profile },
    buyer: { kind: 'company', name: 'Kalda Puutöö OÜ', email: 'arved@kalda.ee', address: { street: 'Pärnu mnt 140', city: 'Tallinn', postalCode: '11317', country: 'EE' } },
    bankAccountIds: [],
    lines: [{ id: newId(), description: 'Arendus', quantity: 1, unit: 'h', unitPrice: 65, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic',
    language: 'et',
    templateId: 'classic',
    accentColor: '#2457c5',
    issuedAt: addDaysISO(today, -3) + 'T09:00:00Z',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
  })

  async function openEmail(s: AppSettings) {
    renderAt('#/', createMemoryRepo({ profile, settings: s, invoices: [issued()] }))
    const article = (await screen.findByRole('heading', { level: 2, name: /^Arve 2026-0004/ })).closest('article')!
    fireEvent.click(within(within(article).getByRole('group', { name: 'Arve toimingud' })).getByRole('button', { name: 'Saada e-kirjaga' }))
    return screen.findByRole('dialog', { name: 'Saada arve 2026-0004' })
  }

  it('is not offered with the built-in client: e-mail goes through the share sheet or the mail app', async () => {
    env({ clientId: BUILT_IN })
    const dialog = await openEmail(settings())
    expect(within(dialog).queryByRole('button', { name: 'Saada Gmailiga' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Ava e-posti rakendus' })).toBeInTheDocument()
    expect(within(dialog).getByText(/Otse Gmailiga saatmise saad seadistada seadetes/)).toBeInTheDocument()
  })

  it('is offered with the user’s own client ID', async () => {
    env({ clientId: BUILT_IN })
    const dialog = await openEmail(settings({ googleClientId: OWN }))
    expect(within(dialog).getByRole('button', { name: 'Saada Gmailiga' })).toBeInTheDocument()
  })
})

describe('saving issued invoices’ PDFs to Drive', () => {
  function draft(patch: Partial<Invoice> = {}): Invoice {
    const p = sampleProfile()
    return {
      id: 'inv-1',
      number: '',
      type: 'invoice',
      status: 'draft',
      issueDate: localTodayISO(),
      dueDate: addDaysISO(localTodayISO(), 14),
      seller: { ...p },
      buyer: { kind: 'company', name: 'Kalda Puutöö OÜ', address: { street: 'Pärnu mnt 140', city: 'Tallinn', postalCode: '11317', country: 'EE' } },
      bankAccountIds: [],
      lines: [{ id: 'l1', description: 'Arendus', quantity: 1, unit: 'h', unitPrice: 65, vatRate: 24 }],
      currency: 'EUR',
      vatScheme: 'domestic',
      language: 'et',
      templateId: 'classic',
      accentColor: '#2457c5',
      createdAt: '2026-01-05T10:00:00Z',
      updatedAt: '2026-01-05T10:00:00Z',
      ...patch,
    }
  }

  function Harness() {
    useAutoSavePdf()
    const { issueInvoice, invoices } = useApp()
    const inv = invoices.find((i) => i.id === 'inv-1')
    return (
      <>
        <button type="button" onClick={() => void issueInvoice('inv-1')}>
          Väljasta
        </button>
        <p>staatus {inv?.status}</p>
      </>
    )
  }

  function setup(s: Partial<AppSettings>, inv = draft()) {
    const repo = createMemoryRepo({ profile: sampleProfile(), settings: settings(s), invoices: [inv] })
    render(
      <AppProvider repository={repo}>
        <ToastProvider>
          <Harness />
        </ToastProvider>
      </AppProvider>,
    )
    return repo
  }

  const issue = async () => {
    await screen.findByText('staatus draft')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Väljasta' }))
    })
    expect(await screen.findByText('staatus issued')).toBeInTheDocument()
  }

  it('uploads the PDF in the background into the chosen folder’s "Arved" subfolder', async () => {
    env({ clientId: BUILT_IN })
    setup({ driveFolder: FOLDER })
    await issue()
    await waitFor(() => expect(uploadToDrive).toHaveBeenCalledTimes(1))
    const [clientId, blob, name, folder, options] = vi.mocked(uploadToDrive).mock.calls[0]
    expect([clientId, name, folder, options]).toEqual([BUILT_IN, 'Arve_2026-0001.pdf', { parentId: FOLDER.id, name: 'Arved' }, { interactive: false }])
    expect(blob).toBeInstanceOf(Blob)
    expect(await screen.findByText('PDF-fail on salvestatud Google Drive’i kausta „Firma / Arved“')).toBeInTheDocument()
  })

  it('never blocks issuing: without a token it waits for the user, and the toast button signs in and saves', async () => {
    env({ clientId: BUILT_IN })
    vi.mocked(uploadToDrive).mockRejectedValueOnce(Object.assign(new Error('expired'), { code: 'unauthorized' }))
    setup({ driveFolder: FOLDER })
    await issue()
    const warning = await screen.findByText(/^Arve 2026-0001: PDF-faili ei salvestatud Drive’i/)
    await act(async () => {
      fireEvent.click(within(warning.closest('.toast') as HTMLElement).getByRole('button', { name: 'Logi sisse ja salvesta' }))
    })
    expect(barrelSignIn).toHaveBeenCalledWith(BUILT_IN, ['drive'])
    await waitFor(() => expect(uploadToDrive).toHaveBeenCalledTimes(2))
    expect(vi.mocked(uploadToDrive).mock.calls[1][4]).toEqual({})
  })

  it('offers to try again after a Drive error', async () => {
    env({ clientId: BUILT_IN })
    vi.mocked(uploadToDrive).mockRejectedValueOnce(new Error('Drive is down'))
    setup({ driveFolder: FOLDER })
    await issue()
    const error = await screen.findByText(/^Arve 2026-0001: PDF-faili ei õnnestunud Drive’i salvestada\. Drive is down/)
    await act(async () => {
      fireEvent.click(within(error.closest('.toast') as HTMLElement).getByRole('button', { name: 'Proovi uuesti' }))
    })
    await waitFor(() => expect(uploadToDrive).toHaveBeenCalledTimes(2))
  })

  it('does nothing when switched off, without a chosen folder, or for quotes', async () => {
    env({ clientId: BUILT_IN })
    setup({ driveFolder: FOLDER, autoSavePdf: false })
    await issue()
    cleanup()
    setup({})
    await issue()
    cleanup()
    setup({ driveFolder: FOLDER }, draft({ type: 'quote' }))
    await issue()
    await act(async () => {})
    expect(uploadToDrive).not.toHaveBeenCalled()
  })
})
