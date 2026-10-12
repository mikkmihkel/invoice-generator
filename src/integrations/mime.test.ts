import { describe, expect, it } from 'vitest'
import { asciiFileName, buildMimeMessage, encodeHeaderWord, formatAddress, toBase64Url, wrapLines } from './mime'

const utf8 = (s: string) => new TextEncoder().encode(s)
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
const b64ToUtf8 = (b64: string) => new TextDecoder().decode(b64ToBytes(b64))

/** Decode RFC 2047 B-encoded words (folded with CRLF SP) back to text. */
function decodeWords(header: string): string {
  // whitespace between adjacent encoded words is ignored (RFC 2047 §6.2)
  const joined = header.replace(/\?=\s+=\?/g, '?==?')
  return joined.replace(/(?:=\?UTF-8\?B\?[^?]*\?=)+/g, (run) => {
    const bytes = [...run.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)].flatMap((m) => [...b64ToBytes(m[1])])
    return new TextDecoder().decode(Uint8Array.from(bytes))
  })
}

function parse(msg: string) {
  const [head, ...rest] = msg.split('\r\n\r\n')
  const body = rest.join('\r\n\r\n')
  const headers = new Map<string, string>()
  for (const line of head.split(/\r\n(?![ \t])/)) {
    const i = line.indexOf(':')
    headers.set(line.slice(0, i).toLowerCase(), line.slice(i + 1).trim())
  }
  return { headers, body }
}

function parts(msg: string) {
  const { headers, body } = parse(msg)
  const boundary = /boundary="([^"]+)"/.exec(headers.get('content-type')!)![1]
  const sections = body.split(`--${boundary}`)
  expect(sections.at(-1)!.startsWith('--')).toBe(true)
  return sections.slice(1, -1).map((s) => parse(s.replace(/^\r\n/, '')))
}

describe('encodeHeaderWord', () => {
  it('leaves ASCII untouched', () => {
    expect(encodeHeaderWord('Invoice 2026-0007')).toBe('Invoice 2026-0007')
  })

  it('encodes Estonian characters as UTF-8 B-words that round-trip', () => {
    const subject = 'Arve nr 2026-0007 – Õunapuu OÜ, šokolaad ja žürii'
    const encoded = encodeHeaderWord(subject)
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/)
    expect(encoded).toMatch(/^[\x20-\x7e\r\n]*$/)
    expect(decodeWords(encoded)).toBe(subject)
  })

  it('splits long text into words ≤ 75 chars without breaking multi-byte characters', () => {
    const subject = 'Õ'.repeat(100) + ' ärikliendile'
    const encoded = encodeHeaderWord(subject)
    const words = encoded.split('\r\n ')
    expect(words.length).toBeGreaterThan(1)
    for (const w of words) {
      expect(w.length).toBeLessThanOrEqual(75)
      // each word decodes on its own (no split UTF-8 sequence)
      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(b64ToBytes(w.slice(10, -2)))).not.toThrow()
    }
    expect(decodeWords(encoded)).toBe(subject)
  })
})

describe('formatAddress', () => {
  it('keeps bare addresses and encodes non-ASCII display names', () => {
    expect(formatAddress(' a@b.ee ')).toBe('a@b.ee')
    expect(formatAddress('Jüri Mägi <juri@example.ee>')).toMatch(/^=\?UTF-8\?B\?.+\?= <juri@example\.ee>$/)
    expect(decodeWords(formatAddress('Jüri Mägi <juri@example.ee>'))).toBe('Jüri Mägi <juri@example.ee>')
    expect(formatAddress('Mets, Mari <mari@example.ee>')).toBe('"Mets, Mari" <mari@example.ee>')
  })

  it('rejects header injection', () => {
    expect(() => formatAddress('a@b.ee\r\nBcc: evil@x.com')).toThrow()
  })
})

