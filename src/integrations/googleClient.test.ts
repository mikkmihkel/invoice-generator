import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSettings, type AppSettings } from '../domain'
import {
  autoSavePdfEnabled,
  availableScopes,
  builtInGoogleConfig,
  canSendWithGmail,
  chosenDriveFolder,
  driveFolderLabel,
  driveFolderRef,
  driveFolderUrl,
  effectiveClientId,
  isBuiltInClientId,
  ownClientId,
  pickerConfig,
  usesBuiltInClient,
} from './googleClient'

const BUILT_IN = '111-shared.apps.googleusercontent.com'
const OWN = '222-own.apps.googleusercontent.com'

function env(values: { clientId?: string; apiKey?: string; appId?: string }) {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', values.clientId ?? '')
  vi.stubEnv('VITE_GOOGLE_API_KEY', values.apiKey ?? '')
  vi.stubEnv('VITE_GOOGLE_APP_ID', values.appId ?? '')
}

const settings = (patch: Partial<AppSettings> = {}): AppSettings => ({ ...createDefaultSettings(), ...patch })

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('client resolution', () => {
  it('uses the built-in client when the user has none of their own', () => {
    env({ clientId: ` ${BUILT_IN} ` })
    expect(builtInGoogleConfig().clientId).toBe(BUILT_IN)
    expect(effectiveClientId(settings())).toBe(BUILT_IN)
    expect(usesBuiltInClient(settings())).toBe(true)
    expect(ownClientId(settings())).toBeUndefined()
  })

  it('lets the user’s own client ID override the built-in one', () => {
    env({ clientId: BUILT_IN })
    const s = settings({ googleClientId: ` ${OWN} ` })
    expect(effectiveClientId(s)).toBe(OWN)
    expect(usesBuiltInClient(s)).toBe(false)
    expect(ownClientId(s)).toBe(OWN)
  })

  it('has no client at all without either (local development)', () => {
    env({})
    expect(effectiveClientId(settings())).toBeUndefined()
    expect(usesBuiltInClient(settings())).toBe(false)
    expect(availableScopes(settings())).toEqual([])
    expect(canSendWithGmail(settings())).toBe(false)
  })

  it('works with only the user’s own client (self-hosted without build variables)', () => {
    env({})
    const s = settings({ googleClientId: OWN })
    expect(effectiveClientId(s)).toBe(OWN)
    expect(availableScopes(s)).toEqual(['drive', 'gmail'])
  })
})

describe('scope gating', () => {
  it('offers only Drive with the built-in client, and Gmail with the user’s own client', () => {
    env({ clientId: BUILT_IN })
    expect(availableScopes(settings())).toEqual(['drive'])
    expect(canSendWithGmail(settings())).toBe(false)
    expect(availableScopes(settings({ googleClientId: OWN }))).toEqual(['drive', 'gmail'])
    expect(canSendWithGmail(settings({ googleClientId: OWN }))).toBe(true)
  })

  it('does not treat the built-in client ID pasted into Settings as an own client', () => {
    env({ clientId: BUILT_IN })
    const s = settings({ googleClientId: BUILT_IN })
    expect(ownClientId(s)).toBeUndefined()
    expect(canSendWithGmail(s)).toBe(false)
    expect(isBuiltInClientId(BUILT_IN)).toBe(true)
    expect(isBuiltInClientId(OWN)).toBe(false)
    expect(isBuiltInClientId(undefined)).toBe(false)
  })
})

describe('picker configuration', () => {
  it('needs the built-in client, an API key and an app ID', () => {
    env({ clientId: BUILT_IN, apiKey: 'AIza-key', appId: '123456' })
    expect(pickerConfig(settings())).toEqual({ apiKey: 'AIza-key', appId: '123456' })
    // The built-in key and app ID belong to another project than the user's own client.
    expect(pickerConfig(settings({ googleClientId: OWN }))).toBeNull()
    // The built-in ID pasted into Settings is still the built-in client.
    expect(pickerConfig(settings({ googleClientId: ` ${BUILT_IN} ` }))).toEqual({ apiKey: 'AIza-key', appId: '123456' })
    env({ clientId: BUILT_IN, apiKey: 'AIza-key' })
    expect(pickerConfig(settings())).toBeNull()
    env({ apiKey: 'AIza-key', appId: '123456' })
    expect(pickerConfig(settings())).toBeNull()
  })
})

describe('Drive folders', () => {
  it('keeps the name-based folder of earlier versions until a folder is chosen', () => {
    const s = settings({ driveFolderName: 'Minu arved' })
    expect(driveFolderRef(s, 'pdf')).toBe('Minu arved')
    expect(driveFolderRef(s, 'backup')).toBe('Minu arved')
    expect(driveFolderLabel(s, 'backup')).toBe('Minu arved')
    expect(driveFolderRef(settings({ driveFolderName: '  ' }), 'pdf')).toBe('Arved')
  })

  it('stores the chosen folder by ID and puts PDFs and backups in fixed subfolders', () => {
    env({ clientId: BUILT_IN })
    const s = settings({ driveFolderName: 'Minu arved', driveFolder: { id: 'folder-123456', name: 'Firma', clientId: BUILT_IN } })
    expect(driveFolderRef(s, 'pdf')).toEqual({ parentId: 'folder-123456', name: 'Arved' })
    expect(driveFolderRef(s, 'backup')).toEqual({ parentId: 'folder-123456', name: 'Varukoopiad' })
    expect(driveFolderLabel(s, 'pdf')).toBe('Firma / Arved')
    expect(driveFolderLabel(s, 'backup')).toBe('Firma / Varukoopiad')
    expect(driveFolderUrl('folder-123456')).toBe('https://drive.google.com/drive/folders/folder-123456')
  })

  it('saves PDFs automatically only with a chosen folder, a client and the option not switched off', () => {
    env({ clientId: BUILT_IN })
    const folder = { id: 'folder-123456', name: 'Firma', clientId: BUILT_IN }
    expect(autoSavePdfEnabled(settings())).toBe(false)
    expect(autoSavePdfEnabled(settings({ driveFolder: folder }))).toBe(true)
    expect(autoSavePdfEnabled(settings({ driveFolder: folder, autoSavePdf: false }))).toBe(false)
    env({})
    expect(autoSavePdfEnabled(settings({ driveFolder: folder }))).toBe(false)
  })

  it('counts a folder as chosen only with the client it was chosen with (drive.file is per client)', () => {
    env({ clientId: BUILT_IN })
    const folder = { id: 'folder-123456', name: 'Firma', clientId: BUILT_IN }
    expect(chosenDriveFolder(settings({ driveFolder: folder }))).toEqual(folder)
    // Switched to an own client: back to the named folder, nothing fails with "folder not found".
    const own = settings({ driveFolder: folder, googleClientId: OWN, driveFolderName: 'Minu arved' })
    expect(chosenDriveFolder(own)).toBeUndefined()
    expect(driveFolderRef(own, 'backup')).toBe('Minu arved')
    expect(driveFolderLabel(own, 'pdf')).toBe('Minu arved')
    expect(autoSavePdfEnabled(own)).toBe(false)
    // A folder stored without its client counts as not chosen.
    expect(chosenDriveFolder(settings({ driveFolder: { id: 'folder-123456', name: 'Firma' } }))).toBeUndefined()
  })
})
