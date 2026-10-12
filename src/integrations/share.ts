// Device-native fallbacks: Web Share API (Level 2, files), mailto: links and plain downloads.
import type { EmailDraft } from './types'

/** True if navigator.canShare({files}) is supported for these files. */
export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return false
  try {
    return navigator.canShare({ files })
  } catch {
    return false
  }
}

function toFiles(draft: EmailDraft): File[] {
  return draft.attachments.map((a) =>
    a.blob instanceof File && a.blob.name === a.fileName ? a.blob : new File([a.blob], a.fileName, { type: a.blob.type || 'application/pdf' }),
  )
}

/**
 * Web Share API with the PDF attached (opens native mail/share sheet). Must be called from a user gesture.
 * Resolves true when shared, false when the user dismissed the share sheet.
 */
export async function shareFiles(draft: EmailDraft): Promise<boolean> {
  const files = toFiles(draft)
  if (!canShareFiles(files)) {
    throw new Error('Sharing files is not supported in this browser / Selles brauseris ei saa faile jagada')
  }
  try {
    await navigator.share({ files, title: draft.subject, text: draft.body })
    return true
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false
    throw e
  }
}

const encodeAddress = (a: string) => encodeURIComponent(a.trim()).replace(/%40/g, '@')

/**
 * mailto: URL (RFC 6068; no attachments possible — UI downloads the PDF first and tells the user to attach it).
 * Line breaks in the body become CRLF (%0D%0A). Keep bodies short: some clients cut URLs at ~2000 chars.
 */
export function buildMailtoUrl(draft: Omit<EmailDraft, 'attachments'>): string {
  const to = draft.to.map((a) => a.trim()).filter(Boolean).map(encodeAddress).join(',')
  const params: string[] = []
  const cc = (draft.cc ?? []).map((a) => a.trim()).filter(Boolean)
  if (cc.length) params.push(`cc=${cc.map(encodeAddress).join(',')}`)
  if (draft.subject) params.push(`subject=${encodeURIComponent(draft.subject)}`)
  if (draft.body) params.push(`body=${encodeURIComponent(draft.body.replace(/\r\n|\r|\n/g, '\r\n'))}`)
  return `mailto:${to}${params.length ? `?${params.join('&')}` : ''}`
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke later: some browsers (Safari, Firefox) start reading the URL asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
