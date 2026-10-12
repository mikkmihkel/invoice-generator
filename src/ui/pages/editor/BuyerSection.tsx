import { useState } from 'react'
import type { BuyerSnapshot, Client, RegistryCompany } from '../../../domain'
import { useApp } from '../../AppContext'
import { CompanySearch } from '../../components/CompanySearch'
import { Dialog } from '../../components/Dialog'
import { fieldId, TextField } from '../../components/fields'
import { PartyFields } from '../../components/PartyFields'
import { useToast } from '../../Toasts'
import { clientFromRegistry, errorMessage, formatAddress } from '../../util'
import { ClientDialog } from '../ClientForm'

interface Props {
  buyer: BuyerSnapshot
  onChange: (buyer: BuyerSnapshot) => void
  onPickClient: (client: Client) => void
  disabled?: boolean
  /** Show the editable fields (e.g. when validation flags a buyer field). */
  forceEdit?: boolean
}

export function BuyerSection({ buyer, onChange, onPickClient, disabled, forceEdit }: Props) {
  const { t, clients, saveClient } = useApp()
  const toast = useToast()
  const [mode, setMode] = useState<null | 'register' | 'new'>(null)
  const [editing, setEditing] = useState(false)
  const hasBuyer = !!buyer.name
  const showFields = editing || !!forceEdit

  const fromRegister = async (r: RegistryCompany) => {
    const existing = clients.find((c) => c.registryCode && c.registryCode === r.registryCode)
    if (existing) {
      onPickClient(existing)
      setMode(null)
      return
    }
    const c = clientFromRegistry(r)
    try {
      await saveClient(c)
      toast.success(t('clients.addedNamed', { name: c.name }))
    } catch (e) {
      toast.error(errorMessage(e))
    }
    onPickClient(c)
    setMode(null)
  }

  if (disabled) {
    return (
      <div className="buyer-summary">
        <div>
          <strong>{buyer.name}</strong>
          <div className="muted small">{[buyer.registryCode || buyer.personalCode, buyer.vatNumber].filter(Boolean).join(' · ')}</div>
          <div className="muted small">{formatAddress(buyer.address)}</div>
          {(buyer.contactPerson || buyer.email) && <div className="muted small">{[buyer.contactPerson, buyer.email].filter(Boolean).join(' · ')}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="buyer">
      <div className="buyer-pick">
        <div className="field">
          <label htmlFor={fieldId('buyer')}>{t('buyer.savedClient')}</label>
          <select
            id={fieldId('buyer')}
            value={buyer.clientId && clients.some((c) => c.id === buyer.clientId) ? buyer.clientId : ''}
            onChange={(e) => {
              const c = clients.find((x) => x.id === e.target.value)
              if (c) onPickClient(c)
            }}
          >
            <option value="">{clients.length ? t('buyer.choose') : t('buyer.noClients')}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.registryCode ? ` (${c.registryCode})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => setMode('register')}>
            {t('buyer.searchRegister')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setMode('new')}>
            + {t('buyer.newClient')}
          </button>
        </div>
      </div>

      {hasBuyer && !showFields && (
        <div className="buyer-summary">
          <div>
            <strong>{buyer.name}</strong>
            <div className="muted small">{[buyer.registryCode || buyer.personalCode, buyer.vatNumber].filter(Boolean).join(' · ')}</div>
            <div className="muted small">{formatAddress(buyer.address)}</div>
            {(buyer.contactPerson || buyer.email) && <div className="muted small">{[buyer.contactPerson, buyer.email].filter(Boolean).join(' · ')}</div>}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
            {t('buyer.editDetails')}
          </button>
        </div>
      )}

      {!hasBuyer && !showFields && (
        <button type="button" className="link-btn" onClick={() => setEditing(true)}>
          {t('buyer.enterManually')}
        </button>
      )}

      {showFields && (
        <div className="buyer-edit">
          <p className="muted small">{t('buyer.snapshotHint')}</p>
          <PartyFields value={buyer} onChange={onChange} pathPrefix="buyer" person={buyer.kind === 'person'} />
          <TextField label={t('field.contactPerson')} path="buyer.contactPerson" value={buyer.contactPerson} onChange={(v) => onChange({ ...buyer, contactPerson: v || undefined })} />
          {editing && hasBuyer && (
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              {t('buyer.doneEditing')}
            </button>
          )}
        </div>
      )}

      {mode === 'register' && (
        <Dialog title={t('buyer.searchRegister')} onClose={() => setMode(null)} closeLabel={t('common.close')}>
          <CompanySearch onPick={(r) => void fromRegister(r)} autoFocus />
        </Dialog>
      )}
      {mode === 'new' && <ClientDialog onClose={() => setMode(null)} onSaved={onPickClient} withSearch={false} />}
    </div>
  )
}
