import { useEffect, useState } from 'react'
import { localTodayISO } from '../../util'

// When an issued invoice was e-mailed from this browser. Only decides which action is offered first
// (send, then mark paid), so per-browser storage is enough; the invoice record itself stays locked.
const KEY = 'invoice-generator:sentInvoices'
const EVENT = 'invoice-generator:sent'

function readAll(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function getSentAt(id: string): string | null {
  const v = readAll()[id]
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

export function markSent(id: string, at = localTodayISO()) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [id]: at }))
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }))
}

/** Date the invoice was sent from this browser, updated live when it is sent (callers key by invoice id). */
export function useSentAt(id: string): string | null {
  const [sentAt, setSentAt] = useState(() => getSentAt(id))
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) setSentAt(getSentAt(id))
    }
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [id])
  return sentAt
}
