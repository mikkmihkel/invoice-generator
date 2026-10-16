/// <reference types="vite/client" />

// Build-time configuration (see .github/workflows/deploy.yml and docs/google-setup.md). All optional and public.
interface ImportMetaEnv {
  /** Shared Google OAuth client ID of the published site. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** Browser API key for the Google Picker (restricted by HTTP referrer to the site and to the Picker API). */
  readonly VITE_GOOGLE_API_KEY?: string
  /** Google Cloud project number of the shared client (the Picker's app ID). */
  readonly VITE_GOOGLE_APP_ID?: string
}
