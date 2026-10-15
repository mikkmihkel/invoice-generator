import { describe, expect, it } from 'vitest'
import {
  advanceNumbering,
  DEFAULT_QUOTE_NUMBERING,
  formatInvoiceNumber,
  generateReferenceNumber,
  highestUsedNumber,
  isValidReferenceNumber,
  matchPreset,
  nextSequence,
  numberingFloor,
  numberingFor,
  NUMBERING_PRESETS,
  periodKey,
  prefixCoversPeriod,
  unknownTokens,
  predictNumber,
  previewNumbers,
  raiseNumbering,
  referenceCheckDigit,
  restartBelowUsed,
  sameSeries,
  upcomingNumbers,
  sequenceOf,
  setNextSequence,
} from './numbering'
import type { NumberingSettings } from './types'

describe('formatInvoiceNumber', () => {
  it('replaces {YYYY} and pads', () => {
    expect(formatInvoiceNumber({ prefix: '{YYYY}-', padding: 4, nextNumber: 1 }, 7, 2026)).toBe('2026-0007')
  })
  it('supports {YY}, static prefixes and no padding', () => {
    expect(formatInvoiceNumber({ prefix: 'ARVE-{YY}/', padding: 3, nextNumber: 1 }, 42, 2027)).toBe('ARVE-27/042')
    expect(formatInvoiceNumber({ prefix: 'A', padding: 0, nextNumber: 1 }, 15, 2026)).toBe('A15')
    expect(formatInvoiceNumber({ prefix: '', padding: 4, nextNumber: 1 }, 1, 2026)).toBe('0001')
  })
  it('does not truncate numbers longer than the padding', () => {
    expect(formatInvoiceNumber({ prefix: '{YYYY}-', padding: 2, nextNumber: 1 }, 1234, 2026)).toBe('2026-1234')
  })
  it('replaces every placeholder occurrence', () => {
    expect(formatInvoiceNumber({ prefix: '{YYYY}/{YYYY}-', padding: 1, nextNumber: 1 }, 5, 2026)).toBe('2026/2026-5')
  })
})

describe('formatInvoiceNumber with an issue date', () => {
  it('replaces every date token', () => {
    const s = (prefix: string, padding = 3): NumberingSettings => ({ prefix, padding, nextNumber: 1 })
    expect(formatInvoiceNumber(s('{YYYYMMDD}'), 1, '2026-10-15')).toBe('20261015001')
    expect(formatInvoiceNumber(s('{YYYY}-{MM}-'), 7, '2026-03-05')).toBe('2026-03-007')
    expect(formatInvoiceNumber(s('{YY}{MM}{DD}/', 2), 4, '2026-01-09')).toBe('260109/04')
    expect(formatInvoiceNumber(s('{YYYY}-', 4), 7, '2026-12-31')).toBe('2026-0007')
  })
  it('still accepts a plain year (month and day 01)', () => {
    expect(formatInvoiceNumber({ prefix: '{YYYY}{MM}{DD}-', padding: 1, nextNumber: 1 }, 3, 2027)).toBe('20270101-3')
  })
  it('falls back to today for a malformed date', () => {
    expect(formatInvoiceNumber({ prefix: '{YYYY}-', padding: 1, nextNumber: 1 }, 1, 'garbage')).toMatch(/^\d{4}-1$/)
  })
})

