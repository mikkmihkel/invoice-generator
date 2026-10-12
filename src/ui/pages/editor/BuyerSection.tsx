import { ArrowsLeftRightIcon, MagnifyingGlassIcon, PencilSimpleIcon, UserPlusIcon } from '@phosphor-icons/react'
import { Fragment, useId, useMemo, useRef, useState } from 'react'
import type { BuyerSnapshot, Client, RegistryCompany } from '../../../domain'
import { useApp } from '../../AppContext'
import { RegistryAttribution, RegistryResult } from '../../components/CompanySearch'
import { fieldId, TextField } from '../../components/fields'
import { PartyFields } from '../../components/PartyFields'
import { useRegistryPick, useRegistrySearch } from '../../components/registrySearch'
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

function BuyerCard({ buyer, children }: { buyer: BuyerSnapshot; children?: React.ReactNode }) {
  const codes = [buyer.registryCode || buyer.personalCode, buyer.vatNumber].filter(Boolean)
  const contact = [buyer.contactPerson, buyer.email].filter(Boolean).join(', ')
  return (
    <div className="buyer-card">
      <div className="buyer-card-main">
        <strong className="buyer-name">{buyer.name}</strong>
        {codes.length > 0 && (
          <span className="buyer-codes">
            {codes.map((c) => (
              <span key={c} className="mono">
                {c}
              </span>
            ))}
          </span>
        )}
        {formatAddress(buyer.address) && <span className="buyer-line">{formatAddress(buyer.address)}</span>}
        {contact && <span className="buyer-line">{contact}</span>}
      </div>
      {children && <div className="buyer-card-actions">{children}</div>}
    </div>
  )
}

type PickerOption = { kind: 'client'; client: Client } | { kind: 'registry'; company: RegistryCompany }

const norm = (s: string | undefined) => (s ?? '').toLowerCase()

/**
 * One search box for the buyer: saved clients match instantly, the e-Business Register is searched
 * as you type (from 2 characters). Picking a register company also saves it as a client.
 */
