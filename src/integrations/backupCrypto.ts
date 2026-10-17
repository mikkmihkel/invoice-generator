// Passphrase encryption for backup files: PBKDF2-SHA-256 key derivation + AES-256-GCM, Web Crypto only.
// The result is a small self-describing JSON envelope, so any backup can be decrypted with just the passphrase.
import type { Bilingual } from './errors'

export const ENCRYPTED_BACKUP_FORMAT = 'invoice-generator-encrypted-backup'
/** OWASP's current recommendation for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 600_000
/** Bounds accepted when decrypting: below is too weak to have been written by this app, above would hang the tab. */
const MIN_ITERATIONS = 310_000
const MAX_ITERATIONS = 10_000_000
const SALT_BYTES = 16
const IV_BYTES = 12

export interface EncryptedEnvelope {
  format: typeof ENCRYPTED_BACKUP_FORMAT
  version: 1
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  cipher: { name: 'AES-GCM'; length: 256; iv: string }
  /** Base64 ciphertext including the GCM tag. */
  data: string
}

export type BackupCryptoErrorCode = 'wrong_passphrase' | 'invalid_format' | 'unsupported'

const MESSAGES: Record<BackupCryptoErrorCode, Bilingual> = {
  wrong_passphrase: {
    et: 'Varukoopiat ei õnnestunud dekrüpteerida. Kontrolli parooli.',
    en: 'Could not decrypt the backup. Check the passphrase.',
  },
  invalid_format: {
    et: 'Krüpteeritud varukoopia fail on vigane.',
    en: 'The encrypted backup file is damaged.',
  },
  unsupported: {
    et: 'See brauser ei toeta krüpteerimist. Kasuta uuemat brauserit.',
    en: 'This browser does not support encryption. Use a newer browser.',
  },
}

export class BackupCryptoError extends Error {
  readonly code: BackupCryptoErrorCode
  readonly messages: Bilingual
  constructor(code: BackupCryptoErrorCode) {
    super(MESSAGES[code].en)
    this.name = 'BackupCryptoError'
    this.code = code
    this.messages = MESSAGES[code]
  }
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (!s) throw new BackupCryptoError('unsupported')
  return s
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  // btoa always pads to a multiple of 4; anything else is damaged (and some of it would make atob throw).
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new BackupCryptoError('invalid_format')
  let bin: string
  try {
    bin = atob(b64)
  } catch {
    throw new BackupCryptoError('invalid_format')
  }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n)
  globalThis.crypto.getRandomValues(b)
  return b
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number, usage: KeyUsage): Promise<CryptoKey> {
  const material = await subtle().importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [usage])
}

/** Encrypt text with a passphrase; returns the JSON envelope as text. `iterations` is clamped to the accepted range. */
export async function encryptText(plaintext: string, passphrase: string, options: { iterations?: number } = {}): Promise<string> {
  if (!passphrase) throw new BackupCryptoError('wrong_passphrase')
  const iterations = Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, Math.round(options.iterations ?? PBKDF2_ITERATIONS)))
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await deriveKey(passphrase, salt, iterations, 'encrypt')
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)))
  const envelope: EncryptedEnvelope = {
    format: ENCRYPTED_BACKUP_FORMAT,
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', length: 256, iv: toBase64(iv) },
    data: toBase64(data),
  }
  return JSON.stringify(envelope)
}

function parseEnvelope(text: string): EncryptedEnvelope | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const e = v as Partial<EncryptedEnvelope>
  return e.format === ENCRYPTED_BACKUP_FORMAT ? (e as EncryptedEnvelope) : null
}

/** Whether the text looks like an encrypted backup envelope (cheap check before asking for a passphrase). */
export function isEncryptedEnvelope(text: string): boolean {
  return text.trimStart().startsWith('{') && parseEnvelope(text) !== null
}

/** Decrypt an envelope made by `encryptText`. A wrong passphrase (or tampered data) throws 'wrong_passphrase'. */
export async function decryptText(envelopeText: string, passphrase: string): Promise<string> {
  const e = parseEnvelope(envelopeText)
  if (!e) throw new BackupCryptoError('invalid_format')
  const { kdf, cipher } = e
  const valid =
    e.version === 1 &&
    kdf?.name === 'PBKDF2' &&
    kdf.hash === 'SHA-256' &&
    Number.isInteger(kdf.iterations) &&
    kdf.iterations >= MIN_ITERATIONS &&
    kdf.iterations <= MAX_ITERATIONS &&
    typeof kdf.salt === 'string' &&
    cipher?.name === 'AES-GCM' &&
    cipher.length === 256 &&
    typeof cipher.iv === 'string' &&
    typeof e.data === 'string'
  if (!valid) throw new BackupCryptoError('invalid_format')
  const salt = fromBase64(kdf.salt)
  const iv = fromBase64(cipher.iv)
  const data = fromBase64(e.data)
  if (salt.length < 8 || iv.length !== IV_BYTES || data.length < 16) throw new BackupCryptoError('invalid_format')
  if (!passphrase) throw new BackupCryptoError('wrong_passphrase')
  const key = await deriveKey(passphrase, salt, kdf.iterations, 'decrypt')
  let plain: ArrayBuffer
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv }, key, data)
  } catch {
    throw new BackupCryptoError('wrong_passphrase')
  }
  return new TextDecoder().decode(plain)
}