describe('buildMimeMessage', () => {
  const pdfBytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256)
  const input = {
    to: ['klient@example.ee', 'Jüri Mägi <juri@example.ee>'],
    cc: ['raamatupidaja@example.ee'],
    subject: 'Arve 2026-0007 – Õunapuu OÜ',
    body: 'Tere!\n\nSaadan arve nr 2026-0007. Tähtaeg: 24.03.2026.\nSumma: 124,00 €\n\nLugupidamisega\nMänguasjad OÜ',
    attachments: [
      { fileName: 'Arve_2026-0007_Õunapuu-OÜ.pdf', mimeType: 'application/pdf', data: pdfBytes },
      { fileName: 'arve.xml', mimeType: 'application/xml', data: utf8('<Invoice>õ</Invoice>') },
    ],
  }
  const msg = buildMimeMessage(input, { boundary: 'BOUNDARY123', date: new Date('2026-03-10T10:00:00Z') })

  it('is 7-bit ASCII with CRLF line endings and line lengths within limits', () => {
    expect(msg).toMatch(/^[\x20-\x7e\r\n]*$/)
    expect(msg.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    for (const line of msg.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998)
  })

  it('has the expected top-level headers', () => {
    const { headers } = parse(msg)
    expect(headers.get('mime-version')).toBe('1.0')
    expect(headers.get('content-type')).toBe('multipart/mixed; boundary="BOUNDARY123"')
    expect(decodeWords(headers.get('subject')!)).toBe(input.subject)
    const to = decodeWords(headers.get('to')!).replace(/\r\n /g, ' ')
    expect(to).toBe('klient@example.ee, Jüri Mägi <juri@example.ee>')
    expect(headers.get('cc')).toBe('raamatupidaja@example.ee')
    expect(headers.get('date')).toBe('Tue, 10 Mar 2026 10:00:00 +0000')
    expect(headers.has('from')).toBe(false)
  })

  it('encodes the UTF-8 text body in base64 with CRLF line breaks', () => {
    const [text] = parts(msg)
    expect(text.headers.get('content-type')).toBe('text/plain; charset=UTF-8')
    expect(text.headers.get('content-transfer-encoding')).toBe('base64')
    expect(b64ToUtf8(text.body)).toBe(input.body.replace(/\n/g, '\r\n'))
  })

  it('encodes attachments in base64 wrapped at 76 chars with UTF-8 file names', () => {
    const [, pdf, xml] = parts(msg)
    const lines = pdf.body.trimEnd().split('\r\n')
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(76)
    expect(lines[0]).toHaveLength(76)
    expect(b64ToBytes(pdf.body)).toEqual(pdfBytes)

    expect(pdf.headers.get('content-type')).toMatch(/^application\/pdf; name="=\?UTF-8\?B\?/)
    expect(decodeWords(/name="([^"]+)"/.exec(pdf.headers.get('content-type')!)![1])).toBe('Arve_2026-0007_Õunapuu-OÜ.pdf')
    const disposition = pdf.headers.get('content-disposition')!
    expect(disposition).toContain('attachment; filename="Arve_2026-0007_Ounapuu-OU.pdf"')
    const star = /filename\*=UTF-8''(\S+)/.exec(disposition)![1]
    expect(decodeURIComponent(star)).toBe('Arve_2026-0007_Õunapuu-OÜ.pdf')

    expect(xml.headers.get('content-type')).toBe('application/xml; name="arve.xml"')
    expect(xml.headers.get('content-disposition')).toBe('attachment; filename="arve.xml"')
    expect(b64ToUtf8(xml.body)).toBe('<Invoice>õ</Invoice>')
  })

  it('builds a single-part message without attachments', () => {
    const simple = buildMimeMessage({ to: ['a@b.ee'], subject: 'Hello', body: 'Tšau' })
    const { headers, body } = parse(simple)
    expect(headers.get('content-type')).toBe('text/plain; charset=UTF-8')
    expect(headers.get('subject')).toBe('Hello')
    expect(b64ToUtf8(body)).toBe('Tšau')
  })

  it('requires a recipient and rejects line breaks in the subject', () => {
    expect(() => buildMimeMessage({ to: [' '], subject: 'x', body: '' })).toThrow(/recipient/)
    expect(() => buildMimeMessage({ to: ['a@b.ee'], subject: 'x\r\nBcc: e@x.com', body: '' })).toThrow()
  })

  it('uses a random boundary by default', () => {
    const a = buildMimeMessage(input)
    const b = buildMimeMessage(input)
    const boundary = (m: string) => /boundary="([^"]+)"/.exec(m)![1]
    expect(boundary(a)).not.toBe(boundary(b))
  })
})

describe('helpers', () => {
  it('base64url-encodes without padding or +/', () => {
    const raw = toBase64Url('\xfb\xff\xfe?>')
    expect(raw).not.toMatch(/[+/=]/)
    expect(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))).toBe('\xfb\xff\xfe?>')
  })

  it('wraps lines', () => {
    expect(wrapLines('abcdefg', 3)).toBe('abc\r\ndef\r\ng')
  })

  it('makes ASCII fallback file names', () => {
    expect(asciiFileName('Arve_Õunapuu_šokolaad_Žürii.pdf')).toBe('Arve_Ounapuu_sokolaad_Zurii.pdf')
  })
})
