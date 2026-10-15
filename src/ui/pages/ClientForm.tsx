import { useState } from 'react'
import type { Client, InvoiceLanguage, VatScheme } from '../../domain'
import { useApp } from '../AppContext'
import { CompanySearch } from '../components/CompanySearch'
import { Dialog } from '../components/Dialog'
import { SelectField, TextAreaField, TextField } from '../components/fields'
import { PartyFields } from '../components/PartyFields'
import { Segmented } from '../components/ui'
import { languageOptions, vatSchemeOptions } from '../options'
import { useToast } from '../Toasts'
import { clientFromRegistry, errorMessage, newClient } from '../util'

/**
 * Create/edit a client in a dialog. Saves through the repository and returns the saved client. With
 * `offerInvoice` the confirmation of a new client links to a new invoice for them.
 */
export function ClientDialog({
  initial,
  onClose,
  onSaved,
  withSearch,
  offerInvoice,
}: {
  initial?: Client
  onClose: () => void
  onSaved?: (c: Client) => void
  withSearch?: boolean
  offerInvoice?: boolean
}) {
  const { t, saveClient, clients } = useApp()
  const toast = useToast()
  const [client, setClient] = useState<Client>(() => initial ?? newClient())
  const [saving, setSaving] = useState(false)
  const [showError, setShowError] = useState(false)
  const isNew = !clients.some((c) => c.id === client.id)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!client.name.trim()) {
      setShowError(true)
      return
    }
    setSaving(true)
    try {
      const c = { ...client, name: client.name.trim() }
      await saveClient(c)
      const newInvoice = { label: t('clients.newInvoice'), onClick: () => void (window.location.hash = `#/invoices/new?client=${encodeURIComponent(c.id)}`) }
      toast.success(isNew ? t('clients.added') : t('common.saved'), isNew && offerInvoice ? newInvoice : undefined)
      onSaved?.(c)
      onClose()
    } catch (err) {
      toast.error(t('common.saveFailed') + ' ' + errorMessage(err))
      setSaving(false)
    }
  }

  const formId = 'client-form-' + client.id
  return (
    <Dialog
      title={isNew ? t('clients.new') : t('clients.edit')}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      {withSearch && isNew && (
        <div className="dialog-search">
          <CompanySearch
            onPick={(r) => {
              const fromReg = clientFromRegistry(r)
              setClient((c) => ({ ...c, ...fromReg, id: c.id, createdAt: c.createdAt, email: c.email, phone: c.phone }))
            }}
            autoFocus
          />
        </div>
      )}
      <form id={formId} onSubmit={save} noValidate className="stack-sm">
        <div>
          <Segmented
            label={t('clients.kind')}
            value={client.kind}
            onChange={(kind) => setClient({ ...client, kind })}
            options={(['company', 'person'] as const).map((k) => ({ value: k, label: t(`clients.kind.${k}`) }))}
          />
        </div>
        <PartyFields value={client} onChange={setClient} pathPrefix="client" person={client.kind === 'person'} nameError={showError && !client.name.trim() ? t('clients.needName') : undefined} />
        <div className="grid">
          <TextField label={t('field.contactPerson')} value={client.contactPerson} onChange={(v) => setClient({ ...client, contactPerson: v || undefined })} />
          <SelectField<InvoiceLanguage | ''>
            label={t('clients.defaultLanguage')}
            value={client.defaultLanguage ?? ''}
            onChange={(v) => setClient({ ...client, defaultLanguage: v || undefined })}
            options={[{ value: '', label: t('clients.useCompanyDefault') }, ...languageOptions(t)]}
          />
          <SelectField<VatScheme | ''>
            label={t('clients.defaultVatScheme')}
            value={client.defaultVatScheme ?? ''}
            onChange={(v) => setClient({ ...client, defaultVatScheme: v || undefined })}
            options={[{ value: '', label: t('clients.useCompanyDefault') }, ...vatSchemeOptions(t)]}
          />
        </div>
        <TextAreaField label={t('clients.notes')} value={client.notes} onChange={(v) => setClient({ ...client, notes: v || undefined })} rows={2} hint={t('clients.notesHint')} />
      </form>
    </Dialog>
  )
}
