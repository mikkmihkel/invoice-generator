import { BackupFormatError, parseBackup } from '../../storage'
import { formatIban, normalizeIban, normalizeVatNumber, type AppSettings, type BackupFile, type CompanyProfile, type DriveFolderChoice } from '../../domain'
import { formatDateTime } from '../format'
import type { Translate } from '../i18n'

export type PaymentField = 'name' | 'registryCode' | 'vatNumber' | 'ibans' | 'googleClientId'

export interface PaymentChange {
  field: PaymentField
  /** Display values ('' = not set). */
  from: string
  to: string
}

export const GOOGLE_CLIENT_ID_RE = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/

const ibans = (p: CompanyProfile | null) => (p?.bankAccounts ?? []).map((a) => normalizeIban(a.iban)).filter(Boolean)

/**
 * Payment-critical data a backup would change: seller identity and IBANs (where buyers pay) and the Google
 * client ID (where invoices and backups are sent). A tampered backup must not change these unnoticed.
 */
export function paymentDetailChanges(current: { profile: CompanyProfile | null; settings: AppSettings }, backup: BackupFile): PaymentChange[] {
  const out: PaymentChange[] = []
  const add = (field: PaymentField, from: string, to: string, same: boolean) => {
    if (!same) out.push({ field, from, to })
  }
  const p = current.profile
  const b = backup.profile
  if (b) {
    add('name', p?.name ?? '', b.name ?? '', (p?.name ?? '').trim() === (b.name ?? '').trim())
    add('registryCode', p?.registryCode ?? '', b.registryCode ?? '', (p?.registryCode ?? '').trim() === (b.registryCode ?? '').trim())
    add('vatNumber', p?.vatNumber ?? '', b.vatNumber ?? '', normalizeVatNumber(p?.vatNumber ?? '') === normalizeVatNumber(b.vatNumber ?? ''))
    const from = ibans(p)
    const to = ibans(b)
    add('ibans', from.map(formatIban).join(', '), to.map(formatIban).join(', '), from.join() === to.join())
  }
  const fromId = current.settings.googleClientId ?? ''
  const toId = backup.settings?.googleClientId ?? ''
  if (backup.settings && toId) add('googleClientId', fromId, toId, fromId === toId)
  return out
}

/**
 * Heading and intro for the changes a backup would make, by what actually changes: the IBAN warning only when bank
 * accounts differ, so the guard stays credible when only the company name changes.
 */
export function changesHeading(changes: PaymentChange[], t: Translate): { title: string; intro: string } {
  if (changes.some((c) => c.field === 'ibans')) return { title: t('backup.changesTitle'), intro: t('backup.changesIntro') }
  const company = changes.some((c) => c.field !== 'googleClientId')
  return { title: t(company ? 'backup.changesTitleCompany' : 'backup.changesTitleSettings'), intro: t('backup.changesIntroOther') }
}

/** The backup with the current Google client ID instead of the imported one (the default). */
export function keepClientId(backup: BackupFile, currentClientId: string | undefined): BackupFile {
  if (!backup.settings) return backup
  const settings: AppSettings = { ...backup.settings }
  if (currentClientId) settings.googleClientId = currentClientId
  else delete settings.googleClientId
  return { ...backup, settings }
}

/**
 * The backup with this browser's chosen Drive folder instead of the imported one, when a folder is chosen here (the
 * folder belongs to the Google account signed in here). Without one, the backup's folder is taken over.
 */
export function keepDriveFolder(backup: BackupFile, current: DriveFolderChoice | undefined): BackupFile {
  if (!backup.settings || !current) return backup
  return { ...backup, settings: { ...backup.settings, driveFolder: current } }
}

/** Parse a backup file's text; a malformed file yields the specific problem (record / field) in the UI language. */
export function readBackupText(text: string, lang: 'et' | 'en'): { backup: BackupFile } | { error: string } {
  try {
    return { backup: parseBackup(text) }
  } catch (e) {
    if (e instanceof BackupFormatError) return { error: e.messages[lang] }
    throw e
  }
}

/** "Varukoopia (…) sisaldab arveid: 9, hinnapakkumisi: 2, kliente: 4." Quotes are counted on their own. */
export function backupContents(backup: BackupFile, t: Translate): string {
  const quotes = backup.invoices.filter((i) => i?.type === 'quote').length
  const vars = { date: formatDateTime(backup.exportedAt), invoices: backup.invoices.length - quotes, quotes, clients: backup.clients.length }
  return t(quotes > 0 ? 'backup.containsWithQuotes' : 'backup.contains', vars)
}
