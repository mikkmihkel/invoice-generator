import { FilePlusIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, TrashIcon, UsersIcon } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Client } from '../../domain'
import { useApp } from '../AppContext'
import { useConfirm } from '../components/Dialog'
import { EmptyState, IconButton, SearchField } from '../components/ui'
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

  const addButtons = (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setEditing({ search: true })}>
        <MagnifyingGlassIcon />
        {t('clients.addFromRegister')}
      </button>
      <button type="button" className="btn" onClick={() => setEditing({ search: false })}>
        <PlusIcon />
        {t('clients.addManually')}
      </button>
    </>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('nav.clients')}</h1>
          {clients.length > 0 && <p className="page-sub">{t('clients.count', { count: clients.length })}</p>}
        </div>
        {clients.length > 0 && <div className="btn-row">{addButtons}</div>}
      </div>

      {clients.length === 0 ? (
        <EmptyState icon={<UsersIcon size={28} />} title={t('clients.emptyTitle')} actions={addButtons}>
          <p>{t('clients.emptyText')}</p>
        </EmptyState>
      ) : (
        <>
          <div className="list-toolbar">
            <SearchField value={query} onChange={setQuery} label={t('clients.search')} shortcutHint={t('common.searchShortcut')} />
            {q && <span className="toolbar-note">{t('list.shown', { count: list.length })}</span>}
          </div>
          {list.length === 0 ? (
            <div className="panel empty-filter">
              <p>{t('clients.noMatches')}</p>
              <button type="button" className="btn btn-sm" onClick={() => setQuery('')}>
                {t('list.clearFilters')}
              </button>
            </div>
          ) : (
            <div className="panel table-panel">
              <table className="ledger client-table">
                <thead>
                  <tr>
                    <th scope="col">{t('clients.colName')}</th>
                    <th scope="col" className="col-code">
                      {t('clients.colCode')}
                    </th>
                    <th scope="col" className="col-vat">
                      {t('clients.colVat')}
                    </th>
                    <th scope="col" className="col-contact">
                      {t('clients.colContact')}
                    </th>
                    <th scope="col" className="num col-count">
                      {t('clients.colInvoices')}
                    </th>
                    <th scope="col" className="col-actions">
                      <span className="visually-hidden">{t('list.colActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id}>
                      <td className="col-name">
                        <span className="client-name">
                          <button type="button" className="name-btn" onClick={() => setEditing({ client: c, search: false })} title={t('clients.editNamed', { name: c.name })}>
                            {c.name}
                          </button>
                          {c.kind === 'person' && <span className="chip chip-neutral">{t('clients.kind.person')}</span>}
                        </span>
                        {formatAddress(c.address) && <span className="client-addr">{formatAddress(c.address)}</span>}
                      </td>
                      <td className="col-code mono">{c.registryCode || c.personalCode}</td>
                      <td className="col-vat mono">{c.vatNumber}</td>
                      <td className="col-contact">{[c.contactPerson, c.email].filter(Boolean).join(', ')}</td>
                      <td className="num col-count">{usage.get(c.id) ?? 0}</td>
                      <td className="col-actions">
                        <div className="row-actions row-actions-visible">
                          <Link className="btn btn-text btn-sm" to={`/invoices/new?client=${encodeURIComponent(c.id)}`} aria-label={t('clients.newInvoiceFor', { name: c.name })} title={t('clients.newInvoiceFor', { name: c.name })}>
                            <FilePlusIcon />
                            <span className="collapse-label" aria-hidden="true">
                              {t('clients.newInvoice')}
                            </span>
                          </Link>
                          <IconButton label={t('clients.editNamed', { name: c.name })} icon={<PencilSimpleIcon />} onClick={() => setEditing({ client: c, search: false })} />
                          <IconButton className="icon-btn-danger" label={t('clients.deleteNamed', { name: c.name })} icon={<TrashIcon />} onClick={() => void remove(c)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {editing && <ClientDialog initial={editing.client} withSearch={editing.search} onClose={() => setEditing(null)} offerInvoice />}
    </div>
  )
}
