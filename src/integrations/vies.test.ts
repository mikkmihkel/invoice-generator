import { describe, expect, it, vi } from 'vitest'
import { checkVatNumber, parseViesResponse, splitVatNumber, VIES_API_URL } from './vies'

const json = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

describe('splitVatNumber', () => {
  it('splits and normalizes EU numbers, mapping Greece to EL', () => {
    expect(splitVatNumber('ee 101.234-567')).toEqual({ countryCode: 'EE', number: '101234567' })
    expect(splitVatNumber('GR123456789')).toEqual({ countryCode: 'EL', number: '123456789' })
    expect(splitVatNumber('US123456789')).toBeNull()
    expect(splitVatNumber('EE')).toBeNull()
  })
})

describe('checkVatNumber', () => {
  it('posts the number and returns the registered name and address', async () => {
    const f = json({ countryCode: 'EE', vatNumber: '101234567', requestDate: '2026-10-15T10:00:00.000Z', valid: true, name: 'NÄIDIS OÜ', address: 'Narva mnt 5\n10117 Tallinn' })
    const r = await checkVatNumber('EE', 'EE 101234567', f)
    expect(r).toEqual({ status: 'valid', countryCode: 'EE', vatNumber: '101234567', name: 'NÄIDIS OÜ', address: 'Narva mnt 5, 10117 Tallinn', requestDate: '2026-10-15T10:00:00.000Z' })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(VIES_API_URL)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ countryCode: 'EE', vatNumber: '101234567' })
  })

  it('reports invalid numbers', async () => {
    await expect(checkVatNumber('EE', '100000000', json({ valid: false, name: '---', address: '---' }))).resolves.toMatchObject({ status: 'invalid' })
    await expect(checkVatNumber('EE', 'x', json({ actionSucceed: false, errorWrappers: [{ error: 'INVALID_INPUT' }] }, 400))).resolves.toMatchObject({ status: 'invalid' })
  })

  it('treats member state errors as unavailable, not invalid', async () => {
    const r = await checkVatNumber('DE', '123456789', json({ actionSucceed: false, errorWrappers: [{ error: 'MS_UNAVAILABLE' }] }))
    expect(r).toEqual({ status: 'unavailable', countryCode: 'DE', vatNumber: '123456789', reason: 'MS_UNAVAILABLE' })
    await expect(checkVatNumber('DE', '123456789', vi.fn(async () => new Response('busy', { status: 503 })))).resolves.toMatchObject({ status: 'unavailable', reason: 'HTTP 503' })
  })

  it('reports a blocked request (CORS or offline) so the caller can link to the VIES page', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(checkVatNumber('EE', '101234567', f)).resolves.toEqual({ status: 'blocked', countryCode: 'EE', vatNumber: '101234567', reason: 'Failed to fetch' })
  })

  it('hides undisclosed names and reads the per-state response format', () => {
    expect(parseViesResponse({ isValid: true, userError: 'VALID', name: '---', address: '---' }, 'DE', '1')).toEqual({ status: 'valid', countryCode: 'DE', vatNumber: '1', name: undefined, address: undefined, requestDate: undefined })
    expect(parseViesResponse({ isValid: false, userError: 'INVALID' }, 'DE', '1')).toMatchObject({ status: 'invalid' })
    expect(parseViesResponse({ isValid: false, userError: 'MS_MAX_CONCURRENT_REQ' }, 'DE', '1')).toMatchObject({ status: 'unavailable' })
    expect(parseViesResponse(null, 'DE', '1')).toMatchObject({ status: 'unavailable' })
  })
})
