// OWNER: domain agent. IndexedDB persistence (via `idb`) + backup import/export.
import type { AppSettings, BackupFile, Client, CompanyProfile, Invoice } from '../domain/types'

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
  importBackup(backup: BackupFile, mode: 'replace' | 'merge'): Promise<void>
}

export function getRepository(): Repository {
  throw new Error('not implemented')
}

/** Ask the browser to keep IndexedDB from being evicted. Returns whether persistence is granted. */
export async function requestPersistentStorage(): Promise<boolean> {
  throw new Error('not implemented')
}
