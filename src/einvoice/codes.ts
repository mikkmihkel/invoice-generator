// Code lists used by the Peppol BIS Billing 3.0 mapping.
import type { Party, VatScheme } from '../domain/types'

/** UNCL5305 VAT category codes used by this app. */
export type TaxCategoryId = 'S' | 'Z' | 'AE' | 'K' | 'G' | 'E' | 'O'

export interface TaxCategory {
  id: TaxCategoryId
  /** Omitted for 'O' (BR-O-05). */
  percent?: number
  /** CEF VATEX code. */
  reasonCode?: string
  reason?: string
}

/**
 * VatScheme → EN 16931 VAT category.
 * domestic: S (rate > 0) / Z (0 %); EU services reverse charge and KMS § 41¹ domestic reverse charge: AE;
 * intra-Community goods: K; export and services to non-EU customers: G; exempt (KMS § 16): E; seller not VAT registered: O.
 */
export function taxCategoryFor(scheme: VatScheme, rate: number, reason?: string): TaxCategory {
  switch (scheme) {
    case 'domestic':
      return rate > 0 ? { id: 'S', percent: rate } : { id: 'Z', percent: 0 }
    case 'eu-reverse-charge':
    case 'domestic-reverse-charge':
      return { id: 'AE', percent: 0, reasonCode: 'VATEX-EU-AE', reason: reason || 'Reverse charge' }
    case 'eu-goods':
      return { id: 'K', percent: 0, reasonCode: 'VATEX-EU-IC', reason: reason || 'Intra-Community supply' }
    case 'export':
      return { id: 'G', percent: 0, reasonCode: 'VATEX-EU-G', reason: reason || 'Export outside the EU' }
    case 'non-eu-services':
      return { id: 'G', percent: 0, reasonCode: 'VATEX-EU-G', reason: reason || 'Services supplied outside the EU, not subject to Estonian VAT' }
    case 'exempt':
      return { id: 'E', percent: 0, reason: reason || 'Exempt from VAT' }
    case 'not-registered':
    default:
      return { id: 'O', reasonCode: 'VATEX-EU-O', reason: reason || 'Not subject to VAT' }
  }
}

/** Peppol EAS codes for VAT-number based electronic addresses, by VAT prefix. */
const VAT_EAS: Record<string, string> = {
  AT: '9914', BE: '9925', BG: '9926', CY: '9928', CZ: '9929', DE: '9930', EE: '9931', GB: '9932', XI: '9932',
  EL: '9933', GR: '9933', HR: '9934', IE: '9935', LT: '9937', LU: '9938', LV: '9939', MT: '9943', NL: '9944',
  PL: '9945', PT: '9946', RO: '9947', SI: '9949', SK: '9950', HU: '9910', ES: '9920', FR: '9957',
  IT: '0211', FI: '0213', DK: '0198',
}

export interface EndpointId {
  schemeID: string
  value: string
}

const clean = (s: string | undefined) => (s ?? '').replace(/[\s.-]/g, '').toUpperCase()

/**
 * Electronic address (EndpointID) for a party. Estonian companies are addressed by registry code
 * (ICD 0191 — the Estonian Centre of Registers and Information Systems), which is how Estonian e-invoice
 * operators register Peppol participants. Others fall back to their VAT number scheme.
 */
export function endpointFor(party: Party): EndpointId | null {
  const country = (party.address?.country || 'EE').toUpperCase()
  const reg = clean(party.registryCode)
  if (country === 'EE' && /^\d{8}$/.test(reg)) return { schemeID: '0191', value: reg }
  const vat = clean(party.vatNumber)
  const prefix = vat.slice(0, 2)
  if (vat.length > 2 && /^[A-Z]{2}$/.test(prefix)) {
    if (prefix === 'SE' && /^SE\d{12}$/.test(vat)) return { schemeID: '0007', value: vat.slice(2, 12) }
    if (prefix === 'NO') {
      const digits = vat.replace(/\D/g, '')
      if (digits.length === 9) return { schemeID: '0192', value: digits }
    }
    const eas = VAT_EAS[prefix]
    if (eas) return { schemeID: eas, value: vat }
  }
  if (country === 'NO' && /^\d{9}$/.test(reg)) return { schemeID: '0192', value: reg }
  if (country === 'DK' && /^\d{8}$/.test(reg)) return { schemeID: '0184', value: reg }
  return null
}

/** Legal registration identifier scheme (BT-30 schemeID) where known. */
export function legalIdScheme(party: Party): string | undefined {
  const country = (party.address?.country || 'EE').toUpperCase()
  return country === 'EE' && /^\d{8}$/.test(clean(party.registryCode)) ? '0191' : undefined
}

/** Free-text unit → UN/ECE Recommendation 20 code. Unknown units become C62 ("one"). */
export function unitCode(unit: string | undefined): string {
  const u = (unit ?? '').trim().toLowerCase().replace(/\.$/, '')
  const map: Record<string, string> = {
    h: 'HUR', t: 'C62', tund: 'HUR', tundi: 'HUR', tunnid: 'HUR', hr: 'HUR', hrs: 'HUR', hour: 'HUR', hours: 'HUR',
    min: 'MIN', minut: 'MIN', minute: 'MIN', minutes: 'MIN',
    p: 'DAY', päev: 'DAY', päeva: 'DAY', päevad: 'DAY', day: 'DAY', days: 'DAY', d: 'DAY',
    öö: 'DAY', ööd: 'DAY', night: 'DAY', nights: 'DAY',
    näd: 'WEE', nädal: 'WEE', nädalat: 'WEE', week: 'WEE', weeks: 'WEE',
    kuu: 'MON', kuud: 'MON', month: 'MON', months: 'MON', mo: 'MON',
    a: 'ANN', aasta: 'ANN', aastat: 'ANN', year: 'ANN', years: 'ANN', yr: 'ANN',
    tk: 'H87', tükk: 'H87', tükki: 'H87', pcs: 'H87', pc: 'H87', piece: 'H87', pieces: 'H87', ea: 'H87',
    km: 'KMT', m: 'MTR', meeter: 'MTR', cm: 'CMT', mm: 'MMT',
    m2: 'MTK', 'm²': 'MTK', ruutmeeter: 'MTK', m3: 'MTQ', 'm³': 'MTQ', kuupmeeter: 'MTQ',
    kg: 'KGM', g: 'GRM', tonn: 'TNE', tonne: 'TNE',
    l: 'LTR', liiter: 'LTR', litre: 'LTR', liter: 'LTR', ml: 'MLT',
    kwh: 'KWH', mwh: 'MWH',
    kompl: 'SET', komplekt: 'SET', set: 'SET', sets: 'SET',
    pakk: 'XPK', pk: 'XPK', pack: 'XPK', package: 'XPK',
    leht: 'XST', lk: 'C62',
    teenus: 'C62', service: 'C62', tööd: 'C62',
  }
  return map[u] ?? 'C62'
}
