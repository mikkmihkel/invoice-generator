// Pure RFC 2822 / MIME message builder (RFC 2045-2047, RFC 2231) for the Gmail API.

export interface MimeAttachment {
  fileName: string
  mimeType: string
  data: Uint8Array
}

export interface MimeMessageInput {
  from?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  replyTo?: string
  subject: string
  /** Plain text; any line-ending style. */
  body: string
  attachments?: MimeAttachment[]
}

export interface MimeBuildOptions {
  /** Fixed boundary (tests). */
  boundary?: string
  /** Adds a Date header if given (Gmail sets one otherwise). */
  date?: Date
}

const CRLF = '\r\n'

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

/**
 * base64url without padding (RFC 4648 §5), as required for Gmail `raw`. Never throws on content:
 * bytes are encoded as-is; a string whose code units are all ≤ 0xFF is treated as a binary (Latin-1)
 * string, any other string is encoded as UTF-8. (A MIME message from buildMimeMessage is pure ASCII,
 * where both readings agree.)
 */
export function toBase64Url(input: string | Uint8Array): string {
  let bytes: Uint8Array
  if (typeof input !== 'string') bytes = input
  else if (/^[\x00-\xff]*$/.test(input)) bytes = Uint8Array.from(input, (c) => c.charCodeAt(0))
  else bytes = new TextEncoder().encode(input)
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Wrap base64 (or any) text at `width` chars with CRLF (RFC 2045 §6.8: max 76). */
export function wrapLines(text: string, width = 76): string {
  const lines: string[] = []
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width))
  return lines.join(CRLF)
}

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s)

/**
 * RFC 2047 "B" encoded-words for non-ASCII header text. Each word stays ≤ 75 chars and never splits a
 * UTF-8 sequence; words are folded with CRLF + space. ASCII text is returned unchanged.
 */
export function encodeHeaderWord(text: string): string {
  if (isAscii(text)) return text
  const enc = new TextEncoder()
  const words: number[][] = []
  let current: number[] = []
  for (const ch of text) {
    const bytes = [...enc.encode(ch)]
    // 45 bytes -> 60 base64 chars; "=?UTF-8?B?" + 60 + "?=" = 72 chars
    if (current.length + bytes.length > 45) {
      words.push(current.splice(0))
    }
    current.push(...bytes)
  }
  if (current.length) words.push(current)
  return words.map((w) => `=?UTF-8?B?${bytesToBase64(Uint8Array.from(w))}?=`).join(`${CRLF} `)
}

function assertNoLineBreaks(value: string, field: string) {
  if (/[\r\n]/.test(value)) throw new Error(`Invalid ${field}: line breaks are not allowed`)
}

/** Raised for an email address that cannot be put into a message header. Carries a bilingual message. */
export class InvalidEmailAddressError extends Error {
  readonly address: string
  readonly messages: { et: string; en: string }
  constructor(address: string, nonAscii: boolean) {
    const messages = nonAscii
      ? {
          et: `E-posti aadress „${address}“ sisaldab täpitähti või muid märke, mida e-posti aadressis kasutada ei saa. Kontrolli aadressi.`,
          en: `The email address "${address}" contains accented or other non-ASCII characters, which are not supported. Please check the address.`,
        }
      : {
          et: `E-posti aadress „${address}“ on vigane.`,
          en: `"${address}" is not a valid email address.`,
        }
    super(messages.en)
    this.name = 'InvalidEmailAddressError'
    this.address = address
    this.messages = messages
  }
}

// RFC 5322 dot-atom local part and an LDH domain (ASCII only; IDN / SMTPUTF8 addresses are not supported).
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
const DOMAIN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/

/** Throws InvalidEmailAddressError unless `email` is a plain ASCII addr-spec ("local@domain"). */
export function assertValidEmail(email: string): void {
  if (!isAscii(email)) throw new InvalidEmailAddressError(email, true)
  const at = email.lastIndexOf('@')
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (at < 1 || email.length > 254 || local.length > 64 || !LOCAL_PART.test(local) || !DOMAIN.test(domain)) {
    throw new InvalidEmailAddressError(email, false)
  }
}

