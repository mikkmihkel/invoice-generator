import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { buildMailtoUrl, canShareFiles, downloadBlob, shareFiles } from './share'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete (navigator as unknown as Record<string, unknown>).canShare
  delete (navigator as unknown as Record<string, unknown>).share
})

describe('buildMailtoUrl', () => {
  it('encodes subject/body with CRLF line breaks and multiple recipients', () => {
    const url = buildMailtoUrl({
      to: ['klient@example.ee', ' teine+arved@example.ee '],
      cc: ['raamat@example.ee'],
      subject: 'Arve 2026-0007 & Õunapuu OÜ',
      body: 'Tere!\n\nSumma: 124,00 €\nTähtaeg: 24.03.2026',
    })
    expect(url).toBe(
      'mailto:klient@example.ee,teine%2Barved@example.ee?cc=raamat@example.ee' +
        '&subject=Arve%202026-0007%20%26%20%C3%95unapuu%20O%C3%9C' +
        '&body=Tere!%0D%0A%0D%0ASumma%3A%20124%2C00%20%E2%82%AC%0D%0AT%C3%A4htaeg%3A%2024.03.2026',
    )
    const parsed = new URL(url)
    expect(parsed.searchParams.get('subject')).toBe('Arve 2026-0007 & Õunapuu OÜ')
    expect(parsed.searchParams.get('body')).toBe('Tere!\r\n\r\nSumma: 124,00 €\r\nTähtaeg: 24.03.2026')
  })

  it('omits empty parts', () => {
    expect(buildMailtoUrl({ to: ['a@b.ee'], subject: '', body: '' })).toBe('mailto:a@b.ee')
    expect(buildMailtoUrl({ to: [], subject: 'x', body: '' })).toBe('mailto:?subject=x')
  })
})

describe('Web Share', () => {
  const draft = { to: ['a@b.ee'], subject: 'Arve', body: 'Tere', attachments: [{ fileName: 'arve.pdf', blob: new Blob(['%PDF'], { type: 'application/pdf' }) }] }

  it('canShareFiles is false without the API', () => {
    expect(canShareFiles([new File(['x'], 'x.pdf')])).toBe(false)
  })

  it('shares files as File objects and reports cancellation', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { canShare: vi.fn().mockReturnValue(true), share })
    expect(await shareFiles(draft)).toBe(true)
    const data = share.mock.calls[0][0] as ShareData
    expect(data.title).toBe('Arve')
    expect(data.files?.[0]).toBeInstanceOf(File)
    expect(data.files?.[0].name).toBe('arve.pdf')
    expect(data.files?.[0].type).toBe('application/pdf')

    share.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
    expect(await shareFiles(draft)).toBe(false)
  })

  it('throws when files cannot be shared', async () => {
    Object.assign(navigator, { canShare: vi.fn().mockReturnValue(false), share: vi.fn() })
    await expect(shareFiles(draft)).rejects.toThrow(/not supported/)
  })
})

describe('downloadBlob', () => {
  it('clicks a temporary anchor and revokes the object URL later', () => {
    vi.useFakeTimers()
    const create = vi.fn().mockReturnValue('blob:mock')
    const revoke = vi.fn()
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    onTestFinished(() => {
      Object.assign(URL, original)
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('Arve_2026-0007.pdf')
      expect(this.getAttribute('href')).toBe('blob:mock')
      expect(this.isConnected).toBe(true)
    })
    downloadBlob(new Blob(['x']), 'Arve_2026-0007.pdf')
    expect(click).toHaveBeenCalledTimes(1)
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:mock')
  })
})
