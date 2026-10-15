import { describe, expect, it } from 'vitest'
import { BackupCryptoError, decryptText, encryptText, ENCRYPTED_BACKUP_FORMAT, isEncryptedEnvelope, PBKDF2_ITERATIONS, type EncryptedEnvelope } from './backupCrypto'

const ITER = 310_000
const PLAIN = JSON.stringify({ app: 'invoice-generator', note: 'Õunad ja äädikas – 12,50 €' })

describe('backup encryption', () => {
  it('round-trips text with AES-GCM and a PBKDF2 key', async () => {
    const enc = await encryptText(PLAIN, 'pikk parool 123', { iterations: ITER })
    const env = JSON.parse(enc) as EncryptedEnvelope
    expect(env.format).toBe(ENCRYPTED_BACKUP_FORMAT)
    expect(env.version).toBe(1)
    expect(env.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITER })
    expect(env.cipher).toMatchObject({ name: 'AES-GCM', length: 256 })
    expect(atob(env.kdf.salt)).toHaveLength(16)
    expect(atob(env.cipher.iv)).toHaveLength(12)
    expect(enc).not.toContain('invoice-generator"')
    expect(await decryptText(enc, 'pikk parool 123')).toBe(PLAIN)
  })

  it('uses at least 310 000 iterations by default and never fewer', async () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(310_000)
    const enc = await encryptText('x', 'parool123', { iterations: 1000 })
    expect((JSON.parse(enc) as EncryptedEnvelope).kdf.iterations).toBe(310_000)
  })

  it('uses a fresh salt and IV every time', async () => {
    const a = JSON.parse(await encryptText(PLAIN, 'parool123', { iterations: ITER })) as EncryptedEnvelope
    const b = JSON.parse(await encryptText(PLAIN, 'parool123', { iterations: ITER })) as EncryptedEnvelope
    expect(a.kdf.salt).not.toBe(b.kdf.salt)
    expect(a.cipher.iv).not.toBe(b.cipher.iv)
    expect(a.data).not.toBe(b.data)
  })

  it('rejects a wrong passphrase with a bilingual error', async () => {
    const enc = await encryptText(PLAIN, 'õige parool', { iterations: ITER })
    const err = await decryptText(enc, 'vale parool').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BackupCryptoError)
    expect(err).toMatchObject({ code: 'wrong_passphrase', messages: { et: expect.stringContaining('parool') } })
  })

  it('detects tampered ciphertext', async () => {
    const env = JSON.parse(await encryptText(PLAIN, 'parool123', { iterations: ITER })) as EncryptedEnvelope
    const bytes = Uint8Array.from(atob(env.data), (c) => c.charCodeAt(0))
    bytes[0] ^= 1
    const tampered = JSON.stringify({ ...env, data: btoa(String.fromCharCode(...bytes)) })
    await expect(decryptText(tampered, 'parool123')).rejects.toMatchObject({ code: 'wrong_passphrase' })
  })

  it('treats NFC and NFD spellings of a passphrase as the same', async () => {
    const enc = await encryptText(PLAIN, 'Jõulud', { iterations: ITER })
    expect(await decryptText(enc, 'Jõulud'.normalize('NFD'))).toBe(PLAIN)
  })

  it('rejects malformed envelopes and unsafe parameters', async () => {
    const env = JSON.parse(await encryptText(PLAIN, 'parool123', { iterations: ITER })) as EncryptedEnvelope
    const bad = (patch: object) => decryptText(JSON.stringify({ ...env, ...patch }), 'parool123')
    await expect(decryptText('not json', 'x')).rejects.toMatchObject({ code: 'invalid_format' })
    await expect(decryptText('{"app":"invoice-generator"}', 'x')).rejects.toMatchObject({ code: 'invalid_format' })
    await expect(bad({ version: 2 })).rejects.toMatchObject({ code: 'invalid_format' })
    await expect(bad({ kdf: { ...env.kdf, iterations: 1000 } })).rejects.toMatchObject({ code: 'invalid_format' })
    await expect(bad({ kdf: { ...env.kdf, iterations: 1e9 } })).rejects.toMatchObject({ code: 'invalid_format' })
    await expect(bad({ cipher: { ...env.cipher, iv: 'AAAA' } })).rejects.toMatchObject({ code: 'invalid_format' })
    await expect(bad({ data: 'not base64!' })).rejects.toMatchObject({ code: 'invalid_format' })
    for (const data of ['A', 'AAAAA', 'AA=A', 'AAA==']) {
      await expect(bad({ data })).rejects.toBeInstanceOf(BackupCryptoError)
      await expect(bad({ kdf: { ...env.kdf, salt: data } })).rejects.toMatchObject({ code: 'invalid_format' })
    }
  })

  it('recognises encrypted envelopes', async () => {
    expect(isEncryptedEnvelope(await encryptText('x', 'parool123', { iterations: ITER }))).toBe(true)
    expect(isEncryptedEnvelope(PLAIN)).toBe(false)
    expect(isEncryptedEnvelope('garbage')).toBe(false)
  })
})
