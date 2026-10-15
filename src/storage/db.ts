import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AppSettings, Client, CompanyProfile, Invoice, InvoiceEvent, Product, RecurringRule } from '../domain/types'

export const DB_NAME = 'invoice-generator'
export const DB_VERSION = 2

/** Keys used in the singleton stores. */
export const PROFILE_KEY = 'profile'
export const SETTINGS_KEY = 'settings'

export interface InvoiceDbSchema extends DBSchema {
  profile: { key: string; value: CompanyProfile }
  clients: { key: string; value: Client }
  invoices: {
    key: string
    value: Invoice
    indexes: { number: string; status: string; issueDate: string; clientId: string }
  }
  settings: { key: string; value: AppSettings }
  meta: { key: string; value: unknown }
  products: { key: string; value: Product }
  recurringRules: { key: string; value: RecurringRule; indexes: { sourceInvoiceId: string } }
  invoiceEvents: { key: string; value: InvoiceEvent; indexes: { invoiceId: string } }
}

export type InvoiceDb = IDBPDatabase<InvoiceDbSchema>

/**
 * Open (and create / migrate) the database. Migrations run step by step from `oldVersion`,
 * so a user jumping several versions gets every intermediate step. Add new steps as
 * `if (oldVersion < N) { ... }` and bump DB_VERSION.
 */
export function openInvoiceDb(name: string = DB_NAME, onLost?: () => void): Promise<InvoiceDb> {
  let db: InvoiceDb | undefined
  const p = openDB<InvoiceDbSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('profile')
        db.createObjectStore('clients', { keyPath: 'id' })
        const invoices = db.createObjectStore('invoices', { keyPath: 'id' })
        invoices.createIndex('number', 'number')
        invoices.createIndex('status', 'status')
        invoices.createIndex('issueDate', 'issueDate')
        invoices.createIndex('clientId', 'buyer.clientId')
        db.createObjectStore('settings')
        db.createObjectStore('meta')
      }
      if (oldVersion < 2) {
        db.createObjectStore('products', { keyPath: 'id' })
        db.createObjectStore('recurringRules', { keyPath: 'id' }).createIndex('sourceInvoiceId', 'sourceInvoiceId')
        db.createObjectStore('invoiceEvents', { keyPath: 'id' }).createIndex('invoiceId', 'invoiceId')
      }
      // Record the schema version we migrated to (handy for debugging / support).
      void tx.objectStore('meta').put(DB_VERSION, 'schemaVersion')
    },
    blocking() {
      // A newer version was opened in another tab: close so it can upgrade; the next call re-opens.
      db?.close()
      onLost?.()
    },
    terminated() {
      // The browser closed the connection abnormally (storage cleared, disk error, eviction…).
      onLost?.()
    },
  })
  return p.then((opened) => {
    db = opened
    return opened
  })
}

const dbPromises = new Map<string, Promise<InvoiceDb>>()

/**
 * Shared connection per database name. The cached connection is dropped when it is lost
 * (version change from another tab or abnormal termination), so the next call re-opens it.
 */
export function getDb(name: string = DB_NAME): Promise<InvoiceDb> {
  let p = dbPromises.get(name)
  if (!p) {
    const forget = () => {
      if (dbPromises.get(name) === p) dbPromises.delete(name)
    }
    p = openInvoiceDb(name, forget)
    p.catch(forget)
    dbPromises.set(name, p)
  }
  return p
}
