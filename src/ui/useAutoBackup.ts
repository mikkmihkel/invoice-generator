import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppSettings } from '../domain'
// Submodules rather than the integrations barrel: UI tests replace the barrel with a small mock.
import {
  BackupScheduler,
  dismissPassphrasePrompt,
  getAutoBackupStatus,
  getBackupPassphrase,
  normalizeAutoBackup,
  runAutoBackup,
  setAutoBackupStatus,
  setBackupPassphrase,
  subscribeBackupPassphrase,
  wasPassphrasePromptDismissed,
  type AutoBackupResult,
  type SchedulerOptions,
} from '../integrations/autoBackup'
import { hasAccessToken } from '../integrations/googleAuth'
import { serializeBackup, subscribe, type Repository } from '../storage'
import { useApp } from './AppContext'
import { PassphraseDialog } from './pages/settings/BackupSection'
import { markBackupDone } from './util'

const TOKEN_POLL_MS = 5_000

export interface BackupContext {
  repo: Repository
  /** Latest settings (read after the upload too, so concurrent edits are not overwritten). */
  getSettings: () => AppSettings
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>
}

export type BackupOutcome = AutoBackupResult | { kind: 'error'; error: unknown }

/**
 * Run one backup to Drive and record the result (settings.autoBackup.lastBackupAt, the shared status).
 * `interactive` (a click): uploads even without changes and may show the Google consent popup, so call
 * googleSignIn from the click handler first.
 */
export async function performAutoBackup(ctx: BackupContext, interactive: boolean): Promise<BackupOutcome> {
  const settings = ctx.getSettings()
  if (!settings.googleClientId) return { kind: 'needs-signin' }
  setAutoBackupStatus({ phase: 'running' })
  try {
    const res = await runAutoBackup({
      clientId: settings.googleClientId,
      folderName: settings.driveFolderName,
      settings: normalizeAutoBackup(settings.autoBackup),
      exportBackup: () => ctx.repo.exportBackup(),
      serialize: serializeBackup,
      interactive,
      passphrase: getBackupPassphrase(),
    })
    if (res.kind === 'uploaded') {
      markBackupDone(res.at)
      const latest = normalizeAutoBackup(ctx.getSettings().autoBackup)
      await ctx.saveSettings({ autoBackup: { ...latest, lastBackupAt: res.at } })
    }
    if (res.kind === 'needs-signin') setAutoBackupStatus({ phase: 'pending', reason: 'signin' })
    else if (res.kind === 'needs-passphrase') setAutoBackupStatus({ phase: 'pending', reason: 'passphrase' })
    else setAutoBackupStatus({ phase: 'idle' })
    return res
  } catch (error) {
    setAutoBackupStatus({ phase: 'error', error })
    return { kind: 'error', error }
  }
}

/**
 * Background automatic backup. Mount once inside AppProvider and render the returned node (the passphrase prompt
 * shown before the first encrypted backup of a session). Never opens a Google popup by itself: without a token the
 * backup waits ("pending") until the user signs in anywhere in the app or presses "Back up now".
 */
export function useAutoBackup(timing: SchedulerOptions & { tokenPollMs?: number } = {}): ReactNode {
  const { ready, repo, settings, saveSettings } = useApp()
  const cfg = normalizeAutoBackup(settings.autoBackup)
  const clientId = settings.googleClientId
  const active = ready && cfg.enabled && !!clientId
  const settingsRef = useRef(settings)
  const latest = useRef<BackupContext>({ repo, getSettings: () => settingsRef.current, saveSettings })
  useEffect(() => {
    settingsRef.current = settings
    latest.current = { repo, getSettings: () => settingsRef.current, saveSettings }
  }, [repo, settings, saveSettings])
  const [asking, setAsking] = useState(false)
  const timingRef = useRef(timing)

  useEffect(() => {
    if (!active || !clientId) {
      setAutoBackupStatus({ phase: 'idle' })
      return
    }
    const scheduler = new BackupScheduler(async () => {
      const res = await performAutoBackup(latest.current, false)
      if (res.kind === 'needs-passphrase' && !wasPassphrasePromptDismissed()) setAsking(true)
      return { uploaded: res.kind === 'uploaded', retry: res.kind === 'error' }
    }, timingRef.current)
    // Data may have changed since the last backup (e.g. the tab was closed before it ran).
    scheduler.notify()
    const unsubscribe = subscribe(() => scheduler.notify())
    const unsubscribePassphrase = subscribeBackupPassphrase(() => {
      const s = getAutoBackupStatus()
      if (s.phase === 'pending' && s.reason === 'passphrase' && getBackupPassphrase()) scheduler.flush()
    })
    // A token appears when the user uses any Google feature; then the backup can run without a popup.
    const poll = setInterval(() => {
      const s = getAutoBackupStatus()
      if (s.phase === 'pending' && s.reason === 'signin' && hasAccessToken(clientId, ['drive'])) scheduler.flush()
    }, timingRef.current.tokenPollMs ?? TOKEN_POLL_MS)
    return () => {
      scheduler.dispose()
      unsubscribe()
      unsubscribePassphrase()
      clearInterval(poll)
    }
  }, [active, clientId])

  if (!asking || !active) return null
  return createElement(PassphraseDialog, {
    mode: 'session',
    onSubmit: (value: string) => {
      setAsking(false)
      setBackupPassphrase(value)
    },
    onClose: () => {
      setAsking(false)
      dismissPassphrasePrompt()
    },
  })
}
