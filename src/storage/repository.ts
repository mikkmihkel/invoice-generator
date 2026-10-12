import {
  canIssue,
  createDefaultSettings,
  formatInvoiceNumber,
  generateReferenceNumber,
  sellerSnapshot,
  validateInvoice,
} from '../domain'
import type {
  AppSettings,
  BackupFile,
  Client,
  CompanyProfile,
  ISODate,
  Invoice,
  InvoiceStatus,
  NumberingSettings,
  SellerSnapshot,
  ValidationIssue,
} from '../domain/types'
import { BACKUP_APP, BACKUP_VERSION, isNewer, validateBackup } from './backup'
import { DB_NAME, getDb, PROFILE_KEY, SETTINGS_KEY } from './db'
import { notifyChange } from './events'

export interface ImportResult {
  clients: { written: number; skipped: number }
  invoices: { written: number; skipped: number }
  profile: 'written' | 'skipped' | 'none'
  settings: 'written' | 'skipped' | 'none'
  /** Invoice numbers that now occur on more than one invoice (merge of data from different devices). */
  duplicateNumbers: string[]
}

export interface Repository {
  getProfile(): Promise<CompanyProfile | null>
  saveProfile(profile: CompanyProfile): Promise<void>

  listClients(): Promise<Client[]>
  getClient(id: string): Promise<Client | null>
  saveClient(client: Client): Promise<void>
  deleteClient(id: string): Promise<void>

  /** Sorted newest first by issueDate, then createdAt. */
  listInvoices(): Promise<Invoice[]>
  getInvoice(id: string): Promise<Invoice | null>
  /**
   * Create / update an invoice. Drafts may change freely but stay drafts (use issueInvoice). For an already issued (issued / paid / cancelled)
   * record only `status` (issued ↔ paid, → cancelled), `paidAt` and `updatedAt` may differ from the stored
   * copy; anything else throws RepositoryError 'immutable'. Prefer the explicit status methods below.
   */
  saveInvoice(invoice: Invoice): Promise<void>
  /** Only drafts may be deleted; issued invoices must be cancelled/credited instead (RPS requires keeping documents). */
  deleteInvoice(id: string): Promise<void>

  /**
   * Atomically allocate the next invoice number from profile.numbering, snapshot the seller,
   * set status 'issued' + issuedAt, and persist. Throws if validation has errors or already issued.
   */
  issueInvoice(id: string): Promise<Invoice>

  /**
   * Mark an issued (or paid, to correct the date) invoice as paid on `paidAt` (YYYY-MM-DD). Applied to the
   * stored record, so a stale copy in the UI cannot overwrite other fields. Throws 'invalid-transition'
   * for drafts and cancelled invoices, 'invalid-input' for a malformed date, 'not-found'.
   */
  markInvoicePaid(id: string, paidAt: ISODate): Promise<Invoice>
  /** Paid → issued (clears paidAt). No-op for an issued invoice. Throws 'invalid-transition' for drafts / cancelled. */
  markInvoiceUnpaid(id: string): Promise<Invoice>
  /** Issued / paid → cancelled (paidAt is kept). No-op if already cancelled. Throws 'invalid-transition' for drafts (delete them instead). */
  cancelInvoice(id: string): Promise<Invoice>

  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>

  exportBackup(): Promise<BackupFile>
  /**
   * 'replace' wipes existing data; 'merge' upserts by id (newer updatedAt wins, but an issued invoice is never
   * reverted to a draft). The numbering counter never moves backwards — see importBackup for details.
   */
  importBackup(backup: BackupFile, mode: 'replace' | 'merge'): Promise<ImportResult>
}

/** Bilingual error raised by repository operations. `code` is stable for UI handling. */
export class RepositoryError extends Error {
  readonly code: 'not-found' | 'not-draft' | 'no-profile' | 'immutable' | 'numbering' | 'invalid-transition' | 'invalid-input'
  readonly messages: { et: string; en: string }
  constructor(code: RepositoryError['code'], et: string, en: string) {
    super(en)
    this.name = 'RepositoryError'
    this.code = code
    this.messages = { et, en }
  }
}

/** Thrown by issueInvoice when the invoice has validation errors. */
export class InvoiceValidationError extends Error {
  readonly issues: ValidationIssue[]
  constructor(issues: ValidationIssue[]) {
    const errors = issues.filter((i) => i.severity === 'error')
    super(`Invoice cannot be issued: ${errors.map((i) => `${i.field}: ${i.message.en}`).join('; ') || 'validation failed'}`)
    this.name = 'InvoiceValidationError'
    this.issues = issues
  }
}

