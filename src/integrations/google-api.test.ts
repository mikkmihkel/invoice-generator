import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backupToDrive, downloadDriveFile, DRIVE_BACKUP_FILE_NAME, findOrCreateFolder, listDriveBackups, restoreFromDrive, trashDriveFile, uploadBackupVersion, uploadToDrive } from './drive'
import { GoogleApiError } from './errors'
import { buildGmailRaw, sendViaGmail } from './gmail'
import { getAccessToken, invalidateToken } from './googleAuth'

vi.mock('./googleAuth', () => {
  let n = 0
  return {
    getAccessToken: vi.fn(async () => `token-${++n}`),
    invalidateToken: vi.fn(),
    forgetScope: vi.fn(),
  }
})

const CLIENT = 'client.apps.googleusercontent.com'

type Call = { url: string; init: RequestInit }
let calls: Call[]
let responses: (() => Response)[]

const json = (data: unknown, status = 200) => () =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

function stubFetch(...r: (() => Response)[]) {
  responses = r
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init })
      const next = responses.shift()
      if (!next) throw new Error(`unexpected fetch ${url}`)
      return next()
    }),
  )
}

const bodyText = async (body: BodyInit | null | undefined) => {
  if (body instanceof Blob) {
    return new TextDecoder().decode(new Uint8Array(await body.arrayBuffer()))
  }
  return String(body)
}
const query = (url: string) => new URL(url).searchParams
const auth = (c: Call) => new Headers(c.init.headers).get('Authorization')

