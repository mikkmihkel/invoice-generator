import { isValidEstonianRegistryCode, isValidVatNumber, type Address, type Party } from '../../domain'
import { useApp } from '../AppContext'
import { TextField } from './fields'

function safeCheck(fn: () => boolean): boolean {
  try {
    return fn()
  } catch {
    return true
  }
}

export function registryCodeError(code: string | undefined, country: string | undefined, msg: string): string | undefined {
  if (!code || (country && country !== 'EE')) return undefined
  return safeCheck(() => isValidEstonianRegistryCode(code)) ? undefined : msg
}

export function vatNumberError(vat: string | undefined, msg: string): string | undefined {
  if (!vat) return undefined
  return safeCheck(() => isValidVatNumber(vat)) ? undefined : msg
}

export function AddressFields({ value, onChange, pathPrefix, disabled }: { value: Address; onChange: (a: Address) => void; pathPrefix: string; disabled?: boolean }) {
  const { t } = useApp()
  const set = (patch: Partial<Address>) => onChange({ ...value, ...patch })
  return (
    <div className="grid grid-addr">
      <TextField className="span-2" label={t('field.street')} path={`${pathPrefix}.street`} value={value.street} onChange={(v) => set({ street: v })} autoComplete="street-address" disabled={disabled} />
      <TextField label={t('field.postalCode')} path={`${pathPrefix}.postalCode`} value={value.postalCode} onChange={(v) => set({ postalCode: v })} autoComplete="postal-code" inputMode="numeric" disabled={disabled} />
      <TextField label={t('field.city')} path={`${pathPrefix}.city`} value={value.city} onChange={(v) => set({ city: v })} autoComplete="address-level2" disabled={disabled} />
      <TextField label={t('field.county')} path={`${pathPrefix}.county`} value={value.county} onChange={(v) => set({ county: v || undefined })} disabled={disabled} />
      <TextField
        label={t('field.country')}
        path={`${pathPrefix}.country`}
        value={value.country}
        onChange={(v) => set({ country: v.toUpperCase().slice(0, 2) })}
        maxLength={2}
        hint={t('field.countryHint')}
        disabled={disabled}
      />
    </div>
  )
}

/** Name, codes, VAT number, address and contacts of a company or person. */
export function PartyFields<T extends Party>({
  value,
  onChange,
  pathPrefix,
  person,
  disabled,
  showContacts = true,
}: {
  value: T
  onChange: (p: T) => void
  pathPrefix: string
  person?: boolean
  disabled?: boolean
  showContacts?: boolean
}) {
  const { t } = useApp()
  const set = (patch: Partial<Party>) => onChange({ ...value, ...patch })
  const p = pathPrefix ? pathPrefix + '.' : ''
  return (
    <>
      <div className="grid">
        <TextField className="span-2" label={person ? t('field.personName') : t('field.companyName')} path={`${p}name`} value={value.name} onChange={(v) => set({ name: v })} required disabled={disabled} />
        {person ? (
          <TextField label={t('field.personalCode')} path={`${p}personalCode`} value={value.personalCode} onChange={(v) => set({ personalCode: v.trim() || undefined })} inputMode="numeric" disabled={disabled} />
        ) : (
          <TextField
            label={t('field.registryCode')}
            path={`${p}registryCode`}
            value={value.registryCode}
            onChange={(v) => set({ registryCode: v.trim() || undefined })}
            inputMode="numeric"
            error={registryCodeError(value.registryCode, value.address?.country, t('field.registryCodeInvalid'))}
            disabled={disabled}
          />
        )}
        <TextField
          label={t('field.vatNumber')}
          path={`${p}vatNumber`}
          value={value.vatNumber}
          onChange={(v) => set({ vatNumber: v.replace(/\s+/g, '').toUpperCase() || undefined })}
          placeholder="EE123456789"
          error={vatNumberError(value.vatNumber, t('field.vatNumberInvalid'))}
          disabled={disabled}
        />
      </div>
      <AddressFields value={value.address} onChange={(a) => set({ address: a })} pathPrefix={`${p}address`} disabled={disabled} />
      {showContacts && (
        <div className="grid">
          <TextField label={t('field.email')} type="email" path={`${p}email`} value={value.email} onChange={(v) => set({ email: v.trim() || undefined })} autoComplete="email" disabled={disabled} />
          <TextField label={t('field.phone')} type="tel" path={`${p}phone`} value={value.phone} onChange={(v) => set({ phone: v || undefined })} autoComplete="tel" disabled={disabled} />
        </div>
      )}
    </>
  )
}
