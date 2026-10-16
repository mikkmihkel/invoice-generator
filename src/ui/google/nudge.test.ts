import { afterEach, describe, expect, it } from 'vitest'
import { __resetNudgeForTests, dismissNudge, isNudgeDismissed } from './nudge'

const DAY = 24 * 60 * 60 * 1000

afterEach(() => __resetNudgeForTests())

describe('Drive nudge snooze', () => {
  it('stays hidden for 30 days after dismissing, then comes back', () => {
    const now = Date.parse('2026-10-16T10:00:00Z')
    expect(isNudgeDismissed(now)).toBe(false)
    dismissNudge(now)
    expect(localStorage.getItem('arveldaja:driveNudgeDismissedAt')).toBe('2026-10-16T10:00:00.000Z')
    expect(isNudgeDismissed(now + 29 * DAY)).toBe(true)
    expect(isNudgeDismissed(now + 30 * DAY)).toBe(false)
  })

  it('ignores an unreadable stored value', () => {
    localStorage.setItem('arveldaja:driveNudgeDismissedAt', 'nonsense')
    expect(isNudgeDismissed()).toBe(false)
  })
})