beforeEach(() => {
  calls = []
  vi.mocked(getAccessToken).mockClear()
  vi.mocked(invalidateToken).mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Drive', () => {
  it('finds an existing folder by name with an escaped query', async () => {
    stubFetch(json({ files: [{ id: 'folder1', name: "Mari's arved" }] }))
    expect(await findOrCreateFolder(CLIENT, "Mari's arved")).toBe('folder1')
    const q = query(calls[0].url).get('q')
    expect(q).toBe("mimeType='application/vnd.google-apps.folder' and name='Mari\\'s arved' and trashed=false")
    expect(calls[0].url.startsWith('https://www.googleapis.com/drive/v3/files?')).toBe(true)
    expect(auth(calls[0])).toMatch(/^Bearer token-/)
    expect(getAccessToken).toHaveBeenCalledWith(CLIENT, ['drive'])
  })

  it('creates the folder when missing', async () => {
    stubFetch(json({ files: [] }), json({ id: 'newFolder' }))
    expect(await findOrCreateFolder(CLIENT, 'Arved')).toBe('newFolder')
    expect(calls[1].init.method).toBe('POST')
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ name: 'Arved', mimeType: 'application/vnd.google-apps.folder' })
  })

  it('uploads a PDF with a multipart request into the folder', async () => {
    stubFetch(
      json({ files: [{ id: 'f1' }] }), // folder
      json({ files: [] }), // no existing file with that name
      json({ id: 'file1', webViewLink: 'https://drive.google.com/file/d/file1/view' }),
    )
    const pdf = new Blob(['%PDF-1.7 test'], { type: 'application/pdf' })
    const result = await uploadToDrive(CLIENT, pdf, 'Arve_2026-0007.pdf', 'Arved')
    expect(result).toEqual({ id: 'file1', webViewLink: 'https://drive.google.com/file/d/file1/view' })

    expect(query(calls[1].url).get('q')).toBe("name='Arve_2026-0007.pdf' and 'f1' in parents and trashed=false")
    const upload = calls[2]
    expect(upload.url).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink')
    expect(upload.init.method).toBe('POST')
    const ct = new Headers(upload.init.headers).get('Content-Type')!
    const boundary = /^multipart\/related; boundary=(.+)$/.exec(ct)![1]
    const body = await bodyText(upload.init.body)
    expect(body.startsWith(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`)).toBe(true)
    expect(body).toContain(JSON.stringify({ name: 'Arve_2026-0007.pdf', mimeType: 'application/pdf', parents: ['f1'] }))
    expect(body).toContain(`--${boundary}\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7 test\r\n--${boundary}--`)
  })

  it('overwrites a same-named file instead of duplicating it', async () => {
    stubFetch(json({ files: [{ id: 'f1' }] }), json({ files: [{ id: 'existing' }] }), json({ id: 'existing', webViewLink: 'link' }))
    await uploadToDrive(CLIENT, new Blob(['x'], { type: 'application/pdf' }), 'a.pdf', 'Arved')
    expect(calls[2].init.method).toBe('PATCH')
    expect(calls[2].url).toBe('https://www.googleapis.com/upload/drive/v3/files/existing?uploadType=media&fields=id,webViewLink')
  })

  it('backupToDrive creates the backup file the first time and PATCHes it afterwards', async () => {
    stubFetch(json({ files: [{ id: 'f1' }] }), json({ files: [] }), json({ id: 'b1', modifiedTime: '2026-03-10T10:00:00Z' }))
    expect(await backupToDrive(CLIENT, '{"app":"invoice-generator"}', 'Arved')).toEqual({ id: 'b1', modifiedTime: '2026-03-10T10:00:00Z' })
    expect(query(calls[1].url).get('q')).toBe(`name='${DRIVE_BACKUP_FILE_NAME}' and 'f1' in parents and trashed=false`)
    expect(await bodyText(calls[2].init.body)).toContain(`"name":"${DRIVE_BACKUP_FILE_NAME}"`)

    calls = []
    stubFetch(json({ files: [{ id: 'f1' }] }), json({ files: [{ id: 'b1' }] }), json({ id: 'b1', modifiedTime: '2026-03-11T10:00:00Z' }))
    const r = await backupToDrive(CLIENT, '{"v":2}', 'Arved')
    expect(r.modifiedTime).toBe('2026-03-11T10:00:00Z')
    expect(calls[2].init.method).toBe('PATCH')
    expect(calls[2].url).toBe('https://www.googleapis.com/upload/drive/v3/files/b1?uploadType=media&fields=id,modifiedTime')
    expect(calls[2].init.body).toBe('{"v":2}')
  })

  it('restoreFromDrive downloads the backup with alt=media', async () => {
    stubFetch(json({ files: [{ id: 'f1' }] }), json({ files: [{ id: 'b1' }] }), () => new Response('{"app":"invoice-generator"}'))
    expect(await restoreFromDrive(CLIENT, 'Arved')).toBe('{"app":"invoice-generator"}')
    expect(calls[2].url).toBe('https://www.googleapis.com/drive/v3/files/b1?alt=media')
  })

  it('restoreFromDrive returns null (and creates nothing) when there is no folder or file', async () => {
    stubFetch(json({ files: [] }))
    expect(await restoreFromDrive(CLIENT, 'Arved')).toBeNull()
    expect(calls).toHaveLength(1)
    stubFetch(json({ files: [{ id: 'f1' }] }), json({ files: [] }))
    expect(await restoreFromDrive(CLIENT, 'Arved')).toBeNull()
  })
})

describe('Drive backup versions', () => {
  it('uploads a new version with app properties and never overwrites', async () => {
    stubFetch(json({ files: [{ id: 'f1' }] }), json({ id: 'v1', name: 'arvegeneraator-backup-2026-10-15-142305.json.enc', size: '2048', createdTime: '2026-10-15T11:23:05Z' }))
    const file = await uploadBackupVersion(CLIENT, 'Arved', 'arvegeneraator-backup-2026-10-15-142305.json.enc', '{"format":"x"}', true)
    expect(file).toMatchObject({ id: 'v1', size: 2048, encrypted: true, automatic: true, createdTime: '2026-10-15T11:23:05Z' })
    expect(calls).toHaveLength(2)
    const upload = calls[1]
    expect(upload.init.method).toBe('POST')
    expect(upload.url).toContain('uploadType=multipart')
    const body = await bodyText(upload.init.body)
    expect(body).toContain('"appProperties":{"invoiceGeneratorBackup":"auto","encrypted":"1"}')
    expect(body).toContain('"parents":["f1"]')
  })

  it('lists automatic versions and the manual backup file, newest first, across pages', async () => {
    stubFetch(
      json({ files: [{ id: 'f1' }] }),
      json({
        nextPageToken: 'p2',
        files: [
          { id: 'a', name: 'arvegeneraator-backup-2026-10-14-100000.json', createdTime: '2026-10-14T07:00:00Z', appProperties: { invoiceGeneratorBackup: 'auto', encrypted: '0' } },
          { id: 'm', name: DRIVE_BACKUP_FILE_NAME, createdTime: '2026-01-01T00:00:00Z', modifiedTime: '2026-10-01T00:00:00Z', size: '100' },
        ],
      }),
      json({ files: [{ id: 'b', name: 'arvegeneraator-backup-2026-10-15-100000.json.enc', createdTime: '2026-10-15T07:00:00Z', appProperties: { invoiceGeneratorBackup: 'auto', encrypted: '1' } }] }),
    )
    const files = await listDriveBackups(CLIENT, 'Arved')
    expect(files.map((f) => f.id)).toEqual(['b', 'a', 'm'])
    expect(files[0]).toMatchObject({ encrypted: true, automatic: true })
    expect(files[2]).toMatchObject({ encrypted: false, automatic: false, size: 100 })
    const q = query(calls[1].url).get('q')
    expect(q).toBe(`'f1' in parents and trashed=false and (appProperties has { key='invoiceGeneratorBackup' and value='auto' } or name='${DRIVE_BACKUP_FILE_NAME}')`)
    expect(query(calls[2].url).get('pageToken')).toBe('p2')
  })

  it('returns no backups (and creates no folder) when the folder is missing', async () => {
    stubFetch(json({ files: [] }))
    expect(await listDriveBackups(CLIENT, 'Arved')).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('downloads and trashes files by id', async () => {
    stubFetch(() => new Response('{"a":1}'), json({ id: 'x' }))
    expect(await downloadDriveFile(CLIENT, 'x/1')).toBe('{"a":1}')
    expect(calls[0].url).toBe('https://www.googleapis.com/drive/v3/files/x%2F1?alt=media')
    await trashDriveFile(CLIENT, 'x')
    expect(calls[1].init.method).toBe('PATCH')
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ trashed: true })
  })

  it('passes interactive: false to the token source for background calls', async () => {
    stubFetch(json({ files: [] }))
    await listDriveBackups(CLIENT, 'Arved', { interactive: false })
    expect(getAccessToken).toHaveBeenCalledWith(CLIENT, ['drive'], { interactive: false })
  })
})

describe('Gmail', () => {
  it('sends a base64url raw MIME message', async () => {
    stubFetch(json({ id: 'msg1', threadId: 't1' }))
    const draft = {
      to: ['klient@example.ee'],
      subject: 'Arve 2026-0007 – Õunapuu OÜ',
      body: 'Tere!\nArve on manuses.',
      attachments: [{ fileName: 'Arve_Õunapuu.pdf', blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }) }],
    }
    expect(await sendViaGmail(CLIENT, draft)).toEqual({ id: 'msg1', threadId: 't1' })
    expect(getAccessToken).toHaveBeenCalledWith(CLIENT, ['gmail'])
    const call = calls[0]
    expect(call.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
    expect(call.init.method).toBe('POST')
    const { raw } = JSON.parse(String(call.init.body)) as { raw: string }
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    const mime = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
    expect(mime).toContain('To: klient@example.ee\r\n')
    expect(mime).toContain('Subject: =?UTF-8?B?')
    expect(mime).toContain('Content-Type: multipart/mixed;')
    expect(mime).toContain(btoa('%PDF-1.7'))
  })

  it('buildGmailRaw falls back to octet-stream for untyped blobs', async () => {
    const raw = await buildGmailRaw({ to: ['a@b.ee'], subject: 's', body: 'b', attachments: [{ fileName: 'x.bin', blob: new Blob(['x']) }] })
    expect(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))).toContain('Content-Type: application/octet-stream; name="x.bin"')
  })
})

describe('error handling', () => {
  it('re-authenticates once and retries on 401', async () => {
    stubFetch(json({ error: { code: 401 } }, 401), json({ id: 'msg1' }))
    await sendViaGmail(CLIENT, { to: ['a@b.ee'], subject: 's', body: 'b', attachments: [] })
    expect(invalidateToken).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
    expect(auth(calls[0])).not.toBe(auth(calls[1]))
  })

  it('gives up after the second 401', async () => {
    stubFetch(json({}, 401), json({}, 401))
    await expect(sendViaGmail(CLIENT, { to: ['a@b.ee'], subject: 's', body: 'b', attachments: [] })).rejects.toMatchObject({
      code: 'unauthorized',
    })
    expect(calls).toHaveLength(2)
  })

  it('maps 403 insufficient scope to a friendly bilingual error', async () => {
    stubFetch(
      json(
        {
          error: {
            code: 403,
            message: 'Request had insufficient authentication scopes.',
            status: 'PERMISSION_DENIED',
            details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
          },
        },
        403,
      ),
    )
    const err = (await sendViaGmail(CLIENT, { to: ['a@b.ee'], subject: 's', body: 'b', attachments: [] }).catch((e: unknown) => e)) as GoogleApiError
    expect(err).toBeInstanceOf(GoogleApiError)
    expect(err.code).toBe('insufficient_scope')
    expect(err.status).toBe(403)
    expect(err.messages.et).toMatch(/õigus/)
    expect(err.messages.en).toMatch(/permission/)
  })

  it('maps disabled APIs and network failures', async () => {
    stubFetch(json({ error: { code: 403, message: 'Gmail API has not been used', errors: [{ reason: 'accessNotConfigured' }] } }, 403))
    await expect(sendViaGmail(CLIENT, { to: ['a@b.ee'], subject: 's', body: 'b', attachments: [] })).rejects.toMatchObject({
      code: 'api_not_enabled',
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(findOrCreateFolder(CLIENT, 'Arved')).rejects.toMatchObject({ code: 'network' })
  })
})