/** Split `Name <addr>`, `"Name, Quoted" <addr>`, `<addr>` or a bare `addr` into display name and address. */
export function parseAddress(input: string): { name: string; email: string } {
  const trimmed = input.trim()
  assertNoLineBreaks(trimmed, 'address')
  const open = trimmed.lastIndexOf('<')
  if (open === -1 || !trimmed.endsWith('>')) return { name: '', email: trimmed }
  let name = trimmed.slice(0, open).trim()
  const q = /^"((?:[^"\\]|\\.)*)"$/.exec(name)
  if (q) name = q[1].replace(/\\(.)/g, '$1')
  return { name, email: trimmed.slice(open + 1, -1).trim() }
}

/**
 * Format one address for a header: `Name <a@b>` (name RFC 2047-encoded if non-ASCII, quoted if it has
 * specials) or a bare `a@b`. The address itself must be ASCII; otherwise InvalidEmailAddressError is thrown.
 */
export function formatAddress(address: string): string {
  const { name, email } = parseAddress(address)
  assertValidEmail(email)
  if (!name) return email
  let display = name
  if (!isAscii(display)) display = encodeHeaderWord(display)
  else if (/[()<>[\]:;@\\,."]|=\?/.test(display)) display = `"${display.replace(/(["\\])/g, '\\$1')}"`
  return `${display} <${email}>`
}

function addressList(list: string[] | undefined): string {
  return (list ?? [])
    .map((a) => a.trim())
    .filter(Boolean)
    .map(formatAddress)
    .join(`,${CRLF} `)
}

/** Strip diacritics for an ASCII fallback file name ("Arve_Õunapuu.pdf" → "Arve_Ounapuu.pdf"). */
export function asciiFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
}

/** RFC 2231 extended parameter value: UTF-8''percent-encoded. */
function rfc2231(value: string): string {
  return `UTF-8''${encodeURIComponent(value).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
}

function attachmentHeaders(a: MimeAttachment): string[] {
  const fallback = asciiFileName(a.fileName)
  const nameParam = isAscii(a.fileName) ? `"${fallback}"` : `"${encodeHeaderWord(a.fileName).replace(/\r\n /g, ' ')}"`
  const disposition = isAscii(a.fileName)
    ? `attachment; filename="${fallback}"`
    : `attachment; filename="${fallback}";${CRLF} filename*=${rfc2231(a.fileName)}`
  return [`Content-Type: ${a.mimeType || 'application/octet-stream'}; name=${nameParam}`, `Content-Disposition: ${disposition}`, 'Content-Transfer-Encoding: base64']
}

function randomBoundary(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `=_ig_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Build a complete RFC 2822 message (CRLF line endings, 7-bit ASCII only). Text body is UTF-8 in base64;
 * with attachments the message is multipart/mixed.
 */
export function buildMimeMessage(input: MimeMessageInput, options: MimeBuildOptions = {}): string {
  const to = addressList(input.to)
  if (!to) throw new Error('At least one recipient is required')
  assertNoLineBreaks(input.subject, 'subject')

  const headers: string[] = []
  if (input.from) headers.push(`From: ${formatAddress(input.from)}`)
  headers.push(`To: ${to}`)
  const cc = addressList(input.cc)
  if (cc) headers.push(`Cc: ${cc}`)
  const bcc = addressList(input.bcc)
  if (bcc) headers.push(`Bcc: ${bcc}`)
  if (input.replyTo) headers.push(`Reply-To: ${formatAddress(input.replyTo)}`)
  if (options.date) headers.push(`Date: ${options.date.toUTCString().replace('GMT', '+0000')}`)
  headers.push(`Subject: ${encodeHeaderWord(input.subject)}`)
  headers.push('MIME-Version: 1.0')

  const bodyText = input.body.replace(/\r\n|\r|\n/g, CRLF)
  const textPartHeaders = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64']
  const textPart = wrapLines(utf8ToBase64(bodyText))

  const attachments = input.attachments ?? []
  if (attachments.length === 0) {
    return [...headers, ...textPartHeaders, '', textPart, ''].join(CRLF)
  }

  const boundary = options.boundary ?? randomBoundary()
  const lines = [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', 'This is a multi-part message in MIME format.', '']
  lines.push(`--${boundary}`, ...textPartHeaders, '', textPart, '')
  for (const a of attachments) {
    lines.push(`--${boundary}`, ...attachmentHeaders(a), '', wrapLines(bytesToBase64(a.data)), '')
  }
  lines.push(`--${boundary}--`, '')
  return lines.join(CRLF)
}
