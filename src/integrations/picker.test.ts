import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetPickerForTests, GAPI_SCRIPT_URL, pickDriveFolder, type PickerNamespace } from './picker'

type Callback = (data: { action: string; docs?: { id: string; name?: string }[] }) => void

interface Built {
  config: Record<string, unknown>
  view: Record<string, unknown>
  callback: Callback
  visible: boolean
  disposed: boolean
}
let built: Built[]

/** A fake google.picker with the builder calls recorded. */
function fakePicker(): PickerNamespace {
  class DocsView {
    settings: Record<string, unknown> = {}
    constructor(viewId?: string) {
      this.settings.viewId = viewId
    }
    setIncludeFolders(v: boolean) {
      this.settings.includeFolders = v
      return this
    }
    setSelectFolderEnabled(v: boolean) {
      this.settings.selectFolder = v
      return this
    }
    setMimeTypes(v: string) {
      this.settings.mimeTypes = v
      return this
    }
  }
  class PickerBuilder {
    config: Record<string, unknown> = {}
    view: DocsView | undefined
    cb: Callback = () => {}
    addView(v: DocsView) {
      this.view = v
      return this
    }
    setOAuthToken(v: string) {
      this.config.token = v
      return this
    }
    setDeveloperKey(v: string) {
      this.config.key = v
      return this
    }
    setAppId(v: string) {
      this.config.appId = v
      return this
    }
    setLocale(v: string) {
      this.config.locale = v
      return this
    }
    setTitle(v: string) {
      this.config.title = v
      return this
    }
    setCallback(cb: Callback) {
      this.cb = cb
      return this
    }
    build() {
      const b: Built = { config: this.config, view: this.view!.settings, callback: this.cb, visible: false, disposed: false }
      built.push(b)
      return {
        setVisible: (v: boolean) => {
          b.visible = v
        },
        dispose: () => {
          b.disposed = true
        },
      }
    }
  }
  return {
    DocsView: DocsView as unknown as PickerNamespace['DocsView'],
    PickerBuilder: PickerBuilder as unknown as PickerNamespace['PickerBuilder'],
    ViewId: { FOLDERS: 'folders' },
    Action: { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' },
  }
}

type W = { gapi?: unknown; google?: { picker?: PickerNamespace } }
const w = () => window as unknown as W

const OPTIONS = { accessToken: 'tok', apiKey: 'AIza-key', appId: '123456', locale: 'et' as const, title: 'Vali kaust' }

beforeEach(() => {
  built = []
  __resetPickerForTests()
})
afterEach(() => {
  delete w().gapi
  delete w().google
  document.head.querySelectorAll(`script[src="${GAPI_SCRIPT_URL}"]`).forEach((s) => s.remove())
  vi.useRealTimers()
})

/** Answer the on-demand script load: api.js defines gapi, whose load('picker') defines google.picker. */
async function serveScript(ok = true) {
  await vi.waitFor(() => expect(document.head.querySelector(`script[src="${GAPI_SCRIPT_URL}"]`)).not.toBeNull())
  const script = document.head.querySelector<HTMLScriptElement>(`script[src="${GAPI_SCRIPT_URL}"]`)!
  if (!ok) {
    script.dispatchEvent(new Event('error'))
    return
  }
  w().gapi = {
    load: (_name: string, cfg: { callback: () => void }) => {
      w().google = { ...(w().google ?? {}), picker: fakePicker() }
      cfg.callback()
    },
  }
  script.dispatchEvent(new Event('load'))
}

describe('Google Picker', () => {
  it('loads api.js on demand and shows a folder view with the token, key, app ID and language', async () => {
    const pick = pickDriveFolder(OPTIONS)
    await serveScript()
    await vi.waitFor(() => expect(built).toHaveLength(1))
    expect(built[0].visible).toBe(true)
    expect(built[0].config).toEqual({ token: 'tok', key: 'AIza-key', appId: '123456', locale: 'et', title: 'Vali kaust' })
    expect(built[0].view).toEqual({ viewId: 'folders', includeFolders: true, selectFolder: true, mimeTypes: 'application/vnd.google-apps.folder' })
    built[0].callback({ action: 'loaded' })
    built[0].callback({ action: 'picked', docs: [{ id: 'folder-1', name: 'Raamatupidamine' }] })
    await expect(pick).resolves.toEqual({ id: 'folder-1', name: 'Raamatupidamine' })
    expect(built[0].disposed).toBe(true)
  })

  it('resolves null when the user cancels', async () => {
    w().google = { picker: fakePicker() }
    const pick = pickDriveFolder(OPTIONS)
    await vi.waitFor(() => expect(built).toHaveLength(1))
    built[0].callback({ action: 'cancel' })
    await expect(pick).resolves.toBeNull()
  })

  it('fails (so the app can offer to create a folder instead) when the script cannot load', async () => {
    const pick = pickDriveFolder(OPTIONS)
    await serveScript(false)
    await expect(pick).rejects.toMatchObject({ code: 'picker_failed' })
  })

  it('closes a picker that never loads (e.g. a blocked frame) and fails', async () => {
    w().google = { picker: fakePicker() }
    const pick = pickDriveFolder({ ...OPTIONS, loadTimeoutMs: 30 })
    await expect(pick).rejects.toMatchObject({ code: 'picker_failed' })
    expect(built[0].disposed).toBe(true)
  })
})
