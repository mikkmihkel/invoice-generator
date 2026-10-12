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
  Invoice,
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
  saveInvoice(invoice: Invoice): Promise<void>
  /** Only drafts may be deleted; issued invoices must be cancelled/credited instead (RPS requires keeping documents). */
  deleteInvoice(id: string): Promise<void>

  /**
   * Atomically allocate the next invoice number from profile.numbering, snapshot the seller,
   * set status 'issued' + issuedAt, and persist. Throws if validation has errors or already issued.
   */
  issueInvoice(id: string): Promise<Invoice>

  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>

  exportBackup(): Promise<BackupFile>
  /** 'replace' wipes existing data; 'merge' upserts by id (newer updatedAt wins). */
  importBackup(backup: BackupFile, mode: 'replace' | 'merge'): Promise<ImportResult>
}

/** Bilingual error raised by repository operations. `code` is stable for UI handling. */
export class RepositoryError extends Error {
  readonly code: 'not-found' | 'not-draft' | 'no-profile' | 'immutable' | 'numbering'
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
      if (existing && existing.status !== 'draft') {
        if (invoice.status === 'draft' || invoice.number !== existing.number) {
          tx.abort()
          await tx.done.catch(() => {})
          throw new RepositoryError(
            'immutable',
            'Väljastatud arve numbrit ei saa muuta ega arvet mustandiks tagasi muuta.',
            'An issued invoice cannot get a new number or go back to draft.',
          )
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
          const existing = await tx.objectStore('invoices').get(i.id)
          if (!existing || isNewer(i.updatedAt, existing.updatedAt)) {
            await tx.objectStore('invoices').put(i)
            result.invoices.written++
          } else result.invoices.skipped++
        }
        if (backup.profile) {
          const existing = await tx.objectStore('profile').get(PROFILE_KEY)
          if (!existing || isNewer(backup.profile.updatedAt, existing.updatedAt)) {
            // Never move the counter backwards: keep the higher nextNumber.
            const nextNumber = Math.max(backup.profile.numbering.nextNumber, existing?.numbering.nextNumber ?? 0)
            await tx.objectStore('profile').put({ ...backup.profile, numbering: { ...backup.profile.numbering, nextNumber } }, PROFILE_KEY)
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
