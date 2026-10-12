// Gmail API (scope gmail.send). Sends as the signed-in user; Gmail fills in From and Date.
import { googleFetch } from './http'
import { buildMimeMessage, toBase64Url, type MimeAttachment } from './mime'
import type { EmailDraft } from './types'

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  // Older environments (e.g. some jsdom versions)
  return new Uint8Array(
    await new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as ArrayBuffer)
      r.onerror = () => reject(r.error)
      r.readAsArrayBuffer(blob)
    }),
  )
}

/** Turn an EmailDraft into the base64url `raw` value for users.messages.send. */
export async function buildGmailRaw(draft: EmailDraft, from?: string): Promise<string> {
  const attachments: MimeAttachment[] = await Promise.all(
    draft.attachments.map(async (a) => ({
      fileName: a.fileName,
      mimeType: a.blob.type || 'application/octet-stream',
      data: await blobBytes(a.blob),
    })),
  )
  const mime = buildMimeMessage({ from, to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body, attachments })
  return toBase64Url(mime)
}

/**
 * Send email with attachments through Gmail API (scope gmail.send). Returns the Gmail message id.
 * The simple JSON endpoint accepts messages up to ~5 MB, plenty for invoice PDFs.
 */
export async function sendViaGmail(clientId: string, draft: EmailDraft): Promise<{ id: string; threadId?: string }> {
  const raw = await buildGmailRaw(draft)
  const res = await googleFetch(clientId, ['gmail'], SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  return (await res.json()) as { id: string; threadId?: string }
}