describe('numbering periods', () => {
  const daily: NumberingSettings = { prefix: '{YYYYMMDD}', padding: 3, nextNumber: 1, reset: 'daily' }

  it('builds period keys', () => {
    expect(periodKey('never', '2026-10-15')).toBeNull()
    expect(periodKey('yearly', '2026-10-15')).toBe('2026')
    expect(periodKey('monthly', '2026-10-15')).toBe('2026-10')
    expect(periodKey('daily', '2026-10-15')).toBe('2026-10-15')
  })

  it('numbers per day: 20261015001, 20261015002, next day 20261016001', () => {
    let s = daily
    const issue = (date: string) => {
      const { n } = nextSequence(s, date)
      const number = formatInvoiceNumber(s, n, date)
      s = advanceNumbering(s, date, n)
      return number
    }
    expect(issue('2026-10-15')).toBe('20261015001')
    expect(issue('2026-10-15')).toBe('20261015002')
    expect(issue('2026-10-16')).toBe('20261016001')
    expect(issue('2026-10-15')).toBe('20261015003')
    expect(s.counters).toEqual({ '2026-10-15': 4, '2026-10-16': 2 })
    expect(s.nextNumber).toBe(1)
  })

  it('restarts yearly and monthly series in a new period', () => {
    const yearly: NumberingSettings = { prefix: '{YYYY}-', padding: 4, nextNumber: 1, reset: 'yearly', counters: { '2026': 57 } }
    expect(predictNumber(yearly, '2026-12-31')).toBe('2026-0057')
    expect(predictNumber(yearly, '2027-01-01')).toBe('2027-0001')
    const monthly: NumberingSettings = { prefix: '{YYYY}-{MM}-', padding: 3, nextNumber: 1, reset: 'monthly', counters: { '2026-10': 5 } }
    expect(previewNumbers(monthly, '2026-10-15', 3)).toEqual(['2026-10-005', '2026-10-006', '2026-10-007'])
    expect(previewNumbers(monthly, '2026-11-01', 2)).toEqual(['2026-11-001', '2026-11-002'])
  })

  it('treats a missing reset as one running series (existing profiles keep their numbers)', () => {
    const legacy: NumberingSettings = { prefix: '{YYYY}-', padding: 4, nextNumber: 42 }
    expect(nextSequence(legacy, '2027-01-01')).toEqual({ n: 42, key: null })
    expect(predictNumber(legacy, '2027-01-01')).toBe('2027-0042')
    expect(advanceNumbering(legacy, '2027-01-01')).toEqual({ ...legacy, nextNumber: 43 })
    expect(advanceNumbering(legacy, '2027-01-01', 50).nextNumber).toBe(51)
  })

  it('ignores unusable counter values', () => {
    const bad = { prefix: '', padding: 1, nextNumber: 0, reset: 'yearly', counters: { '2026': -3, '2027': 2.5 } } as NumberingSettings
    expect(nextSequence(bad, '2026-01-01').n).toBe(1)
    expect(nextSequence(bad, '2027-01-01').n).toBe(1)
    expect(nextSequence({ ...bad, reset: 'never' }, '2027-01-01').n).toBe(1)
    expect(nextSequence({ ...bad, counters: JSON.parse('{"constructor": 5}') }, '2026-01-01').n).toBe(1)
  })

  it('sets the next number of the current period', () => {
    expect(setNextSequence(daily, '2026-10-15', 12).counters).toEqual({ '2026-10-15': 12 })
    expect(setNextSequence({ ...daily, reset: 'never' }, '2026-10-15', 12).nextNumber).toBe(12)
    expect(setNextSequence(daily, '2026-10-15', 0).counters).toEqual({ '2026-10-15': 1 })
  })
})

describe('presets and series', () => {
  it('has the offered presets', () => {
    const preview = (id: string) => {
      const p = NUMBERING_PRESETS.find((x) => x.id === id)!
      return predictNumber({ ...p, nextNumber: 1 }, '2026-10-15')
    }
    expect(preview('yearly')).toBe('2026-0001')
    expect(preview('daily')).toBe('20261015001')
    expect(preview('monthly')).toBe('2026-10-001')
    expect(preview('plain')).toBe('ARVE-0001')
  })
  it('recognises presets', () => {
    expect(matchPreset({ prefix: '{YYYYMMDD}', padding: 3, nextNumber: 1, reset: 'daily' })).toBe('daily')
    expect(matchPreset({ prefix: '{YYYY}-', padding: 4, nextNumber: 9 })).toBe('custom')
    expect(matchPreset({ prefix: '{YYYY}-', padding: 4, nextNumber: 9, reset: 'yearly' })).toBe('yearly')
  })
  it('numbers quotes from their own series', () => {
    const profile = { numbering: { prefix: '{YYYY}-', padding: 4, nextNumber: 3 } }
    expect(numberingFor(profile, 'invoice')).toBe(profile.numbering)
    expect(numberingFor(profile, 'credit-note')).toBe(profile.numbering)
    expect(numberingFor(profile, 'quote')).toBe(DEFAULT_QUOTE_NUMBERING)
    expect(predictNumber(numberingFor(profile, 'quote'), '2026-10-15')).toBe('HP-2026-001')
    expect(sameSeries('quote')({ type: 'quote' })).toBe(true)
    expect(sameSeries('invoice')({ type: 'quote' })).toBe(false)
    expect(sameSeries('invoice')({ type: 'credit-note' })).toBe(true)
  })
})

describe('prefix checks', () => {
  it('finds unknown placeholders', () => {
    expect(unknownTokens('{YYYY}-{MM}-')).toEqual([])
    expect(unknownTokens('{YYY}-{mm}{YYY}')).toEqual(['{YYY}', '{mm}'])
  })
  it('requires the date parts a reset needs', () => {
    expect(prefixCoversPeriod('ARVE-', 'never')).toBe(true)
    expect(prefixCoversPeriod('ARVE-', 'yearly')).toBe(false)
    expect(prefixCoversPeriod('{YY}/', 'yearly')).toBe(true)
    expect(prefixCoversPeriod('{YYYY}-', 'monthly')).toBe(false)
    expect(prefixCoversPeriod('{MM}-', 'monthly')).toBe(false)
    expect(prefixCoversPeriod('{YYYY}{MM}', 'monthly')).toBe(true)
    expect(prefixCoversPeriod('{YYYY}{MM}', 'daily')).toBe(false)
    expect(prefixCoversPeriod('{YY}{MM}{DD}', 'daily')).toBe(true)
    expect(prefixCoversPeriod('{YYYYMMDD}', 'daily')).toBe(true)
  })
})

