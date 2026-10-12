// OWNER: registry agent. Estonian e-Business Register (Äriregister) lookup.
import type { RegistryCompany } from '../domain/types'

export interface RegistrySearchOptions {
  /** Max results, default 10. */
  limit?: number
  /** Also query the live RIK autocomplete API (may fail due to CORS — must degrade silently). */
  live?: boolean
  signal?: AbortSignal
}

/** Search by name fragment or registry code. Uses the bundled static index (public/registry/*) built from RIK open data. */
export async function searchCompanies(_query: string, _opts?: RegistrySearchOptions): Promise<RegistryCompany[]> {
  throw new Error('not implemented')
}

/** Exact lookup by 8-digit registry code. */
export async function getCompanyByCode(_registryCode: string, _opts?: RegistrySearchOptions): Promise<RegistryCompany | null> {
  throw new Error('not implemented')
}

/** Metadata about the bundled index (build date, record count) or null if not available. */
export async function getIndexInfo(): Promise<{ builtAt: string; count: number; source: string } | null> {
  throw new Error('not implemented')
}
