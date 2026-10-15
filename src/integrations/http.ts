// Authenticated fetch for Google REST APIs (separate module so tests can mock the token source).
import { errorFromResponse, GoogleApiError } from './errors'
import { forgetScope, getAccessToken, invalidateToken, type GoogleScope, type TokenOptions } from './googleAuth'

/**
 * fetch() against a Google API with a bearer token. On 401 the token is renewed once and the
 * request retried (with `interactive: false` the renewal never opens a popup and fails instead). Non-2xx responses throw a GoogleApiError with a friendly bilingual message.
 */
export async function googleFetch(clientId: string, scopes: GoogleScope[], url: string, init: RequestInit = {}, options?: TokenOptions): Promise<Response> {
  const attempt = async () => {
    const token = await (options ? getAccessToken(clientId, scopes, options) : getAccessToken(clientId, scopes))
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    try {
      return await fetch(url, { ...init, headers })
    } catch (e) {
      throw new GoogleApiError('network', { detail: e instanceof Error ? e.message : String(e) })
    }
  }
  let res = await attempt()
  if (res.status === 401) {
    invalidateToken()
    res = await attempt()
  }
  if (!res.ok) {
    const err = await errorFromResponse(res)
    if (err.code === 'insufficient_scope') scopes.forEach(forgetScope)
    throw err
  }
  return res
}