const now = () => new Date().toISOString()

/** Copy of the seller fields of the profile, frozen into an issued invoice. */
export function snapshotSeller(profile: CompanyProfile): SellerSnapshot {
  return sellerSnapshot(profile)
}

function issueYear(invoice: Invoice): number {
  const y = Number(/^(\d{4})-\d{2}-\d{2}/.exec(invoice.issueDate ?? '')?.[1])
  return Number.isFinite(y) && y > 0 ? y : new Date().getFullYear()
}

/** Numeric base for the viitenumber: digits of the invoice number (max 19, no leading zeros). */
function referenceBase(number: string, n: number): string {
  const digits = number.replace(/\D/g, '').replace(/^0+/, '').slice(-19)
  return digits || String(n)
}

function compareInvoices(a: Invoice, b: Invoice): number {
  const d = (b.issueDate ?? '').localeCompare(a.issueDate ?? '')
  return d !== 0 ? d : (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
}

/** Structural equality of JSON-like values; properties set to `undefined` count as absent. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]))
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)])
  for (const k of keys) if (!deepEqual(ra[k], rb[k])) return false
  return true
}

/** Fields of an issued invoice that may still change (payment / cancellation bookkeeping). */
const MUTABLE_AFTER_ISSUE = ['status', 'paidAt', 'updatedAt'] as const

function lockedPart(invoice: Invoice): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...invoice }
  for (const k of MUTABLE_AFTER_ISSUE) delete rest[k]
  return rest
}

/** Status changes allowed for an invoice that has been issued. Drafts only leave 'draft' via issueInvoice. */
function isAllowedIssuedTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to) return true
  if (from === 'cancelled' || to === 'draft') return false
  return to === 'issued' || to === 'paid' || to === 'cancelled'
}

function isValidIsoDate(v: unknown): v is ISODate {
  if (typeof v !== 'string') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === v
}

/**
 * Merge rule for one invoice from a backup. Returns the record to write, or null to keep the local one.
 * - a non-draft (issued / paid / cancelled) always beats a draft with the same id, whatever the timestamps
 *   (an issued document must never be reverted to an editable draft);
 * - between two drafts or two non-drafts the newer updatedAt wins, but an issued invoice keeps its number.
 */
function mergeInvoice(existing: Invoice | undefined, incoming: Invoice): Invoice | null {
  if (!existing) return incoming
  const existingDraft = existing.status === 'draft'
  const incomingDraft = incoming.status === 'draft'
  if (existingDraft !== incomingDraft) return incomingDraft ? null : incoming
  if (!isNewer(incoming.updatedAt, existing.updatedAt)) return null
  return existingDraft ? incoming : { ...incoming, number: existing.number }
}

/**
 * Highest sequence number among issued invoices whose number matches the numbering prefix pattern
 * ({YYYY} / {YY} match any year), e.g. prefix "{YYYY}-" and "2025-0042" → 42. 0 if none match.
 */
