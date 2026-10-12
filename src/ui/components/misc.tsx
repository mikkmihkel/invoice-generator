import { useRef, useState, type ReactNode } from 'react'
import { isValidIban, newId, type BankAccount } from '../../domain'
import { useApp } from '../AppContext'
import { formatIban } from '../format'
import { useToast } from '../Toasts'
import type { DisplayStatus } from '../util'
import { errorMessage, estonianBankFromIban, resizeImageToDataUrl } from '../util'
import { TextField } from './fields'

export function StatusChip({ status }: { status: DisplayStatus }) {
  const { t } = useApp()
  return <span className={`chip chip-${status}`}>{t(`status.${status}`)}</span>
}

export function Section({ title, description, children, actions, id }: { title: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section className="card section" id={id} aria-labelledby={id ? id + '-title' : undefined}>
      <div className="section-head">
        <div>
          <h2 id={id ? id + '-title' : undefined}>{title}</h2>
          {description && <p className="muted">{description}</p>}
        </div>
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function LogoInput({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const { t } = useApp()
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error(t('logo.notImage'))
      return
    }
    setBusy(true)
    try {
      const url = await resizeImageToDataUrl(file, 400)
      if (url.length > 280_000) toast.info(t('logo.large'))
      onChange(url)
    } catch (e) {
      toast.error(t('logo.failed') + ' ' + errorMessage(e))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="field logo-input">
      <span className="label">{t('logo.label')}</span>
      <div className="logo-row">
        <div className="logo-preview">{value ? <img src={value} alt={t('logo.preview')} /> : <span className="muted">{t('logo.none')}</span>}</div>
        <div className="btn-row">
          <label className="btn">
            {busy ? t('common.loading') : value ? t('logo.change') : t('logo.upload')}
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="visually-hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {value && (
            <button type="button" className="btn btn-ghost" onClick={() => onChange(undefined)}>
              {t('logo.remove')}
            </button>
          )}
        </div>
      </div>
      <div className="field-hint">{t('logo.hint')}</div>
    </div>
  )
}

function ibanValid(iban: string): boolean {
  try {
    return isValidIban(iban)
  } catch {
    return true
  }
}

export function BankAccountsEditor({ value, onChange }: { value: BankAccount[]; onChange: (v: BankAccount[]) => void }) {
  const { t } = useApp()
  const update = (i: number, patch: Partial<BankAccount>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  return (
    <div className="bank-accounts">
      {value.map((acc, i) => (
        <div className="bank-row" key={acc.id}>
          <TextField
            label={t('bank.iban')}
            path={`bankAccounts.${i}.iban`}
            value={acc.iban}
            onChange={(v) => {
              const iban = v.replace(/\s+/g, '').toUpperCase()
              const guess = estonianBankFromIban(iban)
              update(i, { iban, bankName: acc.bankName || guess?.bankName, bic: acc.bic || guess?.bic })
            }}
            placeholder="EE38 2200 2210 2014 5685"
            error={acc.iban && !ibanValid(acc.iban) ? t('bank.ibanInvalid') : undefined}
            hint={acc.iban ? formatIban(acc.iban) : undefined}
            required
          />
          <TextField label={t('bank.name')} value={acc.bankName} onChange={(v) => update(i, { bankName: v || undefined })} />
          <TextField label={t('bank.bic')} value={acc.bic} onChange={(v) => update(i, { bic: v.toUpperCase() || undefined })} />
          <button type="button" className="btn btn-ghost btn-sm bank-remove" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t('bank.remove')}>
            {t('common.remove')}
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...value, { id: newId(), iban: '' }])}>
        + {t('bank.add')}
      </button>
    </div>
  )
}
