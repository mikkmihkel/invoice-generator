import { useEffect, useState } from 'react'
import { newId, type InvoiceEvent } from '../../../domain'
import { subscribe, type Repository } from '../../../storage'
import { useApp } from '../../AppContext'

// Earlier versions kept "sent on" dates per browser in localStorage; they are moved into invoice events once.
const LEGACY_KEY = 'invoice-generator:sentInvoices'
const REFRESH = 'invoice-generator:invoice-events'

let legacyImport: Promise<void> | null = null

function readLegacy(): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}
  } catch {
    return null
  }
}

export function legacySentId(invoiceId: string, date: string): string {
  return `sent-${invoiceId.replace(/[^A-Za-z0-9_-]/g, '_')}-${date}`
}

/** Move the old per-browser "sent" dates into the repository (the old entry is removed afterwards). */
export function importLegacySent(repo: Repository): Promise<void> {
  if (legacyImport) return legacyImport
  const legacy = readLegacy()
  if (!legacy) return Promise.resolve()
  legacyImport = (async () => {
    const existing = await repo.listInvoiceEvents()
    const sent = new Set(existing.filter((e) => e.kind === 'sent').map((e) => e.invoiceId))
    for (const [invoiceId, date] of Object.entries(legacy)) {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || sent.has(invoiceId)) continue
      // The id comes from the invoice and the date, so another tab importing at the same time writes the same record.
      await repo.addInvoiceEvent({ id: legacySentId(invoiceId, date), invoiceId, kind: 'sent', at: `${date}T12:00:00.000Z` })
    }
    try {
      localStorage.removeItem(LEGACY_KEY)
    } catch {
      /* storage unavailable */
    }
  })()
    .catch((e) => console.warn('Could not import sent dates', e))
    .finally(() => {
      legacyImport = null
    })
  return legacyImport
}

/** For tests. */
export function resetLegacyImport(): void {
  legacyImport = null
}

/** Ask mounted `useInvoiceEvents` hooks to reload (e.g. after a write that the storage layer does not announce). */
export function refreshInvoiceEvents(invoiceId: string): void {
  window.dispatchEvent(new CustomEvent(REFRESH, { detail: invoiceId }))
}

/** Store a 'sent' or 'reminder' event for the invoice now. */
export async function recordInvoiceEvent(repo: Repository, invoiceId: string, kind: InvoiceEvent['kind'], note?: string): Promise<InvoiceEvent> {
  const event: InvoiceEvent = { id: newId(), invoiceId, kind, at: new Date().toISOString(), ...(note ? { note: note.slice(0, 500) } : {}) }
  const stored = await repo.addInvoiceEvent(event)
  refreshInvoiceEvents(invoiceId)
  return stored
}

/** Local calendar date (YYYY-MM-DD) of an event timestamp. */
export function eventDate(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface InvoiceHistory {
  events: InvoiceEvent[]
  /** Date of the latest e-mail sending of the document, or null. */
  sentAt: string | null
  /** Dates of the payment reminders, oldest first. */
  reminders: string[]
}

export function summarizeEvents(events: readonly InvoiceEvent[]): InvoiceHistory {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at))
  const sent = sorted.filter((e) => e.kind === 'sent')
  return {
    events: sorted,
    sentAt: sent.length ? eventDate(sent[sent.length - 1].at) : null,
    reminders: sorted.filter((e) => e.kind === 'reminder').map((e) => eventDate(e.at)),
  }
}

/** Sending and reminder history of one invoice, kept up to date (callers key by invoice id). */
export function useInvoiceEvents(invoiceId: string): InvoiceHistory {
  const { repo } = useApp()
  const [events, setEvents] = useState<InvoiceEvent[]>([])
  useEffect(() => {
    let alive = true
    const load = () =>
      importLegacySent(repo)
        .then(() => repo.listInvoiceEvents(invoiceId))
        .then((list) => alive && setEvents(list))
        .catch((e) => console.warn('Could not load invoice events', e))
    void load()
    const onRefresh = (e: Event) => {
      if ((e as CustomEvent<string>).detail === invoiceId) void load()
    }
    window.addEventListener(REFRESH, onRefresh)
    const unsub = subscribe((change) => {
      if (change.area === 'invoiceEvents' || change.area === 'all') void load()
    })
    return () => {
      alive = false
      window.removeEventListener(REFRESH, onRefresh)
      unsub()
    }
  }, [repo, invoiceId])
  return summarizeEvents(events)
}
