import { afterEach, describe, expect, it } from 'vitest'
import { localDateOf } from './status'

const tz = process.env.TZ

afterEach(() => {
  if (tz === undefined) delete process.env.TZ
  else process.env.TZ = tz
})

describe('localDateOf', () => {
  it('takes the calendar day in the local time zone', () => {
    process.env.TZ = 'Europe/Tallinn'
    expect(localDateOf('2026-10-15T22:30:00.000Z')).toBe('2026-10-16')
    expect(localDateOf('2026-10-15T08:00:00.000Z')).toBe('2026-10-15')
  })
  it('keeps a plain date and copes with a malformed value', () => {
    process.env.TZ = 'America/New_York'
    expect(localDateOf('2026-10-15')).toBe('2026-10-15')
    expect(localDateOf('2026-10-15T02:00:00.000Z')).toBe('2026-10-14')
    expect(localDateOf('bad')).toBe('bad')
  })
})
