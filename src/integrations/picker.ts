// Google Picker: lets the user choose a Drive folder. With the drive.file scope, picking a folder grants the app
// access to it, so PDFs and backups can be written there. Loaded on demand from apis.google.com (see the CSP in
// vite.config.ts). Reference: developers.google.com/drive/picker/reference
import { GoogleApiError } from './errors'

export const GAPI_SCRIPT_URL = 'https://apis.google.com/js/api.js'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
/** The picker reports 'loaded' once its frame is up; without it (blocked frame, bad key) it is closed again. */
const LOAD_TIMEOUT_MS = 20_000

// Minimal local types: only what this module uses.
interface PickerDoc {
  id: string
  name?: string
  mimeType?: string
}
interface PickerResponse {
  action: string
  docs?: PickerDoc[]
}
interface DocsView {
  setIncludeFolders(v: boolean): DocsView
  setSelectFolderEnabled(v: boolean): DocsView
  setMimeTypes(v: string): DocsView
}
interface Picker {
  setVisible(v: boolean): void
  dispose(): void
}
interface PickerBuilder {
  addView(view: DocsView): PickerBuilder
  setOAuthToken(token: string): PickerBuilder
  setDeveloperKey(key: string): PickerBuilder
  setAppId(id: string): PickerBuilder
  setLocale(locale: string): PickerBuilder
  setTitle(title: string): PickerBuilder
  setCallback(cb: (data: PickerResponse) => void): PickerBuilder
  build(): Picker
}
export interface PickerNamespace {
  DocsView: new (viewId?: string) => DocsView
  PickerBuilder: new () => PickerBuilder
  ViewId: { FOLDERS: string }
  Action: { PICKED: string; CANCEL: string; LOADED?: string }
}
interface GapiLoader {
  load(name: string, config: { callback: () => void; onerror?: () => void; timeout?: number; ontimeout?: () => void }): void
}
type PickerWindow = Window & { gapi?: GapiLoader; google?: { picker?: PickerNamespace } }

const win = () => window as PickerWindow

let loading: Promise<PickerNamespace> | null = null

function loadScript(): Promise<GapiLoader> {
  const existing = win().gapi
  if (existing?.load) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GAPI_SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => {
      const gapi = win().gapi
      if (gapi?.load) resolve(gapi)
      else reject(new GoogleApiError('picker_failed'))
    }
    script.onerror = () => reject(new GoogleApiError('picker_failed'))
    document.head.appendChild(script)
  })
}

/** Load the Picker library once, on demand. */
export function loadPicker(): Promise<PickerNamespace> {
  const ready = win().google?.picker
  if (ready) return Promise.resolve(ready)
  if (loading) return loading
  loading = loadScript().then(
    (gapi) =>
      new Promise<PickerNamespace>((resolve, reject) => {
        const fail = () => reject(new GoogleApiError('picker_failed'))
        gapi.load('picker', {
          callback: () => {
            const picker = win().google?.picker
            if (picker) resolve(picker)
            else fail()
          },
          onerror: fail,
          timeout: LOAD_TIMEOUT_MS,
          ontimeout: fail,
        })
      }),
  )
  loading.catch(() => {
    loading = null
  })
  return loading
}

export interface PickFolderOptions {
  accessToken: string
  apiKey: string
  appId: string
  locale: 'et' | 'en'
  title: string
  /** Close the picker and fail when it has not loaded by then (default 20 s). */
  loadTimeoutMs?: number
}

/** Show the Picker for folders. Resolves with the chosen folder, or null when the user cancelled. */
export async function pickDriveFolder(options: PickFolderOptions): Promise<{ id: string; name: string } | null> {
  const ns = await loadPicker()
  return new Promise((resolve, reject) => {
    let picker: Picker | undefined
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        picker?.dispose()
      } catch {
        // already gone
      }
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new GoogleApiError('picker_failed', { detail: 'timeout' }))), options.loadTimeoutMs ?? LOAD_TIMEOUT_MS)
    try {
      const view = new ns.DocsView(ns.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME)
      picker = new ns.PickerBuilder()
        .addView(view)
        .setOAuthToken(options.accessToken)
        .setDeveloperKey(options.apiKey)
        .setAppId(options.appId)
        .setLocale(options.locale)
        .setTitle(options.title)
        .setCallback((data) => {
          if (data.action === (ns.Action.LOADED ?? 'loaded')) {
            clearTimeout(timer)
            return
          }
          if (data.action === ns.Action.PICKED) {
            const doc = data.docs?.find((d) => d.id)
            finish(() => resolve(doc ? { id: doc.id, name: doc.name || doc.id } : null))
          } else if (data.action === ns.Action.CANCEL) finish(() => resolve(null))
        })
        .build()
      picker.setVisible(true)
    } catch (e) {
      finish(() => reject(new GoogleApiError('picker_failed', { detail: e instanceof Error ? e.message : String(e) })))
    }
  })
}

/** Test helper: forget the loaded library. */
export function __resetPickerForTests(): void {
  loading = null
}
