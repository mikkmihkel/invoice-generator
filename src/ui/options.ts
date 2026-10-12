import { ESTONIAN_VAT_RATES, type InvoiceLanguage, type TemplateId, type VatScheme } from '../domain'
import { TEMPLATES, type TemplateInfo } from '../pdf'
import type { Translate } from './i18n'

export const VAT_SCHEMES: VatScheme[] = ['domestic', 'not-registered', 'eu-reverse-charge', 'eu-goods', 'export', 'non-eu-services', 'exempt', 'domestic-reverse-charge']

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'SEK', 'NOK', 'DKK', 'PLN', 'CHF']

export const ACCENT_PRESETS = ['#1f6feb', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#334155', '#111827']

export const UNIT_SUGGESTIONS = ['tk', 'h', 'päev', 'kuu', 'km', 'kg', 'm²', 'komplekt', 'teenus']

export function languageOptions(t: Translate): { value: InvoiceLanguage; label: string }[] {
  return [
    { value: 'et', label: t('lang.et') },
    { value: 'en', label: t('lang.en') },
    { value: 'et-en', label: t('lang.et-en') },
  ]
}

export function vatSchemeOptions(t: Translate): { value: VatScheme; label: string }[] {
  return VAT_SCHEMES.map((s) => ({ value: s, label: t(`vat.scheme.${s}`) }))
}

export function vatRates(current?: number): number[] {
  const base = [...ESTONIAN_VAT_RATES]
  if (!base.includes(0)) base.push(0)
  if (current != null && !base.includes(current)) base.push(current)
  return base
}

export function templates(): TemplateInfo[] {
  return TEMPLATES
}

export function templateName(id: TemplateId, lang: 'et' | 'en'): string {
  return templates().find((x) => x.id === id)?.name[lang] ?? id
}
