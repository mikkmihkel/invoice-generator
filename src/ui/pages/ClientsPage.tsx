import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Client } from '../../domain'
import { useApp } from '../AppContext'
import { useConfirm } from '../components/Dialog'
import { useToast } from '../Toasts'
import { errorMessage, formatAddress } from '../util'
import { ClientDialog } from './ClientForm'

export default function ClientsPage() {
  const { t, clients, invoices, deleteClient } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ client?: Client; search: boolean } | null>(null)

  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const inv of invoices) if (inv.buyer.clientId) m.set(inv.buyer.clientId, (m.get(inv.buyer.clientId) ?? 0) + 1)
    return m
  }, [invoices])

  const q = query.trim().toLowerCase()
  const list = q
    ? clients.filter((c) => [c.name, c.registryCode, c.vatNumber, c.email, c.contactPerson].some((s) => s?.toLowerCase().includes(q)))
    : clients

  const remove = async (c: Client) => {
    const used = usage.get(c.id) ?? 0
    const ok = await confirm({
      title: t('clients.deleteTitle', { name: c.name }),
      message: used ? t('clients.deleteUsed', { count: used }) : t('clients.deleteConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok) return
    try {
      await deleteClient(c.id)
      toast.success(t('clients.deleted'))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('nav.clients')}</h1>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ search: true })}>
            + {t('clients.addFromRegister')}
          </button>
          <button type="button" className="btn" onClick={() => setEditing({ search: false })}>
            {t('clients.addManually')}
          </button>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="empty card">
          <h2>{t('clients.emptyTitle')}</h2>
          <p className="muted">{t('clients.emptyText')}</p>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <input type="search" className="search-input" aria-label={t('clients.search')} placeholder={t('clients.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="muted">{t('clients.count', { count: list.length })}</span>
          </div>
          <ul className="client-list">
            {list.map((c) => (
              <li key={c.id} className="card client-card">
                <div className="client-main">
                  <div className="client-name">
                    {c.name}
                    {c.kind === 'person' && <span className="chip">{t('clients.kind.person')}</span>}
                  </div>
                  <div className="muted small">
                    {[c.registryCode || c.personalCode, c.vatNumber, formatAddress(c.address)].filter(Boolean).join(' · ')}
                  </div>
                  {(c.email || c.contactPerson) && <div className="muted small">{[c.contactPerson, c.email].filter(Boolean).join(' · ')}</div>}
                  <div className="muted small">{t('clients.invoiceCount', { count: usage.get(c.id) ?? 0 })}</div>
                </div>
                <div className="btn-row">
                  <Link className="btn btn-sm btn-primary" to={`/invoices/new?client=${encodeURIComponent(c.id)}`}>
                    {t('clients.newInvoice')}
                  </Link>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing({ client: c, search: false })}>
                    {t('common.edit')}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void remove(c)} aria-label={t('clients.deleteTitle', { name: c.name })}>
                    {t('common.delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {editing && <ClientDialog initial={editing.client} withSearch={editing.search} onClose={() => setEditing(null)} />}
    </div>
  )
}