describe('used numbers', () => {
  const doc = (number: string, issueDate: string, status: 'issued' | 'draft' = 'issued') => ({ number, issueDate, status })

  it('reads the sequence for the issue date', () => {
    const s: NumberingSettings = { prefix: '{YYYYMMDD}', padding: 3, nextNumber: 1, reset: 'daily' }
    expect(sequenceOf(s, '20261015007', '2026-10-15')).toBe(7)
    expect(sequenceOf(s, '20261015007', '2026-10-16')).toBeNull()
    expect(sequenceOf(s, '20261015-07', '2026-10-15')).toBeNull()
  })

  it('matches new date tokens in highestUsedNumber', () => {
    expect(highestUsedNumber([doc('20261015012', '2026-10-15'), doc('20261016003', '2026-10-16')], { prefix: '{YYYYMMDD}', padding: 3, nextNumber: 1 })).toBe(12)
    expect(highestUsedNumber([doc('2026-10-004', '2026-10-15'), doc('2026-0099', '2026-10-15')], { prefix: '{YYYY}-{MM}-', padding: 3, nextNumber: 1 })).toBe(4)
  })

  it('computes per-period floors and raises counters without lowering them', () => {
    const s: NumberingSettings = { prefix: '{YYYY}-', padding: 4, nextNumber: 1, reset: 'yearly', counters: { '2026': 3 } }
    const floor = numberingFloor(s, [doc('2025-0010', '2025-12-30'), doc('2026-0007', '2026-02-01'), doc('2026-0050', '2026-03-01', 'draft')])
    expect(floor.counters).toEqual({ '2025': 11, '2026': 8 })
    const raised = raiseNumbering(s, floor, { counters: { '2026': 5, '2027': 2 } }, null, undefined)
    expect(raised.counters).toEqual({ '2025': 11, '2026': 8, '2027': 2 })
    expect(raiseNumbering({ ...s, counters: { '2026': 99 } }, floor).counters!['2026']).toBe(99)
    expect(raiseNumbering({ prefix: 'A', padding: 1, nextNumber: 4 }, { nextNumber: 2 })).toEqual({ prefix: 'A', padding: 1, nextNumber: 4 })
  })
})

describe('settings preview helpers', () => {
  const doc = (number: string, issueDate: string) => ({ number, issueDate, status: 'issued' as const })
  const yearly: NumberingSettings = { prefix: '{YYYY}-', padding: 4, nextNumber: 1, reset: 'yearly', counters: { '2026': 2 } }

  it('previews upcoming numbers skipping used ones', () => {
    expect(upcomingNumbers(yearly, '2026-10-15', new Set(['2026-0003']))).toEqual(['2026-0002', '2026-0004', '2026-0005'])
  })

  it('reports a restart below used numbers of the current period only', () => {
    expect(restartBelowUsed(yearly, '2026-10-15', [doc('2026-0005', '2026-03-01')])).toBe(5)
    expect(restartBelowUsed(yearly, '2026-10-15', [doc('2026-0001', '2026-03-01')])).toBeNull()
    expect(restartBelowUsed(yearly, '2027-01-02', [doc('2026-0005', '2026-03-01')])).toBeNull()
    expect(restartBelowUsed({ prefix: 'A-', padding: 1, nextNumber: 3 }, '2026-10-15', [doc('A-9', '2025-01-01')])).toBe(9)
  })
})

describe('reference numbers (viitenumber, 7-3-1)', () => {
  it('matches the Pangaliit example 12131295 → 121312952', () => {
    expect(referenceCheckDigit('12131295')).toBe(2)
    expect(generateReferenceNumber('12131295')).toBe('121312952')
  })
  it('generates check digits for other bases', () => {
    expect(generateReferenceNumber('123456')).toBe('1234561')
    expect(generateReferenceNumber('1')).toBe('13')
    expect(generateReferenceNumber('2026-0007')).toBe('202600075')
    expect(generateReferenceNumber('ARVE 0042')).toBe('424')
    expect(generateReferenceNumber('20261015001')).toMatch(/^20261015001\d$/)
  })
  it('rejects bases without usable digits or longer than 19 digits', () => {
    expect(() => generateReferenceNumber('')).toThrow()
    expect(() => generateReferenceNumber('000')).toThrow()
    expect(() => generateReferenceNumber('1'.repeat(20))).toThrow()
    expect(generateReferenceNumber('1'.repeat(19))).toHaveLength(20)
  })
  it('validates generated numbers', () => {
    for (let n = 1; n < 2000; n += 7) expect(isValidReferenceNumber(generateReferenceNumber(String(n)))).toBe(true)
  })
  it('validates and rejects reference numbers', () => {
    expect(isValidReferenceNumber('121312952')).toBe(true)
    expect(isValidReferenceNumber('12131 2952')).toBe(true)
    expect(isValidReferenceNumber('13')).toBe(true)
    expect(isValidReferenceNumber('121312953')).toBe(false)
    expect(isValidReferenceNumber('3')).toBe(false)
    expect(isValidReferenceNumber('1'.repeat(21))).toBe(false)
    expect(isValidReferenceNumber('12A312952')).toBe(false)
    expect(isValidReferenceNumber('')).toBe(false)
  })
})
