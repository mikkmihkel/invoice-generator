import { vi } from 'vitest'
import type { RegistryCompany } from '../../domain'

// Factories for vi.mock of the modules the UI depends on (other agents' areas).

export const REGISTRY_FIXTURE: RegistryCompany[] = [
  {
    registryCode: '16543210',
    name: 'Päikese Tarkvara OÜ',
    vatNumber: 'EE102345676',
    legalForm: 'OÜ',
    status: 'Registrisse kantud',
    address: { street: 'Tartu mnt 10', city: 'Tallinn', postalCode: '10115', country: 'EE' },
  },
  { registryCode: '12000001', name: 'Päikesekiir AS', status: 'Registrisse kantud', addressText: 'Rüütli 1, Pärnu' },
  { registryCode: '12000002', name: 'Vana Firma OÜ', status: 'Likvideerimisel', addressText: 'Pikk 2, Tartu' },
]

export function registryMock() {
  return {
    searchCompanies: vi.fn(async (q: string) => REGISTRY_FIXTURE.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.registryCode.startsWith(q))),
    getCompanyByCode: vi.fn(async (code: string) => REGISTRY_FIXTURE.find((c) => c.registryCode === code) ?? null),
    getIndexInfo: vi.fn(async () => null),
    REGISTRY_ATTRIBUTION: { et: 'Andmed: e-äriregister', en: 'Data: e-Business Register', sourceUrl: 'https://example.test/', licenceUrl: 'https://example.test/l' },
  }
}

export function pdfMock() {
  return {
    TEMPLATES: [],
    renderInvoicePdf: vi.fn(async () => new Blob(['%PDF-1.7'], { type: 'application/pdf' })),
    renderInvoicePdfBase64: vi.fn(async () => 'JVBERi0xLjc='),
    preloadPdfMake: vi.fn(),
    invoiceFileName: vi.fn((inv: { number: string }, ext = 'pdf') => `Arve_${inv.number || 'mustand'}.${ext}`),
  }
}

export function integrationsMock() {
  return {
    getGoogleStatus: vi.fn(() => ({ configured: false, signedIn: false })),
    googleSignIn: vi.fn(async () => ({ configured: true, signedIn: true })),
    googleSignOut: vi.fn(async () => undefined),
    uploadToDrive: vi.fn(async () => ({ id: 'f1', webViewLink: 'https://drive.test/f1' })),
    sendViaGmail: vi.fn(async () => ({ id: 'm1' })),
    canShareFiles: vi.fn(() => false),
    shareFiles: vi.fn(async () => true),
    buildMailtoUrl: vi.fn(() => 'mailto:test@example.com'),
    downloadBlob: vi.fn(),
    backupToDrive: vi.fn(async () => ({ id: 'b1', modifiedTime: new Date().toISOString() })),
    restoreFromDrive: vi.fn(async () => null),
  }
}

export function einvoiceMock() {
  return { buildUblXml: vi.fn(() => '<Invoice/>'), eInvoiceIssues: vi.fn(() => []) }
}
