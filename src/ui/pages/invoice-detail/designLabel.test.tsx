import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../../App'
import { createDefaultSettings, newId, type Invoice } from '../../../domain'
import { createMemoryRepo, sampleProfile } from '../../testing/memoryRepo'

vi.mock('../../../registry', async () => (await import('../../testing/mocks')).registryMock())
vi.mock('../../../pdf', async () => (await import('../../testing/mocks')).pdfMock())
vi.mock('../../../integrations', async () => (await import('../../testing/mocks')).integrationsMock())
vi.mock('../../../einvoice', async () => (await import('../../testing/mocks')).einvoiceMock())
vi.mock('../../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../storage')>()),
  getRepository: () => {
    throw new Error('tests pass a repository explicitly')
  },
  subscribe: () => () => undefined,
}))

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const profile = sampleProfile()

function issued(language: Invoice['language']): Invoice {
  return {
    id: newId(),
    number: '2026-0004',
    type: 'invoice',
    status: 'issued',
    issueDate: '2026-10-01',
    dueDate: '2099-10-15',
    seller: { ...profile },
    buyer: { kind: 'company', name: 'Kalda Puutöö OÜ', address: { street: 'Pärnu mnt 140', city: 'Tallinn', postalCode: '11317', country: 'EE' } },
    bankAccountIds: [],
    lines: [{ id: newId(), description: 'Arendus', quantity: 1, unit: 'tk', unitPrice: 100, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic',
    language,
    templateId: 'classic',
    accentColor: '#2457c5',
    issuedAt: '2026-10-01T09:00:00Z',
    createdAt: '2026-10-01T09:00:00Z',
    updatedAt: '2026-10-01T09:00:00Z',
  }
}

async function designValue(uiLanguage: 'et' | 'en', language: Invoice['language'], label: string) {
  window.location.hash = '#/'
  render(<App repository={createMemoryRepo({ profile, invoices: [issued(language)], settings: { ...createDefaultSettings(), uiLanguage } })} />)
  const term = await screen.findByText(label, { selector: 'dt' })
  return within(term.parentElement!).getByRole('definition')
}

describe('invoice detail: design and language', () => {
  it('keeps the language name capitalised in English', async () => {
    expect(await designValue('en', 'et', 'Design')).toHaveTextContent(/^Classic, Estonian$/)
  })

  it('writes it in lower case inside the Estonian sentence-style value', async () => {
    expect(await designValue('et', 'en', 'Kujundus')).toHaveTextContent(/^Klassikaline, inglise keel$/)
  })
})
