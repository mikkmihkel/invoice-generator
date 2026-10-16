// Google Identity Services, token model: short-lived access tokens kept in memory only.
// No refresh tokens, no client secret, no backend.
import { errorFromGis, GoogleApiError } from './errors'
import type { GisOauth2, GisTokenResponse } from './gis-types'
import { isBuiltInClientId } from './googleClient'
import type { GoogleStatus } from './types'

export type GoogleScope = 'drive' | 'gmail'

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'
export const SCOPE_URLS: Record<GoogleScope, string> = {
  drive: 'https://www.googleapis.com/auth/drive.file',
  gmail: 'https://www.googleapis.com/auth/gmail.send',
}
const IDENTITY_SCOPES = ['openid', 'email']
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const HINT_KEY = 'invoice-generator.google'
/** Treat tokens as expired a bit early to avoid failing mid-request. */
const EXPIRY_MARGIN_MS = 60_000

interface TokenState {
  clientId: string
  accessToken: string
  expiresAt: number
  scopes: Set<string>
  email?: string
}

let state: TokenState | null = null
let lastClientId: string | undefined
let gisPromise: Promise<GisOauth2> | null = null
let pending: Promise<string> | null = null

// Listeners for sign-in / sign-out (the account chip and Settings follow them).
const listeners = new Set<() => void>()
let version = 0
function changed() {
  version++
  for (const l of [...listeners]) l()
}

/** Called after every sign-in, token change and sign-out. */
export function subscribeGoogleAuth(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
/** Changes whenever the sign-in state changes (a snapshot for useSyncExternalStore). */
export function getGoogleAuthVersion(): number {
  return version
}

interface Hint {
  clientId: string
  email?: string
}

function readHint(clientId: string): Hint | null {
  try {
    const h = JSON.parse(localStorage.getItem(HINT_KEY) ?? 'null') as Hint | null
    return h && h.clientId === clientId ? h : null
  } catch {
    return null
  }
}
function writeHint(h: Hint | null) {
  try {
    if (h) localStorage.setItem(HINT_KEY, JSON.stringify(h))
    else localStorage.removeItem(HINT_KEY)
  } catch {
    // storage unavailable: only affects the silent re-auth hint
  }
}

/** Load the GIS client library once, on demand. */
export function loadGis(): Promise<GisOauth2> {
  if (typeof window !== 'undefined' && window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2)
  if (gisPromise) return gisPromise
  gisPromise = new Promise<GisOauth2>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new GoogleApiError('script_load_failed'))
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2
      if (oauth2) resolve(oauth2)
      else reject(new GoogleApiError('script_load_failed'))
    }
    script.onerror = () => reject(new GoogleApiError('script_load_failed'))
    document.head.appendChild(script)
  })
  gisPromise.catch(() => {
    gisPromise = null
  })
  return gisPromise
}

function requestToken(oauth2: GisOauth2, clientId: string, scopes: string[], prompt: string | undefined, loginHint?: string) {
  return new Promise<GisTokenResponse>((resolve, reject) => {
    let client
    try {
      client = oauth2.initTokenClient({
        client_id: clientId,
        scope: scopes.join(' '),
        include_granted_scopes: true,
        ...(loginHint ? { login_hint: loginHint } : {}),
        callback: (resp) => {
          if (resp.error) reject(errorFromGis(resp.error, resp.error_description))
          else resolve(resp)
        },
        error_callback: (err) => reject(errorFromGis(err.type, err.message)),
      })
    } catch (e) {
      reject(errorFromGis('unknown', e instanceof Error ? e.message : String(e)))
      return
    }
    client.requestAccessToken(prompt === undefined ? {} : { prompt })
  })
}

async function fetchEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return undefined
    const info = (await res.json()) as { email?: string }
    return info.email
  } catch {
    return undefined
  }
}

function tokenValid(clientId: string, scopeUrls: string[]): boolean {
  return (
    !!state &&
    state.clientId === clientId &&
    state.expiresAt > Date.now() &&
    scopeUrls.every((s) => state!.scopes.has(s))
  )
}

export interface TokenOptions {
  /** False: only use a token already in memory and never open the consent popup (background work). */
  interactive?: boolean
}

/** Whether a valid token for the scopes is in memory, i.e. a request can run without a popup. */
export function hasAccessToken(clientId: string | undefined, scopes: GoogleScope[]): boolean {
  const id = clientId?.trim()
  return !!id && tokenValid(id, scopes.map((s) => SCOPE_URLS[s]))
}

/**
 * Return a valid access token for the scopes, requesting one if needed. A request opens a GIS popup, so
 * call this (or googleSignIn) from a click handler before any long async work, or browsers may block it.
 * Already-granted scopes are re-requested silently (prompt '').
 */
