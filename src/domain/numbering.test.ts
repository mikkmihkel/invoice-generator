import { describe, expect, it } from 'vitest'
import { formatInvoiceNumber, generateReferenceNumber, isValidReferenceNumber, referenceCheckDigit } from './numbering'

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