function BuyerPicker({ onPickClient, onPickRegistry, autoFocus }: { onPickClient: (c: Client) => void; onPickRegistry: (r: RegistryCompany) => void; autoFocus?: boolean }) {
  const { t, lang, clients } = useApp()
  const listId = useId() + '-list'
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const registry = useRegistrySearch(query)
  const { pick: pickRegistry, picking } = useRegistryPick((c) => {
    setQuery('')
    setOpen(false)
    onPickRegistry(c)
  })

  const q = query.trim().toLowerCase()
  const saved = useMemo(() => {
    const list = q ? clients.filter((c) => [c.name, c.registryCode, c.vatNumber, c.personalCode, c.email].some((s) => norm(s).includes(q))) : clients
    return list.slice(0, 8)
  }, [clients, q])
  const savedCodes = useMemo(() => new Set(clients.map((c) => c.registryCode).filter(Boolean)), [clients])
  const fromRegistry = registry.results.filter((r) => !savedCodes.has(r.registryCode)).slice(0, 8)
  const options: PickerOption[] = [...saved.map((client) => ({ kind: 'client' as const, client })), ...fromRegistry.map((company) => ({ kind: 'registry' as const, company }))]
  const show = open && (options.length > 0 || q.length >= 2)
  // The highlighted option stays within the current list as results change.
  const activeIdx = Math.max(0, Math.min(active, options.length - 1))


  const choose = (o: PickerOption) => {
    if (o.kind === 'client') {
      setQuery('')
      setOpen(false)
      onPickClient(o.client)
    } else void pickRegistry(o.company)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setActive(Math.min(options.length - 1, activeIdx + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(0, activeIdx - 1))
    } else if (e.key === 'Enter' && show && options[activeIdx]) {
      e.preventDefault()
      choose(options[activeIdx])
    } else if (e.key === 'Escape' && show) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }

  const optionId = (i: number) => `${listId}-${i}`
  const renderOption = (o: PickerOption, i: number) => (
    <li
      id={optionId(i)}
      role="option"
      aria-selected={i === activeIdx}
      className={`combo-opt${i === activeIdx ? ' active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setActive(i)}
      onClick={() => choose(o)}
    >
      {o.kind === 'client' ? (
        <>
          <span className="opt-name">{o.client.name}</span>
          <span className="opt-meta">
            {(o.client.registryCode || o.client.personalCode) && <span className="mono">{o.client.registryCode || o.client.personalCode}</span>}
            {o.client.vatNumber && <span className="mono">{o.client.vatNumber}</span>}
            {formatAddress(o.client.address) && <span className="opt-addr">{formatAddress(o.client.address)}</span>}
          </span>
        </>
      ) : (
        <RegistryResult company={o.company} lang={lang} />
      )}
    </li>
  )

  return (
    <div className="buyer-picker">
      <label htmlFor={fieldId('buyer')}>{t('buyer.savedClient')}</label>
      <div className="combo-input">
        <MagnifyingGlassIcon className="combo-icon" />
        <input
          id={fieldId('buyer')}
          type="search"
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={show && options[activeIdx] ? optionId(activeIdx) : undefined}
          aria-describedby={fieldId('buyer') + '-hint'}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={t('buyer.pickerPlaceholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {(registry.loading || picking) && <span className="spinner" aria-label={t('common.loading')} />}
        <ul id={listId} role="listbox" className="combo-list" hidden={!show} aria-label={t('registry.results')}>
          {saved.length > 0 && (
            <li role="presentation" className="combo-group">
              {t('buyer.groupSaved')}
            </li>
          )}
          {options.map((o, i) => (
            <Fragment key={o.kind === 'client' ? 'c-' + o.client.id : 'r-' + o.company.registryCode}>
              {o.kind === 'registry' && (i === 0 || options[i - 1].kind === 'client') && (
                <li role="presentation" className="combo-group">
                  {t('buyer.groupRegistry')}
                </li>
              )}
              {renderOption(o, i)}
            </Fragment>
          ))}
          {options.length === 0 && q.length >= 2 && !registry.loading && (
            <li role="presentation" className="combo-empty">
              {registry.failed ? t('registry.failed') : t('buyer.noMatches')}
            </li>
          )}
        </ul>
      </div>
      <div className="field-hint" id={fieldId('buyer') + '-hint'}>
        {t('buyer.pickerHint')}
      </div>
    </div>
  )
}

export function BuyerSection({ buyer, onChange, onPickClient, disabled, forceEdit }: Props) {
  const { t, lang, clients, saveClient } = useApp()
  const toast = useToast()
  const [newClient, setNewClient] = useState(false)
  const [editing, setEditing] = useState(false)
  const [changing, setChanging] = useState(false)
  const hasBuyer = !!buyer.name
  const showFields = editing || !!forceEdit
  const changeRef = useRef<HTMLButtonElement>(null)

  const pickClient = (c: Client) => {
    setChanging(false)
    setEditing(false)
    onPickClient(c)
  }

  const fromRegister = async (r: RegistryCompany) => {
    const existing = clients.find((c) => c.registryCode && c.registryCode === r.registryCode)
    if (existing) {
      pickClient(existing)
      return
    }
    const c = clientFromRegistry(r)
    try {
      await saveClient(c)
      toast.success(t('clients.addedNamed', { name: c.name }))
    } catch (e) {
      toast.error(errorMessage(e))
    }
    pickClient(c)
  }

  if (disabled) return <BuyerCard buyer={buyer} />

  const picking = !hasBuyer ? !showFields : changing

  return (
    <div className="buyer">
      {picking && (
        <>
          <BuyerPicker onPickClient={pickClient} onPickRegistry={(r) => void fromRegister(r)} autoFocus={changing} />
          <div className="buyer-alt">
            <button type="button" className="btn btn-sm" onClick={() => setNewClient(true)}>
              <UserPlusIcon />
              {t('buyer.newClient')}
            </button>
            {!hasBuyer && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
                <PencilSimpleIcon />
                {t('buyer.enterManually')}
              </button>
            )}
            {changing && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setChanging(false)
                  requestAnimationFrame(() => changeRef.current?.focus())
                }}
              >
                {t('buyer.cancelChange')}
              </button>
            )}
            <RegistryAttribution lang={lang} />
          </div>
        </>
      )}

      {!picking && hasBuyer && !showFields && (
        <BuyerCard buyer={buyer}>
          <button ref={changeRef} type="button" className="btn btn-sm btn-ghost" onClick={() => setChanging(true)}>
            <ArrowsLeftRightIcon />
            {t('buyer.change')}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
            <PencilSimpleIcon />
            {t('buyer.editDetails')}
          </button>
        </BuyerCard>
      )}

      {!picking && showFields && (
        <div className="buyer-edit">
          <p className="field-hint">{t('buyer.snapshotHint')}</p>
          <PartyFields value={buyer} onChange={onChange} pathPrefix="buyer" person={buyer.kind === 'person'} />
          <div className="grid">
            <TextField label={t('field.contactPerson')} path="buyer.contactPerson" value={buyer.contactPerson} onChange={(v) => onChange({ ...buyer, contactPerson: v || undefined })} />
          </div>
          <div className="btn-row">
            {editing && hasBuyer && (
              <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
                {t('buyer.doneEditing')}
              </button>
            )}
            {hasBuyer ? (
              <button ref={changeRef} type="button" className="btn btn-sm btn-ghost" onClick={() => setChanging(true)}>
                <ArrowsLeftRightIcon />
                {t('buyer.change')}
              </button>
            ) : (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>
                <MagnifyingGlassIcon />
                {t('onboarding.backToSearch')}
              </button>
            )}
          </div>
        </div>
      )}

      {newClient && <ClientDialog onClose={() => setNewClient(false)} onSaved={pickClient} withSearch={false} />}
    </div>
  )
}
