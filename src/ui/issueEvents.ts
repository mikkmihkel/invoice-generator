import type { Invoice } from '../domain'

// Tells interested parts of the app (automatic PDF saving to Drive) that the user issued a document. Only issuing
// done in this tab through AppContext.issueInvoice counts; imports, other tabs and restores do not.

type Listener = (issued: Invoice) => void
const listeners = new Set<Listener>()

export function subscribeIssued(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyIssued(issued: Invoice): void {
  for (const l of [...listeners]) {
    try {
      l(issued)
    } catch (e) {
      // A listener must never make issuing look failed.
      console.error(e)
    }
  }
}
