// Minimal local types for Google Identity Services (token model), https://accounts.google.com/gsi/client.
// Only the parts this app uses. Reference: developers.google.com/identity/oauth2/web/reference/js-reference

export interface GisTokenResponse {
  access_token: string
  /** Seconds until expiry. */
  expires_in: number | string
  /** Space-separated granted scopes. */
  scope: string
  token_type?: string
  prompt?: string
  error?: string
  error_description?: string
  error_uri?: string
}

export interface GisClientConfigError {
  type: 'popup_failed_to_open' | 'popup_closed' | 'unknown' | string
  message?: string
}

export interface GisTokenClientConfig {
  client_id: string
  scope: string
  callback: (response: GisTokenResponse) => void
  error_callback?: (error: GisClientConfigError) => void
  /** '' = only ask when needed, 'consent', 'select_account', 'none'. */
  prompt?: string
  include_granted_scopes?: boolean
  login_hint?: string
  hd?: string
  state?: string
}

export interface GisOverridableTokenClientConfig {
  prompt?: string
  scope?: string
  include_granted_scopes?: boolean
  login_hint?: string
  state?: string
}

export interface GisTokenClient {
  requestAccessToken(overrideConfig?: GisOverridableTokenClientConfig): void
}

export interface GisOauth2 {
  initTokenClient(config: GisTokenClientConfig): GisTokenClient
  hasGrantedAllScopes(response: GisTokenResponse, firstScope: string, ...restScopes: string[]): boolean
  hasGrantedAnyScope(response: GisTokenResponse, firstScope: string, ...restScopes: string[]): boolean
  revoke(accessToken: string, done?: (response: { successful: boolean; error?: string; error_description?: string }) => void): void
}

export interface GoogleGlobal {
  accounts: { oauth2: GisOauth2 }
}

declare global {
  interface Window {
    google?: GoogleGlobal
  }
}
