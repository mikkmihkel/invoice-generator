import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GisTokenClientConfig, GisTokenResponse, GoogleGlobal } from './gis-types'
import {
  __resetGoogleAuthForTests,
  getAccessToken,
  getGoogleStatus,
  getGrantedScopes,
  googleSignIn,
  googleSignOut,
  invalidateToken,
  SCOPE_URLS,
} from './googleAuth'

const CLIENT = 'client.apps.googleusercontent.com'

interface Request {
  config: GisTokenClientConfig
  prompt: string | undefined
}
let requests: Request[]
/** How the fake GIS answers the next token request. */
let respond: (config: GisTokenClientConfig) => void
let revoke: ReturnType<typeof vi.fn>

function grant(extraScopes?: string) {
  return (config: GisTokenClientConfig) => {
    const scope = extraScopes ?? config.scope
    config.callback({ access_token: `tok-${requests.length}`, expires_in: 3599, scope } as GisTokenResponse)
  }
}

beforeEach(() => {
  __resetGoogleAuthForTests()
  requests = []
  respond = grant()
  revoke = vi.fn((_t: string, done?: () => void) => done?.())
  const google: GoogleGlobal = {
    accounts: {
      oauth2: {
        initTokenClient: (config) => ({
          requestAccessToken: (o) => {
            requests.push({ config, prompt: o?.prompt })
            queueMicrotask(() => respond(config))
          },
        }),
        hasGrantedAllScopes: (resp, ...scopes) => scopes.every((s) => resp.scope.split(' ').includes(s)),
        hasGrantedAnyScope: (resp, ...scopes) => scopes.some((s) => resp.scope.split(' ').includes(s)),
        revoke: revoke as never,
      },
    },
  }
  window.google = google
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ email: 'omanik@gmail.com' }), { status: 200 })),
  )
})

afterEach(() => {
  delete window.google
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('token model', () => {
  it('reports not configured without a client id', async () => {
    expect(getGoogleStatus()).toEqual({ configured: false, signedIn: false, email: undefined })
    await expect(getAccessToken('  ', ['drive'])).rejects.toMatchObject({ code: 'not_configured' })
  })

  it('signs in with openid email + the requested scope and fetches the account email', async () => {
    const status = await googleSignIn(CLIENT, ['drive'])
    expect(status).toEqual({ configured: true, signedIn: true, email: 'omanik@gmail.com' })
    expect(requests).toHaveLength(1)
    expect(requests[0].config.client_id).toBe(CLIENT)
    expect(requests[0].config.scope.split(' ').sort()).toEqual(['email', 'openid', SCOPE_URLS.drive].sort())
    expect(requests[0].config.include_granted_scopes).toBe(true)
    expect(requests[0].prompt).toBeUndefined()
    expect(getGrantedScopes()).toEqual(['drive'])
  })

  it('reuses a valid token and adds scopes incrementally', async () => {
    const t1 = await getAccessToken(CLIENT, ['drive'])
    expect(await getAccessToken(CLIENT, ['drive'])).toBe(t1)
    expect(requests).toHaveLength(1)
    await getAccessToken(CLIENT, ['gmail'])
    expect(requests).toHaveLength(2)
    expect(requests[1].config.scope).toContain(SCOPE_URLS.drive)
    expect(requests[1].config.scope).toContain(SCOPE_URLS.gmail)
    expect(requests[1].prompt).toBe('')
    expect(requests[1].config.login_hint).toBe('omanik@gmail.com')
    expect(getGrantedScopes().sort()).toEqual(['drive', 'gmail'])
  })

  it('silently re-requests (prompt "") when the token expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await getAccessToken(CLIENT, ['drive'])
    vi.setSystemTime(Date.now() + 3600_000)
    expect(getGoogleStatus(CLIENT).signedIn).toBe(false)
    await getAccessToken(CLIENT, ['drive'])
    expect(requests).toHaveLength(2)
    expect(requests[1].prompt).toBe('')
  })

  it('requests a new token after invalidateToken (401 handling)', async () => {
    const t1 = await getAccessToken(CLIENT, ['drive'])
    invalidateToken()
    const t2 = await getAccessToken(CLIENT, ['drive'])
    expect(t2).not.toBe(t1)
  })

  it('shares one popup between concurrent callers', async () => {
    const [a, b] = await Promise.all([getAccessToken(CLIENT, ['drive']), getAccessToken(CLIENT, ['drive'])])
    expect(a).toBe(b)
    expect(requests).toHaveLength(1)
  })

  it('fails with insufficient_scope when the user unchecks a scope', async () => {
    respond = grant(`openid email ${SCOPE_URLS.drive}`)
    await expect(getAccessToken(CLIENT, ['gmail'])).rejects.toMatchObject({ code: 'insufficient_scope' })
  })

  it('maps GIS errors to friendly codes', async () => {
    respond = (c) => c.error_callback?.({ type: 'popup_failed_to_open' })
    await expect(getAccessToken(CLIENT, ['drive'])).rejects.toMatchObject({ code: 'popup_blocked' })
    respond = (c) => c.error_callback?.({ type: 'popup_closed' })
    const err = await getAccessToken(CLIENT, ['drive']).catch((e: { messages: { en: string } }) => e)
    expect(err).toMatchObject({ code: 'popup_closed' })
    expect((err as { messages: { en: string } }).messages.en).toContain('origin_mismatch')
    respond = (c) => c.callback({ error: 'access_denied' } as GisTokenResponse)
    await expect(getAccessToken(CLIENT, ['drive'])).rejects.toMatchObject({ code: 'access_denied' })
  })

  it('revokes the token on sign out', async () => {
    const token = await getAccessToken(CLIENT, ['drive'])
    await googleSignOut()
    expect(revoke).toHaveBeenCalledWith(token, expect.any(Function))
    expect(getGoogleStatus(CLIENT)).toEqual({ configured: true, signedIn: false, email: undefined })
  })

  it('revokes without GIS via a POST body, never with the token in the URL', async () => {
    const token = await getAccessToken(CLIENT, ['drive'])
    delete window.google
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await googleSignOut()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://oauth2.googleapis.com/revoke')
    expect(url).not.toContain(token)
    expect(init).toMatchObject({ method: 'POST', body: `token=${encodeURIComponent(token)}` })
  })

  it('loads the GIS script on demand', async () => {
    delete window.google
    const promise = getAccessToken(CLIENT, ['drive'])
    await Promise.resolve()
    const script = document.head.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')
    expect(script).not.toBeNull()
    script!.dispatchEvent(new Event('error'))
    await expect(promise).rejects.toMatchObject({ code: 'script_load_failed' })
    script!.remove()
  })
})
