export type GoogleErrorCode =
  | 'not_configured'
  | 'script_load_failed'
  | 'popup_blocked'
  | 'popup_closed'
  | 'access_denied'
  | 'insufficient_scope'
  | 'unauthorized'
  | 'origin_mismatch'
  | 'invalid_client'
  | 'api_not_enabled'
  | 'rate_limited'
  | 'not_found'
  | 'network'
  | 'unknown'

export type Bilingual = { et: string; en: string }

function originHint(): string {
  return typeof location !== 'undefined' ? location.origin : 'https://<kasutaja>.github.io'
}

/** Friendly, bilingual explanation for an error code (shown to the user as-is). */
export function friendlyGoogleMessage(code: GoogleErrorCode, detail?: string): Bilingual {
  const origin = originHint()
  switch (code) {
    case 'not_configured':
      return {
        et: 'Google’i ühendus ei ole seadistatud. Sisesta seadetes oma OAuth-kliendi ID (vt juhendit).',
        en: 'Google is not set up. Enter your OAuth client ID in Settings (see the setup guide).',
      }
    case 'script_load_failed':
      return {
        et: 'Google’i sisselogimise skripti laadimine ebaõnnestus. Kontrolli internetiühendust või reklaamiblokeerijat.',
        en: 'Could not load Google sign-in. Check your connection or ad/script blocker.',
      }
    case 'popup_blocked':
      return {
        et: 'Brauser blokeeris Google’i sisselogimise akna. Luba sellel lehel hüpikaknad ja proovi uuesti.',
        en: 'The browser blocked the Google sign-in popup. Allow popups for this site and try again.',
      }
    case 'popup_closed':
      return {
        et: `Google’i sisselogimise aken suleti. Kui aknas oli viga „origin_mismatch“, lisa aadress ${origin} Google Cloudi OAuth-kliendi jaotisesse „Authorized JavaScript origins“.`,
        en: `The Google sign-in window was closed. If it showed "origin_mismatch", add ${origin} to the client's Authorized JavaScript origins in Google Cloud.`,
      }
    case 'access_denied':
      return {
        et: 'Google’i juurdepääsust keelduti. Selle funktsiooni kasutamiseks pead andma loa.',
        en: 'Google access was denied. You need to grant permission to use this feature.',
      }
    case 'insufficient_scope':
      return {
        et: 'Google ei andnud vajalikku õigust (nt jäi Drive’i või Gmaili linnuke märkimata). Logi uuesti sisse ja luba kõik küsitud õigused.',
        en: 'Google did not grant the required permission (e.g. the Drive or Gmail box was unchecked). Sign in again and allow all requested permissions.',
      }
    case 'unauthorized':
      return {
        et: 'Google’i seanss aegus. Logi uuesti sisse.',
        en: 'Your Google session expired. Please sign in again.',
      }
    case 'origin_mismatch':
      return {
        et: `Selle lehe aadress (${origin}) ei ole OAuth-kliendi lubatud päritolude hulgas. Lisa see Google Cloudi konsoolis jaotisesse „Authorized JavaScript origins“.`,
        en: `This page's origin (${origin}) is not an authorized JavaScript origin of the OAuth client. Add it in the Google Cloud console.`,
      }
    case 'invalid_client':
      return {
        et: 'OAuth-kliendi ID on vale. Kontrolli seadetes kliendi ID-d (see lõpeb osaga „.apps.googleusercontent.com“).',
        en: 'The OAuth client ID is invalid. Check the client ID in Settings (ends with ".apps.googleusercontent.com").',
      }
    case 'api_not_enabled':
      return {
        et: `Google’i API ei ole projektis lubatud${detail ? ` (${detail})` : ''}. Luba Google Cloudi konsoolis Drive API ja Gmail API.`,
        en: `The Google API is not enabled in your project${detail ? ` (${detail})` : ''}. Enable the Drive API and Gmail API in the Google Cloud console.`,
      }
    case 'rate_limited':
      return {
        et: 'Google’i päringute limiit on ületatud. Oota hetk ja proovi uuesti.',
        en: 'Google rate limit exceeded. Wait a moment and try again.',
      }
    case 'not_found':
      return { et: 'Faili ei leitud Google Drive’ist.', en: 'File not found in Google Drive.' }
    case 'network':
      return {
        et: 'Google’iga ühendumine ebaõnnestus. Kontrolli internetiühendust.',
        en: 'Could not reach Google. Check your internet connection.',
      }
    default:
      return {
        et: `Google’i päring ebaõnnestus${detail ? `: ${detail}` : '.'}`,
        en: `Google request failed${detail ? `: ${detail}` : '.'}`,
      }
  }
}

export class GoogleApiError extends Error {
  readonly code: GoogleErrorCode
  readonly status?: number
  /** Bilingual user-facing message. */
  readonly messages: Bilingual
  readonly detail?: string

  constructor(code: GoogleErrorCode, opts: { status?: number; detail?: string } = {}) {
    const messages = friendlyGoogleMessage(code, opts.detail)
    super(messages.en)
    this.name = 'GoogleApiError'
    this.code = code
    this.status = opts.status
    this.detail = opts.detail
    this.messages = messages
  }
}

/** Map a GIS token response error (e.g. "access_denied") or error_callback type. */
export function errorFromGis(type: string | undefined, description?: string): GoogleApiError {
  const t = `${type ?? ''} ${description ?? ''}`.toLowerCase()
  if (t.includes('popup_failed_to_open')) return new GoogleApiError('popup_blocked')
  if (t.includes('popup_closed')) return new GoogleApiError('popup_closed')
  if (t.includes('access_denied')) return new GoogleApiError('access_denied')
  if (t.includes('origin_mismatch') || t.includes('idpiframe_initialization_failed') || t.includes('redirect_uri_mismatch')) {
    return new GoogleApiError('origin_mismatch')
  }
  if (t.includes('invalid_client') || t.includes('unauthorized_client')) return new GoogleApiError('invalid_client')
  if (t.includes('invalid_scope') || t.includes('insufficient')) return new GoogleApiError('insufficient_scope')
  return new GoogleApiError('unknown', { detail: description || type })
}

interface GoogleErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
    errors?: { reason?: string; message?: string }[]
    details?: { reason?: string }[]
  }
}

/** Map a failed Google REST response (Drive/Gmail/userinfo) to a GoogleApiError. */
export async function errorFromResponse(res: Response): Promise<GoogleApiError> {
  let body: GoogleErrorBody = {}
  try {
    body = (await res.json()) as GoogleErrorBody
  } catch {
    // not JSON
  }
  const reasons = [
    body.error?.status,
    ...(body.error?.errors ?? []).map((e) => e.reason),
    ...(body.error?.details ?? []).map((d) => d.reason),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const detail = body.error?.message
  const status = res.status
  if (status === 401) return new GoogleApiError('unauthorized', { status, detail })
  if (status === 404) return new GoogleApiError('not_found', { status, detail })
  if (status === 429 || reasons.includes('ratelimit')) return new GoogleApiError('rate_limited', { status, detail })
  if (status === 403) {
    if (reasons.includes('accessnotconfigured') || reasons.includes('service_disabled')) {
      return new GoogleApiError('api_not_enabled', { status, detail })
    }
    if (reasons.includes('insufficient') || reasons.includes('scope')) {
      return new GoogleApiError('insufficient_scope', { status, detail })
    }
  }
  return new GoogleApiError('unknown', { status, detail: detail ?? `HTTP ${status}` })
}
