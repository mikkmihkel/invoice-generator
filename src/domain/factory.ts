import type { AppSettings, Client, CompanyProfile, Invoice } from './types'

export function newId(): string {
  throw new Error('not implemented')
}
export function todayISO(): string {
  throw new Error('not implemented')
}
export function addDays(_date: string, _days: number): string {
  throw new Error('not implemented')
}
export function createDefaultProfile(): CompanyProfile {
  throw new Error('not implemented')
}
export function createDefaultSettings(): AppSettings {
  throw new Error('not implemented')
}
/** New draft invoice pre-filled from the profile defaults (and client overrides, if given). Number is ''. */
export function createEmptyInvoice(_profile: CompanyProfile, _client?: Client): Invoice {
  throw new Error('not implemented')
}
