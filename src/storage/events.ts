/** Which part of the data changed. 'all' = bulk change (backup import). */
export type StorageArea = 'profile' | 'clients' | 'invoices' | 'settings' | 'all'

export interface StorageChange {
  area: StorageArea
  /** Id of the changed record for clients / invoices. */
  id?: string
  /** 'local' = this tab, 'remote' = another tab via BroadcastChannel. */
  source: 'local' | 'remote'
}

export type StorageListener = (change: StorageChange) => void

const CHANNEL_NAME = 'invoice-generator-storage'
const listeners = new Set<StorageListener>()
let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (channel) return channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    // Node's BroadcastChannel would keep test processes alive.
    ;(channel as unknown as { unref?: () => void }).unref?.()
    channel.onmessage = (ev: MessageEvent) => {
      const data = ev.data as Partial<StorageChange> | null
      if (!data || typeof data.area !== 'string') return
      emit({ area: data.area as StorageArea, id: data.id, source: 'remote' })
    }
  } catch {
    channel = null
  }
  return channel
}

function emit(change: StorageChange) {
  for (const l of [...listeners]) {
    try {
      l(change)
    } catch (e) {
      console.error('storage listener failed', e)
    }
  }
}

/**
 * Listen for data changes (after successful writes in this tab, and writes in other tabs).
 * Returns an unsubscribe function.
 */
export function subscribe(listener: StorageListener): () => void {
  listeners.add(listener)
  getChannel()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && channel) {
      channel.close()
      channel = null
    }
  }
}

/** Called by the repository after a write transaction completes. */
export function notifyChange(area: StorageArea, id?: string): void {
  emit({ area, id, source: 'local' })
  try {
    getChannel()?.postMessage({ area, id })
  } catch {
    // ignore: cross-tab sync is best-effort
  }
}
