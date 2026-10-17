import { useSyncExternalStore } from 'react'
// Submodules rather than the integrations barrel: UI tests replace the barrel with a small mock.
import { getGoogleAuthVersion, getGoogleStatus, rememberedGoogleAccount, subscribeGoogleAuth } from '../../integrations/googleAuth'
import { effectiveClientId, usesBuiltInClient } from '../../integrations/googleClient'
import { useApp } from '../AppContext'

export interface GoogleAccount {
  /** The client in use (own or built-in); undefined when Google is not available at all. */
  clientId?: string
  available: boolean
  /** The site's shared client (no Gmail). */
  builtIn: boolean
  /** A token is in memory: Google calls run without a popup. */
  signedIn: boolean
  /** Signed in now, or earlier in this browser (the token itself is not kept across reloads). */
  connected: boolean
  email?: string
}

/** The Google account as the UI shows it; re-renders on sign-in and sign-out. */
export function useGoogleAccount(): GoogleAccount {
  const { settings } = useApp()
  useSyncExternalStore(subscribeGoogleAuth, getGoogleAuthVersion)
  const clientId = effectiveClientId(settings)
  const status = getGoogleStatus(clientId)
  const remembered = rememberedGoogleAccount(clientId)
  const signedIn = !!clientId && status.signedIn
  return {
    clientId,
    available: !!clientId,
    builtIn: usesBuiltInClient(settings),
    signedIn,
    connected: signedIn || !!remembered,
    email: (signedIn ? status.email : undefined) ?? remembered?.email,
  }
}

/** Scroll to a settings section once it is on screen (after navigating to Settings) and focus its heading area. */
export function revealSection(id: string, tries = 30): void {
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView?.({ block: 'start' })
    return
  }
  if (tries > 0) requestAnimationFrame(() => revealSection(id, tries - 1))
}
