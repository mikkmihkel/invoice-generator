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
  | 'gmail_needs_own_client'
  | 'folder_not_found'
  | 'picker_failed'
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
        et: 'Google’i sisselogimine pole seadistatud. Lisa seadetes oma OAuth-kliendi ID (vt juhendit).',
        en: 'Google sign-in is not set up. Add your OAuth client ID in Settings (see the setup guide).',
      }
    case 'script_load_failed':
      return {
        et: 'Google’i sisselogimist ei õnnestunud laadida. Kontrolli internetiühendust ja reklaamiblokeerijat.',
        en: 'Could not load Google sign-in. Check your internet connection and ad blocker.',
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
        et: 'Google’ile ei antud luba. Proovi uuesti ja anna sisselogimisel luba.',
        en: 'Permission was not granted to Google. Try again and allow access when signing in.',
      }
    case 'insufficient_scope':
      return {
        et: 'Vajalik õigus puudub (nt jäi Drive’i või Gmaili linnuke märkimata). Logi uuesti sisse ja luba kõik küsitud õigused.',
        en: 'A required permission is missing (e.g. the Drive or Gmail box was unchecked). Sign in again and allow all requested permissions.',
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
        et: 'Google’ile on saadetud liiga palju päringuid. Oota hetk ja proovi uuesti.',
        en: 'Too many requests were sent to Google. Wait a moment and try again.',
      }
    case 'not_found':
      return { et: 'Faili ei leitud Google Drive’ist.', en: 'File not found in Google Drive.' }
    case 'gmail_needs_own_client':
      return {
        et: 'Gmailiga saatmiseks lisa seadetes (Google’i konto ja Drive → Täpsemad seaded) oma OAuth-kliendi ID. Seni saada arve e-posti rakenduse kaudu.',
        en: 'To send with Gmail, add your own OAuth client ID in Settings (Google account and Drive → Advanced). Until then, send the invoice with your email app.',
      }
    case 'folder_not_found':
      return {
        et: 'Valitud Google Drive’i kausta ei leitud või sellele pole enam ligipääsu. Vali seadetes kaust uuesti.',
        en: 'The chosen Google Drive folder was not found or is no longer accessible. Choose the folder again in Settings.',
      }
    case 'picker_failed':
      return {
        et: 'Google Drive’i kausta valikut ei õnnestunud avada.',
        en: 'Could not open the Google Drive folder picker.',
      }
    case 'network':
      return {
        et: 'Google’iga ei saanud ühendust. Kontrolli internetiühendust.',
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