export function highestUsedNumber(invoices: Invoice[], numbering: NumberingSettings): number {
  const escaped = (numbering.prefix ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped.replace(/\\\{YYYY\\\}/g, '\\d{4}').replace(/\\\{YY\\\}/g, '\\d{2}')
  const re = new RegExp(`^${pattern}(\\d+)$`)
  let max = 0
  for (const inv of invoices) {
    if (inv.status === 'draft' || !inv.number) continue
    const m = re.exec(inv.number)
    const n = m ? Number(m[1]) : NaN
    if (Number.isSafeInteger(n) && n > max) max = n
  }
  return max
}

export interface RepositoryOptions {
  /** IndexedDB database name (tests use unique names). */
  dbName?: string
  /** Clock for timestamps (tests). */
  now?: () => string
}

export function createRepository(options: RepositoryOptions = {}): Repository {
  const dbName = options.dbName ?? DB_NAME
  const clock = options.now ?? now
  const db = () => getDb(dbName)

  /**
   * Apply a status change to the STORED invoice in one readwrite transaction. `apply` returns the new
   * record, null for "nothing to change", or throws a RepositoryError (the transaction is aborted).
   */
  async function changeStatus(id: string, apply: (stored: Invoice) => Invoice | null): Promise<Invoice> {
    const tx = (await db()).transaction('invoices', 'readwrite')
    const fail = async (err: unknown): Promise<never> => {
      try {
        tx.abort()
      } catch {
        // already finished
      }
      await tx.done.catch(() => {})
      throw err
    }
    const stored = await tx.store.get(id)
    if (!stored) return fail(new RepositoryError('not-found', 'Arvet ei leitud.', 'Invoice not found.'))
    let next: Invoice | null
    try {
      next = apply(stored)
    } catch (e) {
      return fail(e)
    }
    if (!next) {
      await tx.done
      return stored
    }
    const updated: Invoice = { ...next, updatedAt: clock() }
    await tx.store.put(updated)
    await tx.done
    notifyChange('invoices', id)
    return updated
  }

  return {
    async getProfile() {
      return (await (await db()).get('profile', PROFILE_KEY)) ?? null
    },

    async saveProfile(profile) {
      await (await db()).put('profile', { ...profile, updatedAt: clock() }, PROFILE_KEY)
      notifyChange('profile')
    },

    async listClients() {
      const clients = await (await db()).getAll('clients')
      return clients.sort((a, b) => a.name.localeCompare(b.name, 'et'))
    },

    async getClient(id) {
      return (await (await db()).get('clients', id)) ?? null
    },

    async saveClient(client) {
      const ts = clock()
      await (await db()).put('clients', { ...client, createdAt: client.createdAt || ts, updatedAt: ts })
      notifyChange('clients', client.id)
    },

    async deleteClient(id) {
      // Invoices keep their own buyer snapshot, so deleting a client never alters invoices.
      await (await db()).delete('clients', id)
      notifyChange('clients', id)
    },

    async listInvoices() {
      const invoices = await (await db()).getAll('invoices')
      return invoices.sort(compareInvoices)
    },

    async getInvoice(id) {
      return (await (await db()).get('invoices', id)) ?? null
    },

    async saveInvoice(invoice) {
      const tx = (await db()).transaction('invoices', 'readwrite')
      const existing = await tx.store.get(invoice.id)
      if (existing && existing.status === 'draft' && invoice.status !== 'draft') {
        // Issuing allocates the number and snapshots the seller — it must go through issueInvoice.
        tx.abort()
        await tx.done.catch(() => {})
        throw new RepositoryError(
          'invalid-transition',
          'Mustandi olekut ei saa salvestamisega muuta – kasuta arve väljastamist.',
          'A draft cannot change status by saving it – issue it instead.',
        )
      }
      if (existing && existing.status !== 'draft') {
        let error: RepositoryError | null = null
        if (!isAllowedIssuedTransition(existing.status, invoice.status)) {
          error =
            invoice.status === 'draft'
              ? new RepositoryError(
                  'immutable',
                  'Väljastatud arvet ei saa mustandiks tagasi muuta.',
                  'An issued invoice cannot go back to draft.',
                )
              : new RepositoryError(
                  'immutable',
                  'Tühistatud arve olekut ei saa enam muuta.',
                  'The status of a cancelled invoice can no longer be changed.',
                )
        } else if (!deepEqual(lockedPart(existing), lockedPart(invoice))) {
          error = new RepositoryError(
            'immutable',
            'Väljastatud arvet ei saa muuta – muuta saab ainult tasumise olekut. Vea parandamiseks tühista arve või koosta kreeditarve.',
            'An issued invoice cannot be edited – only its payment status can change. To correct it, cancel it or issue a credit note.',
          )
        }
        if (error) {
          tx.abort()
          await tx.done.catch(() => {})
          throw error
        }
      }
      const ts = clock()
      await tx.store.put({ ...invoice, createdAt: invoice.createdAt || ts, updatedAt: ts })
      await tx.done
      notifyChange('invoices', invoice.id)
    },

    async deleteInvoice(id) {
      const tx = (await db()).transaction('invoices', 'readwrite')
      const existing = await tx.store.get(id)
      if (!existing) {
        await tx.done
        return
      }
      if (existing.status !== 'draft') {
        tx.abort()
        await tx.done.catch(() => {})
        throw new RepositoryError(
          'not-draft',
          'Kustutada saab ainult mustandeid. Väljastatud arve tühista või koosta kreeditarve.',
          'Only drafts can be deleted. Cancel the issued invoice or create a credit note instead.',
        )
      }
      await tx.store.delete(id)
      await tx.done
      notifyChange('invoices', id)
    },

    async issueInvoice(id) {
      const tx = (await db()).transaction(['profile', 'invoices'], 'readwrite')
      const invoices = tx.objectStore('invoices')
      const profiles = tx.objectStore('profile')
      const fail = async (err: Error): Promise<never> => {
        try {
          tx.abort()
        } catch {
          // already finished
        }
        await tx.done.catch(() => {})
        throw err
      }

      const invoice = await invoices.get(id)
      if (!invoice) return fail(new RepositoryError('not-found', 'Arvet ei leitud.', 'Invoice not found.'))
      if (invoice.status !== 'draft') {
        return fail(new RepositoryError('not-draft', 'Arve on juba väljastatud.', 'The invoice has already been issued.'))
      }
      const profile = await profiles.get(PROFILE_KEY)
      if (!profile) {
        return fail(
          new RepositoryError('no-profile', 'Täida enne arve väljastamist ettevõtte andmed.', 'Fill in your company profile before issuing invoices.'),
        )
      }

      // Allocate the next free number; skip numbers already used (e.g. after merging a backup).
      const year = issueYear(invoice)
      let n = Math.max(1, Math.floor(profile.numbering.nextNumber || 1))
      let number = ''
      for (let attempts = 0; ; attempts++) {
        if (attempts > 10000) {
          return fail(new RepositoryError('numbering', 'Vaba arvenumbrit ei leitud.', 'Could not find a free invoice number.'))
        }
        number = formatInvoiceNumber(profile.numbering, n, year)
        if ((await invoices.index('number').count(number)) === 0) break
        n++
      }

      const ts = clock()
      const issued: Invoice = {
        ...invoice,
        number,
        seller: snapshotSeller(profile),
        referenceNumber: invoice.referenceNumber?.trim() ? invoice.referenceNumber : generateReferenceNumber(referenceBase(number, n)),
        status: 'issued',
        issuedAt: ts,
        updatedAt: ts,
      }

      // Validate the final document (with number + seller snapshot), as it will be printed.
      if (!canIssue(issued)) return fail(new InvoiceValidationError(validateInvoice(issued)))

      await invoices.put(issued)
      await profiles.put({ ...profile, numbering: { ...profile.numbering, nextNumber: n + 1 }, updatedAt: ts }, PROFILE_KEY)
      await tx.done
      notifyChange('invoices', id)
      notifyChange('profile')
      return issued
    },

    markInvoicePaid(id, paidAt) {
      return changeStatus(id, (inv) => {
        if (!isValidIsoDate(paidAt)) {
          throw new RepositoryError('invalid-input', 'Tasumise kuupäev on vigane.', 'The payment date is invalid.')
        }
        if (inv.status === 'draft') {
          throw new RepositoryError(
            'invalid-transition',
            'Mustandit ei saa tasutuks märkida. Väljasta arve enne.',
            'A draft cannot be marked as paid. Issue it first.',
          )
        }
        if (inv.status === 'cancelled') {
          throw new RepositoryError('invalid-transition', 'Tühistatud arvet ei saa tasutuks märkida.', 'A cancelled invoice cannot be marked as paid.')
        }
        return inv.status === 'paid' && inv.paidAt === paidAt ? null : { ...inv, status: 'paid', paidAt }
      })
    },

    markInvoiceUnpaid(id) {
      return changeStatus(id, (inv) => {
        if (inv.status === 'draft' || inv.status === 'cancelled') {
          throw new RepositoryError(
            'invalid-transition',
            inv.status === 'draft' ? 'Mustand ei ole tasutud.' : 'Tühistatud arve olekut ei saa enam muuta.',
            inv.status === 'draft' ? 'A draft is not paid.' : 'The status of a cancelled invoice can no longer be changed.',
          )
        }
        if (inv.status === 'issued' && inv.paidAt === undefined) return null
        const next: Invoice = { ...inv, status: 'issued' }
        delete next.paidAt
        return next
      })
    },

    cancelInvoice(id) {
      return changeStatus(id, (inv) => {
        if (inv.status === 'draft') {
          throw new RepositoryError(
            'invalid-transition',
            'Mustandit ei saa tühistada – kustuta see.',
            'A draft cannot be cancelled – delete it instead.',
          )
        }
        return inv.status === 'cancelled' ? null : { ...inv, status: 'cancelled' }
      })
    },

    async getSettings() {
      const stored = await (await db()).get('settings', SETTINGS_KEY)
      // Merge over defaults so settings added in later versions get a value.
      return stored ? { ...createDefaultSettings(), ...stored } : createDefaultSettings()
    },

    async saveSettings(settings) {
      await (await db()).put('settings', { ...settings, updatedAt: clock() }, SETTINGS_KEY)
      notifyChange('settings')
    },

    async exportBackup() {
      const tx = (await db()).transaction(['profile', 'clients', 'invoices', 'settings'], 'readonly')
      const [profile, clients, invoices, settings] = await Promise.all([
        tx.objectStore('profile').get(PROFILE_KEY),
        tx.objectStore('clients').getAll(),
        tx.objectStore('invoices').getAll(),
        tx.objectStore('settings').get(SETTINGS_KEY),
      ])
      await tx.done
      return {
        app: BACKUP_APP,
        version: BACKUP_VERSION,
        exportedAt: clock(),
        profile: profile ?? null,
        clients,
        invoices,
        settings: settings ?? null,
      }
    },

    async importBackup(input, mode) {
      const backup = validateBackup(input)
      const tx = (await db()).transaction(['profile', 'clients', 'invoices', 'settings', 'meta'], 'readwrite')
      const result: ImportResult = {
        clients: { written: 0, skipped: 0 },
        invoices: { written: 0, skipped: 0 },
        profile: 'none',
        settings: 'none',
        duplicateNumbers: [],
      }

      // Read before anything is cleared / overwritten: the numbering counter must never go below this.
      const previousProfile = await tx.objectStore('profile').get(PROFILE_KEY)

      if (mode === 'replace') {
        await Promise.all(['profile', 'clients', 'invoices', 'settings'].map((s) => tx.objectStore(s as 'clients').clear()))
        for (const c of backup.clients) await tx.objectStore('clients').put(c)
        for (const i of backup.invoices) await tx.objectStore('invoices').put(i)
        result.clients.written = backup.clients.length
        result.invoices.written = backup.invoices.length
        if (backup.profile) {
          await tx.objectStore('profile').put(backup.profile, PROFILE_KEY)
          result.profile = 'written'
        }
        if (backup.settings) {
          await tx.objectStore('settings').put(backup.settings, SETTINGS_KEY)
          result.settings = 'written'
        }
      } else {
        for (const c of backup.clients) {
          const existing = await tx.objectStore('clients').get(c.id)
          if (!existing || isNewer(c.updatedAt, existing.updatedAt)) {
            await tx.objectStore('clients').put(c)
            result.clients.written++
          } else result.clients.skipped++
        }
        for (const i of backup.invoices) {
          const chosen = mergeInvoice(await tx.objectStore('invoices').get(i.id), i)
          if (chosen) {
            await tx.objectStore('invoices').put(chosen)
            result.invoices.written++
          } else result.invoices.skipped++
        }
        if (backup.profile) {
          if (!previousProfile || isNewer(backup.profile.updatedAt, previousProfile.updatedAt)) {
            await tx.objectStore('profile').put(backup.profile, PROFILE_KEY)
            result.profile = 'written'
          } else result.profile = 'skipped'
        }
        if (backup.settings) {
          const existing = await tx.objectStore('settings').get(SETTINGS_KEY)
          if (!existing || isNewer(backup.settings.updatedAt, existing.updatedAt)) {
            await tx.objectStore('settings').put(backup.settings, SETTINGS_KEY)
            result.settings = 'written'
          } else result.settings = 'skipped'
        }
      }

      const all = await tx.objectStore('invoices').getAll()

      /*
       * Numbering counter (both modes), independent of which profile record won by timestamp:
       *   nextNumber = max(counter before the import, counter in the backup, highest used number + 1)
       * where "highest used" is the largest sequence of a non-draft invoice now in the database whose number
       * matches the profile's prefix pattern. So restoring an older backup or merging an older profile can
       * never make the app hand out a number again. Only the counter is touched; profile.updatedAt is kept.
       * (Replace with a backup that has no profile still clears the profile.)
       */
      const profile = await tx.objectStore('profile').get(PROFILE_KEY)
      if (profile) {
        const nextNumber = Math.max(
          profile.numbering.nextNumber,
          previousProfile?.numbering.nextNumber ?? 0,
          backup.profile?.numbering.nextNumber ?? 0,
          highestUsedNumber(all, profile.numbering) + 1,
        )
        if (nextNumber !== profile.numbering.nextNumber) {
          await tx.objectStore('profile').put({ ...profile, numbering: { ...profile.numbering, nextNumber } }, PROFILE_KEY)
        }
      }

      const counts = new Map<string, number>()
      for (const i of all) if (i.number) counts.set(i.number, (counts.get(i.number) ?? 0) + 1)
      result.duplicateNumbers = [...counts].filter(([, c]) => c > 1).map(([n]) => n)

      await tx.objectStore('meta').put(clock(), 'lastImportAt')
      await tx.done
      notifyChange('all')
      return result
    },
  }
}

let singleton: Repository | null = null

/** The app-wide repository (database "invoice-generator"). */
export function getRepository(): Repository {
  singleton ??= createRepository()
  return singleton
}

/** Ask the browser to keep IndexedDB from being evicted. Returns whether persistence is granted. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined
    if (!storage?.persist) return false
    if (storage.persisted && (await storage.persisted())) return true
    return await storage.persist()
  } catch {
    return false
  }
}
