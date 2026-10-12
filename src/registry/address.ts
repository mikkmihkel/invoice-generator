// Mapping of e-Business Register address data to the shared `Address` model.
import type { Address } from '../domain/types'

export const STATUS_TEXT: Record<string, string> = {
  R: 'Registrisse kantud',
  L: 'Likvideerimisel',
  N: 'Pankrotis',
  K: 'Kustutatud',
}

const isCounty = (p: string) => /\bmaakond$/i.test(p)
const isDistrict = (p: string) => /\blinnaosa$/i.test(p)

function dedupe(parts: string[]): string[] {
  return parts.filter((p, i) => p && p !== parts[i - 1])
}

/**
 * City / settlement line from administrative units ordered small → large, county excluded.
 * "Tallinn" (districts dropped), "Tartu linn, Tartu linn" → "Tartu", "Linaküla, Kihnu vald" kept as is.
 */
export function cityFromUnits(units: string[]): string {
  const parts = dedupe(units.filter((p) => !isDistrict(p)))
  if (parts.length === 1) return parts[0].replace(/ linn$/i, '')
  return parts.join(', ')
}

function addressText(street: string, units: string[], postal: string, county: string | undefined): string {
  const tail = [postal, county].filter(Boolean).join(' ')
  return [street, ...dedupe(units), tail].filter(Boolean).join(', ')
}

/**
 * From the open-data columns: street (asukoht_ettevotja_aadressis), EHAK text
 * ("Kesklinna linnaosa, Tallinn, Harju maakond") and postal code.
 */
export function addressFromEhak(street: string, ehak: string, postal: string): { address: Address; addressText: string } {
  const parts = ehak.split(',').map((p) => p.trim()).filter(Boolean)
  const county = parts.find(isCounty)
  const units = parts.filter((p) => !isCounty(p))
  const address: Address = { street, city: cityFromUnits(units), postalCode: postal, country: 'EE' }
  if (county) address.county = county
  return { address, addressText: addressText(street, units, postal, county) }
}

const SETTLEMENT = /\b(linn|vald|küla|alevik|alev|linnaosa)$/i

/**
 * From an ADS normalised full address ("Harju maakond, Tallinn, Kristiine linnaosa, Mustamäe tee 3"),
 * as used by the register's autocomplete API and as a fallback in the open data.
 */
export function addressFromAds(full: string, postal: string, streetHint = ''): { address: Address; addressText: string } {
  const parts = full.split(',').map((p) => p.trim()).filter((p) => p && p !== postal)
  const county = parts.length && isCounty(parts[0]) ? parts[0] : undefined
  const rest = county ? parts.slice(1) : parts
  let street = streetHint
  let units = rest
  if (rest.length >= 2 || (rest.length === 1 && !SETTLEMENT.test(rest[0]))) {
    street = streetHint || rest[rest.length - 1]
    units = rest.slice(0, -1)
  }
  units = [...units].reverse()
  const address: Address = { street, city: cityFromUnits(units), postalCode: postal, country: 'EE' }
  if (county) address.county = county
  return { address, addressText: addressText(street, units, postal, county) }
}

/** Address of an open-data record. Without EHAK/ADS data the address is likely foreign: only text is returned. */
export function recordAddress(street: string, ehak: string, postal: string, ads: string): { address?: Address; addressText?: string } {
  if (ehak) return addressFromEhak(street, ehak, postal)
  if (ads) return addressFromAds(ads, postal, street)
  const text = [street, postal].filter(Boolean).join(', ')
  return text ? { addressText: text } : {}
}

const word = (alt: string, flags = '') => new RegExp(`(?:^|[\\s"'(])(?:${alt})(?=$|[\\s"',.)])`, flags)

const FORM_IN_NAME: Array<[RegExp, string]> = [
  [word('OÜ|osaühing', 'i'), 'OÜ'],
  [word('AS'), 'AS'],
  [word('aktsiaselts', 'i'), 'AS'],
  [word('MTÜ|mittetulundusühing', 'i'), 'MTÜ'],
  [word('SA'), 'SA'],
  [word('sihtasutus', 'i'), 'SA'],
  [word('KÜ|korteriühistu', 'i'), 'KÜ'],
  [word('TÜ|täisühing', 'i'), 'TÜ'],
  [word('UÜ|usaldusühing', 'i'), 'UÜ'],
  [word('FIE', 'i'), 'FIE'],
]

/** Legal form guessed from the company name (used for live API results, which only give a numeric code). */
export function legalFormFromName(name: string): string | undefined {
  for (const [re, form] of FORM_IN_NAME) if (re.test(name)) return form
  return undefined
}
