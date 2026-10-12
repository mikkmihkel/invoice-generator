import type { BackupFile } from '../domain/types'

export const BACKUP_APP = 'invoice-generator'
export const BACKUP_VERSION = 1

/** Thrown when a backup file is not a valid invoice-generator backup. Carries a bilingual message. */
export class BackupFormatError extends Error {
  readonly messages: { et: string; en: string }
  constructor(et: string, en: string) {
    super(en)
    this.name = 'BackupFormatError'
    this.messages = { et, en }
  }
}

const STATUSES = ['draft', 'issued', 'paid', 'cancelled']

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkRecords(list: unknown, what: { et: string; en: string }, extra?: (r: Record<string, unknown>) => string | null) {
  if (!Array.isArray(list)) {
    throw new BackupFormatError(`Varukoopias puudub loend: ${what.et}`, `Backup is missing the ${what.en} list`)
  }
  const seen = new Set<string>()
  list.forEach((r, i) => {
    if (!isObject(r) || typeof r.id !== 'string' || !r.id || typeof r.updatedAt !== 'string') {
      throw new BackupFormatError(`Vigane kirje: ${what.et} #${i + 1}`, `Invalid record: ${what.en} #${i + 1}`)
    }
    if (seen.has(r.id)) {
      throw new BackupFormatError(`Korduv id: ${what.et} ${r.id}`, `Duplicate id in ${what.en}: ${r.id}`)
    }
    seen.add(r.id)
    const problem = extra?.(r)
    if (problem) {
      throw new BackupFormatError(`Vigane kirje: ${what.et} #${i + 1} (${problem})`, `Invalid record: ${what.en} #${i + 1} (${problem})`)
    }
  })
}

/** Validate the shape of an unknown value and return it typed as a BackupFile. Throws BackupFormatError. */
export function validateBackup(data: unknown): BackupFile {
  if (!isObject(data) || data.app !== BACKUP_APP) {
    throw new BackupFormatError('See fail ei ole arvegeneraatori varukoopia.', 'This file is not an invoice-generator backup.')
  }
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new BackupFormatError(
      `Varukoopia versioon (${String(data.version)}) ei ole toetatud. Uuenda rakendust.`,
      `Backup version ${String(data.version)} is not supported. Please update the app.`,
    )
  }
  if (data.version !== BACKUP_VERSION) {
    throw new BackupFormatError(`Tundmatu varukoopia versioon: ${data.version}`, `Unknown backup version: ${data.version}`)
  }
  checkRecords(data.clients, { et: 'kliendid', en: 'clients' }, (r) => (typeof r.name === 'string' ? null : 'name'))
  checkRecords(data.invoices, { et: 'arved', en: 'invoices' }, (r) => {
    if (typeof r.number !== 'string') return 'number'
    if (typeof r.status !== 'string' || !STATUSES.includes(r.status)) return 'status'
    if (!Array.isArray(r.lines)) return 'lines'
    if (!isObject(r.buyer)) return 'buyer'
    return null
  })
  if (data.profile !== null && data.profile !== undefined) {
    if (!isObject(data.profile) || typeof data.profile.name !== 'string' || !isObject(data.profile.numbering)) {
      throw new BackupFormatError('Varukoopia ettevõtte profiil on vigane.', 'The company profile in the backup is invalid.')
    }
  }
  if (data.settings !== null && data.settings !== undefined && !isObject(data.settings)) {
    throw new BackupFormatError('Varukoopia seaded on vigased.', 'The settings in the backup are invalid.')
  }
  return {
    ...(data as unknown as BackupFile),
    profile: (data.profile ?? null) as BackupFile['profile'],
    settings: (data.settings ?? null) as BackupFile['settings'],
  }
}

/** Parse backup JSON text (e.g. from a file input or Drive) and validate it. */
export function parseBackup(text: string): BackupFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupFormatError('Fail ei ole korrektne JSON.', 'The file is not valid JSON.')
  }
  return validateBackup(data)
}

/** Serialize a backup for download / Drive upload. */
export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2)
}

/** Suggested file name, e.g. "invoice-generator-backup-2026-10-12.json". */
export function backupFileName(date: Date = new Date()): string {
  return `invoice-generator-backup-${date.toISOString().slice(0, 10)}.json`
}

/** True if `a` is strictly newer than `b` (ISO timestamps; unparsable values count as oldest). */
export function isNewer(a: string | undefined, b: string | undefined): boolean {
  const ta = a ? Date.parse(a) : NaN
  const tb = b ? Date.parse(b) : NaN
  if (Number.isNaN(ta)) return false
  if (Number.isNaN(tb)) return true
  return ta > tb
}
