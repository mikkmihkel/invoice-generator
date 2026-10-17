// "Keep your data in Google Drive" nudge: dismissible, comes back after 30 days (per browser).

const KEY = 'arveldaja:driveNudgeDismissedAt'
export const NUDGE_SNOOZE_DAYS = 30
let sessionDismissedAt: number | null = null

/** Whether the nudge was dismissed less than 30 days ago. */
export function isNudgeDismissed(now: number = Date.now()): boolean {
  let at = sessionDismissedAt
  try {
    const stored = Date.parse(localStorage.getItem(KEY) ?? '')
    if (!Number.isNaN(stored)) at = stored
  } catch {
    // storage unavailable: remembered for this session only
  }
  return at !== null && now - at < NUDGE_SNOOZE_DAYS * 24 * 60 * 60 * 1000 && at <= now
}

export function dismissNudge(now: number = Date.now()): void {
  sessionDismissedAt = now
  try {
    localStorage.setItem(KEY, new Date(now).toISOString())
  } catch {
    // storage unavailable
  }
}

/** Test helper. */
export function __resetNudgeForTests(): void {
  sessionDismissedAt = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
