import { fromCents, toCents } from './calc'
import type { ISODate } from './types'

export interface LateInterest {
  /** Days after the due date (0 when not overdue). */
  days: number
  /** Late interest (viivis) in the invoice currency, rounded to cents. */
  amount: number
}

const DAY_MS = 86_400_000
const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Whole days from the due date to `today` (0 when not yet overdue or a date is missing). */
export function daysOverdue(dueDate: ISODate | undefined, today: ISODate): number {
  if (!isDate(dueDate) || !isDate(today)) return 0
  const diff = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(dueDate + 'T00:00:00Z')) / DAY_MS)
  return Number.isFinite(diff) && diff > 0 ? diff : 0
}

/**
 * Late interest on the open amount: open × rate % per day × days overdue (VÕS § 113), in integer cents with
 * half-up rounding. The rate is the one agreed on the invoice; without a rate, an open amount or overdue days
 * the interest is zero.
 */
export function lateInterest(open: number, ratePercentPerDay: number | undefined, dueDate: ISODate | undefined, today: ISODate): LateInterest {
  const days = daysOverdue(dueDate, today)
  const openCents = toCents(open)
  const rate = typeof ratePercentPerDay === 'number' && Number.isFinite(ratePercentPerDay) && ratePercentPerDay > 0 ? ratePercentPerDay : 0
  if (days === 0 || openCents <= 0 || rate === 0) return { days, amount: 0 }
  // Rate in millionths of a percent keeps the whole product in exact integers.
  const rateMicro = BigInt(Math.round(rate * 1_000_000))
  const numerator = BigInt(openCents) * rateMicro * BigInt(days)
  const denominator = 100_000_000n
  const cents = (numerator * 2n + denominator) / (denominator * 2n)
  return { days, amount: fromCents(Number(cents)) }
}