export async function getAccessToken(clientId: string, scopes: GoogleScope[], options: TokenOptions = {}): Promise<string> {
  const id = clientId?.trim()
  if (!id) throw new GoogleApiError('not_configured')
  // The site's shared client asks only for non-sensitive scopes: Gmail needs the user's own client.
  if (scopes.includes('gmail') && isBuiltInClientId(id)) throw new GoogleApiError('gmail_needs_own_client')
  lastClientId = id
  if (state && state.clientId !== id) state = null
  const needed = scopes.map((s) => SCOPE_URLS[s])
  if (tokenValid(id, needed)) return state!.accessToken
  // Share one popup between concurrent callers, then re-check (the pending request may lack our scopes).
  while (pending) {
    await pending.catch(() => {})
    if (tokenValid(id, needed)) return state!.accessToken
  }
  if (options.interactive === false) throw new GoogleApiError('unauthorized')
  const run = (async () => {
    const oauth2 = await loadGis()
    const hint = readHint(id)
    const known = state ? [...state.scopes] : []
    const requested = [...new Set([...IDENTITY_SCOPES, ...known, ...needed])]
    const allGranted = state != null && needed.every((s) => state!.scopes.has(s))
    const prompt = hint || allGranted ? '' : undefined
    const resp = await requestToken(oauth2, id, requested, prompt, state?.email ?? hint?.email)
    const expiresIn = Number(resp.expires_in) || 3600
    const granted = new Set((resp.scope ?? '').split(/\s+/).filter(Boolean))
    const email = state?.email ?? (await fetchEmail(resp.access_token))
    state = {
      clientId: id,
      accessToken: resp.access_token,
      expiresAt: Date.now() + expiresIn * 1000 - EXPIRY_MARGIN_MS,
      scopes: granted,
      email,
    }
    writeHint({ clientId: id, email })
    changed()
    if (needed.length && !oauth2.hasGrantedAllScopes(resp, needed[0], ...needed.slice(1))) {
      throw new GoogleApiError('insufficient_scope')
    }
    return resp.access_token
  })()
  pending = run
  try {
    return await run
  } finally {
    pending = null
  }
}

/** Forget the current token (e.g. after a 401), so the next call requests a new one. */
export function invalidateToken(): void {
  if (state) state.expiresAt = 0
}

/** Remove a scope from the in-memory grant (e.g. after a 403 insufficient scope), forcing re-consent. */
export function forgetScope(scope: GoogleScope): void {
  state?.scopes.delete(SCOPE_URLS[scope])
}

/** Current status. Pass the configured client ID (from AppSettings) for an accurate `configured` flag. */
export function getGoogleStatus(clientId?: string): GoogleStatus {
  const id = (clientId ?? lastClientId)?.trim()
  const signedIn = !!state && state.expiresAt > Date.now() && (!id || state.clientId === id)
  return {
    configured: !!id,
    signedIn,
    email: signedIn ? state?.email : undefined,
  }
}

/**
 * The account last signed in with this client in this browser (kept after a reload, while the token itself is not),
 * or null. `email` may be missing when Google did not return it.
 */
export function rememberedGoogleAccount(clientId: string | undefined): { email?: string } | null {
  const id = clientId?.trim()
  if (!id) return null
  const hint = readHint(id)
  return hint ? { email: hint.email } : null
}

/** Granted Google scopes of the current token (for UI hints). */
export function getGrantedScopes(): GoogleScope[] {
  if (!state || state.expiresAt <= Date.now()) return []
  return (Object.keys(SCOPE_URLS) as GoogleScope[]).filter((s) => state!.scopes.has(SCOPE_URLS[s]))
}

/** Load GIS script on demand and request an access token with the given scopes (incremental consent). */
export async function googleSignIn(clientId: string, scopes: GoogleScope[]): Promise<GoogleStatus> {
  await getAccessToken(clientId, scopes)
  return getGoogleStatus(clientId)
}

/** Revoke the token (whole grant for this app) and forget it. */
export async function googleSignOut(): Promise<void> {
  const token = state?.accessToken
  state = null
  writeHint(null)
  changed()
  if (!token) return
  const oauth2 = typeof window !== 'undefined' ? window.google?.accounts?.oauth2 : undefined
  if (oauth2) {
    await new Promise<void>((resolve) => {
      try {
        oauth2.revoke(token, () => resolve())
      } catch {
        resolve()
      }
    })
    return
  }
  try {
    // Token in the body, not the URL (URLs end up in logs and history).
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    })
  } catch {
    // best effort
  }
}

/** Test helper: reset module state. */
export function __resetGoogleAuthForTests(): void {
  state = null
  lastClientId = undefined
  gisPromise = null
  pending = null
  writeHint(null)
  changed()
}
