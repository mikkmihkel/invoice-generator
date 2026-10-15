import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkVatNumber, parseViesResponse, resetViesSession, splitVatNumber, viesBlockedInSession, viesCheckUrl, viesWebUrl } from './vies'

const json = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
const SAFELISTED = ['accept', 'accept-language', 'content-language', 'content-type', 'range']

beforeEach(() => resetViesSession())
afterEach(() => vi.restoreAllMocks())

describe('splitVatNumber', () => {
  it('splits and normalizes EU numbers, mapping Greece to EL', () => {
    expect(splitVatNumber('ee 101.234-567')).toEqual({ countryCode: 'EE', number: '101234567' })
    expect(splitVatNumber('GR123456789')).toEqual({ countryCode: 'EL', number: '123456789' })
    expect(splitVatNumber('US123456789')).toBeNull()
    expect(splitVatNumber('EE')).toBeNull()
  })
})

describe('request building', () => {
  it('uses the per-state GET endpoint and escapes path segments', () => {
    expect(viesCheckUrl('EE', '101234567')).toBe('https://ec.europa.eu/taxation_customs/vies/rest-api/ms/EE/vat/101234567')
    expect(viesCheckUrl('NL', '12345678B01')).toBe('https://ec.europa.eu/taxation_customs/vies/rest-api/ms/NL/vat/12345678B01')
    expect(viesCheckUrl('FR', 'AB+*')).toBe('https://ec.europa.eu/taxation_customs/vies/rest-api/ms/FR/vat/AB%2B*')
  })

  it('sends a CORS simple request: GET, no credentials, only safelisted headers, no body', async () => {
    const f = json({ isValid: true })
    await checkVatNumber('EE', 'EE 101 234 567', f)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ec.europa.eu/taxation_customs/vies/rest-api/ms/EE/vat/101234567')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(init.credentials).toBe('omit')
    const headers = Object.keys((init.headers ?? {}) as Record<string, string>).map((h) => h.toLowerCase())
    expect(headers.every((h) => SAFELISTED.includes(h))).toBe(true)
    expect(headers).not.toContain('content-type')
  })

  it('strips the country prefix, including GR for Greek numbers', async () => {
    const f = json({ isValid: true })
    await checkVatNumber('GR', 'GR094014201', f)
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://ec.europa.eu/taxation_customs/vies/rest-api/ms/EL/vat/094014201')
  })

  it('builds the official page address with country, number and language', () => {
    expect(viesWebUrl('EE', '101234567', 'et')).toBe('https://ec.europa.eu/taxation_customs/vies/#/vat-validation?memberStateCode=EE&number=101234567&locale=et')
    expect(viesWebUrl('EL', '094014201')).toBe('https://ec.europa.eu/taxation_customs/vies/#/vat-validation?memberStateCode=EL&number=094014201')
  })
})

describe('checkVatNumber', () => {
  it('returns the registered name and address of a valid number', async () => {
    const f = json({ isValid: true, requestDate: '2026-10-15T10:00:00.000Z', userError: 'VALID', name: 'NÄIDIS OÜ', address: 'Narva mnt 5\n10117 Tallinn', vatNumber: '101234567' })
    await expect(checkVatNumber('EE', '101234567', f)).resolves.toEqual({
      status: 'valid',
      countryCode: 'EE',
      vatNumber: '101234567',
      name: 'NÄIDIS OÜ',
      address: 'Narva mnt 5, 10117 Tallinn',
      requestDate: '2026-10-15T10:00:00.000Z',
    })
  })

  it('reports invalid numbers', async () => {
    await expect(checkVatNumber('EE', '100000000', json({ isValid: false, userError: 'INVALID', name: '---', address: '---' }))).resolves.toMatchObject({ status: 'invalid' })
    await expect(checkVatNumber('EE', 'xx', json({ actionSucceed: false, errorWrappers: [{ error: 'INVALID_INPUT' }] }, 400))).resolves.toMatchObject({ status: 'invalid' })
  })

  it('treats member state and service errors as unavailable, not invalid', async () => {
    await expect(checkVatNumber('DE', '123456789', json({ isValid: false, userError: 'MS_UNAVAILABLE' }))).resolves.toEqual({
      status: 'unavailable',
      countryCode: 'DE',
      vatNumber: '123456789',
      reason: 'MS_UNAVAILABLE',
    })
    await expect(checkVatNumber('DE', '123456789', json({ actionSucceed: false, errorWrappers: [{ error: 'SERVICE_UNAVAILABLE' }] }, 500))).resolves.toMatchObject({ status: 'unavailable', reason: 'SERVICE_UNAVAILABLE' })
    await expect(checkVatNumber('DE', '123456789', vi.fn(async () => new Response('busy', { status: 503 })))).resolves.toMatchObject({ status: 'unavailable', reason: 'HTTP 503' })
    expect(viesBlockedInSession()).toBe(false)
  })

  it('reports a request the browser cannot read (CORS) as blocked and remembers it for the session', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(checkVatNumber('EE', '101234567', f)).resolves.toEqual({ status: 'blocked', countryCode: 'EE', vatNumber: '101234567', reason: 'Failed to fetch' })
    expect(viesBlockedInSession()).toBe(true)
  })

  it('reports a timeout as blocked without remembering it', async () => {
    vi.useFakeTimers()
    try {
      const f = vi.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
      )
      const p = checkVatNumber('EE', '101234567', f)
      await vi.advanceTimersByTimeAsync(12_000)
      await expect(p).resolves.toMatchObject({ status: 'blocked', reason: 'timeout' })
      expect(viesBlockedInSession()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not call VIES when the browser is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const f = json({ isValid: true })
    await expect(checkVatNumber('EE', '101234567', f)).resolves.toEqual({ status: 'offline', countryCode: 'EE', vatNumber: '101234567' })
    expect(f).not.toHaveBeenCalled()
  })
})

describe('parseViesResponse', () => {
  it('hides undisclosed names and reads both response formats', () => {
    expect(parseViesResponse({ isValid: true, userError: 'VALID', name: '---', address: '---' }, 'DE', '1')).toEqual({ status: 'valid', countryCode: 'DE', vatNumber: '1', name: undefined, address: undefined, requestDate: undefined })
    expect(parseViesResponse({ valid: true, name: 'X GmbH' }, 'DE', '1')).toMatchObject({ status: 'valid', name: 'X GmbH' })
    expect(parseViesResponse({ isValid: false, userError: 'INVALID' }, 'DE', '1')).toMatchObject({ status: 'invalid' })
    expect(parseViesResponse({ isValid: false, userError: 'MS_MAX_CONCURRENT_REQ' }, 'DE', '1')).toMatchObject({ status: 'unavailable', reason: 'MS_MAX_CONCURRENT_REQ' })
    expect(parseViesResponse({ foo: 1 }, 'DE', '1')).toMatchObject({ status: 'unavailable', reason: 'unexpected response' })
    expect(parseViesResponse(null, 'DE', '1')).toMatchObject({ status: 'unavailable' })
  })
})
