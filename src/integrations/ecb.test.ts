import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearEcbCache, ecbRateUrl, EcbRateError, fetchEcbRate, parseEcbCsv } from './ecb'

const CSV = [
  'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS,TITLE',
  'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-08,1.0841,A,"US dollar/Euro, daily"',
  'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-09,1.0832,A,"US dollar/Euro, daily"',
].join('\r\n')

const respond = (body: string, status = 200) => vi.fn(async () => new Response(body, { status }))

afterEach(() => clearEcbCache())

describe('ecb', () => {
  it('builds the Data Portal URL with a ten-day look-back window', () => {
    expect(ecbRateUrl('USD', '2026-10-11')).toBe(
      'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=2026-10-01&endPeriod=2026-10-11&format=csvdata',
    )
  })

  it('parses csvdata by column name, including quoted commas', () => {
    expect(parseEcbCsv('﻿' + CSV)).toEqual([
      { date: '2026-10-08', rate: 1.0841 },
      { date: '2026-10-09', rate: 1.0832 },
    ])
    expect(() => parseEcbCsv('A,B\n1,2')).toThrow(EcbRateError)
  })

  it('takes the last rate published on or before the date (weekend → Friday)', async () => {
    const f = respond(CSV)
    await expect(fetchEcbRate('usd', '2026-10-11', f)).resolves.toEqual({ currency: 'USD', rate: 1.0832, date: '2026-10-09' })
  })

  it('caches per currency and date', async () => {
    const f = respond(CSV)
    await fetchEcbRate('USD', '2026-10-11', f)
    await fetchEcbRate('USD', '2026-10-11', f)
    expect(f).toHaveBeenCalledTimes(1)
    await fetchEcbRate('USD', '2026-10-12', f)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('sends a CORS simple request (plain GET, no custom headers) so the browser needs no preflight', async () => {
    const f = respond(CSV)
    await fetchEcbRate('USD', '2026-10-11', f)
    const init = ((f.mock.calls[0] as unknown[])[1] ?? {}) as RequestInit
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.headers).toBeUndefined()
    expect(init.body).toBeUndefined()
  })

  it('returns 1 for EUR without a request and rejects malformed input', async () => {
    const f = respond(CSV)
    await expect(fetchEcbRate('EUR', '2026-10-11', f)).resolves.toEqual({ currency: 'EUR', rate: 1, date: '2026-10-11' })
    await expect(fetchEcbRate('US', '2026-10-11', f)).rejects.toMatchObject({ code: 'unsupported-currency' })
    await expect(fetchEcbRate('USD', '11.10.2026', f)).rejects.toMatchObject({ code: 'bad-response' })
    expect(f).not.toHaveBeenCalled()
  })

  it('reports missing data and network failures, and does not cache them', async () => {
    await expect(fetchEcbRate('XYZ', '2026-10-11', respond('', 404))).rejects.toMatchObject({ code: 'not-found' })
    await expect(fetchEcbRate('USD', '2026-10-11', respond(''))).rejects.toMatchObject({ code: 'not-found' })
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(fetchEcbRate('USD', '2026-10-11', down)).rejects.toMatchObject({ code: 'network' })
    await expect(fetchEcbRate('USD', '2026-10-11', respond(CSV))).resolves.toMatchObject({ rate: 1.0832 })
  })
})
