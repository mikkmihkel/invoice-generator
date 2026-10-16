import { useState } from 'react'
import type { Client, InvoiceLanguage, VatScheme } from '../../domain'
import { useApp } from '../AppContext'
import { CompanySearch } from '../components/CompanySearch'
import { Dialog } from '../components/Dialog'
import { NumberField, SelectField, TextAreaField, TextField } from '../components/fields'
import { PartyFields } from '../components/PartyFields'
import { Segmented } from '../components/ui'
import { languageOptions, vatSchemeOptions } from '../options'
import { useToast } from '../Toasts'
import { clientFromRegistry, errorMessage, newClient } from '../util'
import { parseRecipients } from './editor/email'
import { formatNumber } from '../format'

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
  const { t, saveClient, clients, profile } = useApp()
  const toast = useToast()
  const [client, setClient] = useState<Client>(() => initial ?? newClient())
  const [saving, setSaving] = useState(false)
  const [showError, setShowError] = useState(false)
  const isNew = !clients.some((c) => c.id === client.id)
  const ccInvalid = parseRecipients(client.emailCc ?? '').invalid
  const companyTerm = profile?.defaults.paymentTermDays ?? 14
  const companyInterest = profile?.defaults.lateInterestPercentPerDay

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!client.name.trim() || ccInvalid.length) {
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
          <NumberField
            label={t('clients.paymentTerm')}
            path="client.paymentTermDays"
            value={client.paymentTermDays}
            onChange={(v) => setClient({ ...client, paymentTermDays: v == null ? undefined : Math.max(0, Math.round(v)) })}
            allowEmpty
            suffix={t('common.days')}
            placeholder={String(companyTerm)}
            hint={t('clients.paymentTermHint', { days: companyTerm })}
          />
          <NumberField
            label={t('clients.lateInterest')}
            path="client.lateInterestPercentPerDay"
            value={client.lateInterestPercentPerDay}
            onChange={(v) => setClient({ ...client, lateInterestPercentPerDay: v == null ? undefined : Math.max(0, v) })}
            allowEmpty
            suffix={t('common.percentPerDay')}
            placeholder={companyInterest ? formatNumber(companyInterest) : undefined}
            hint={companyInterest ? t('clients.lateInterestHint', { rate: formatNumber(companyInterest) }) : t('clients.lateInterestHintNone')}
          />
          <TextField
            className="span-2"
            label={t('clients.emailCc')}
            path="client.emailCc"
            inputMode="email"
            autoComplete="off"
            value={client.emailCc}
            onChange={(v) => setClient({ ...client, emailCc: v.trim() ? v : undefined })}
            hint={t('clients.emailCcHint')}
            error={showError && ccInvalid.length ? t('email.invalidAddress', { list: ccInvalid.join(', ') }) : undefined}
          />
        </div>
        <TextAreaField label={t('clients.notes')} value={client.notes} onChange={(v) => setClient({ ...client, notes: v || undefined })} rows={2} hint={t('clients.internalNoteHint')} />
      </form>
    </Dialog>
  )
}
