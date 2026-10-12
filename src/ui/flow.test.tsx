import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { newId, type Invoice } from '../domain'
import { createMemoryRepo, sampleProfile } from './testing/memoryRepo'

vi.mock('../registry', async () => (await import('./testing/mocks')).registryMock())
vi.mock('../pdf', async () => (await import('./testing/mocks')).pdfMock())
vi.mock('../integrations', async () => (await import('./testing/mocks')).integrationsMock())
vi.mock('../einvoice', async () => (await import('./testing/mocks')).einvoiceMock())
vi.mock('../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage')>()),
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

function issued(number: string, patch: Partial<Invoice> = {}): Invoice {
  return {
    id: newId(),
    number,
    type: 'invoice',
    status: 'issued',
    issueDate: '2026-01-05',
    dueDate: '2099-01-19',
    seller: { ...profile },
    buyer: { kind: 'company', name: 'Klient ' + number, address: profile.address },
    bankAccountIds: [],
    lines: [{ id: newId(), description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 100, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic',
    language: 'et',
    templateId: 'classic',
    accentColor: '#2457c5',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
    ...patch,
  }
}

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

describe('keyboard shortcuts', () => {
  it('"/" focuses the list search and "N" opens a new invoice, but not while typing', async () => {
    renderAt('#/', createMemoryRepo({ profile, invoices: [issued('2026-0001')] }))
    const search = await screen.findByRole('searchbox', { name: 'Otsi numbri või kliendi järgi' })
    fireEvent.keyDown(document.body, { key: '/' })
    expect(search).toHaveFocus()
    // Typing "n" into the search box must not navigate away.
    fireEvent.keyDown(search, { key: 'n' })
    expect(screen.getByRole('heading', { name: 'Arved', level: 1 })).toBeInTheDocument()
    search.blur()
    fireEvent.keyDown(document.body, { key: 'n' })
    expect(await screen.findByRole('heading', { name: 'Uus arve', level: 1 })).toBeInTheDocument()
  })
})

describe('invoice list filters', () => {
  it('filters by status with the segmented control and shows relative due dates', async () => {
    const paid = issued('2026-0001', { status: 'paid', paidAt: '2026-01-10' })
    const overdue = issued('2026-0002', { dueDate: '2026-01-19' })
    renderAt('#/', createMemoryRepo({ profile, invoices: [paid, overdue] }))
    const row = (await screen.findByText('2026-0002')).closest('tr')!
    expect(within(row).getByText(/päeva üle$/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /^Tasutud/ }))
    expect(screen.queryByText('2026-0002')).not.toBeInTheDocument()
    expect(screen.getByText('2026-0001')).toBeInTheDocument()
    expect(screen.getByText('Tasutud 10.01.2026')).toBeInTheDocument()
  })
})

describe('lines editor', () => {
  it('adds a line on Enter in the last line and moves focus to its description', async () => {
    renderAt('#/invoices/new', createMemoryRepo({ profile }))
    const price = await screen.findByLabelText('Ühikuhind')
    fireEvent.keyDown(price, { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByLabelText('Ühikuhind')).toHaveLength(2))
    await waitFor(() => expect(screen.getByLabelText('Kirjeldus 2')).toHaveFocus())
  })
})

describe('buyer picker', () => {
  it('finds a company in the register, saves it as a client and sets it as the buyer', async () => {
    const repo = createMemoryRepo({ profile })
    renderAt('#/invoices/new', repo)
    fireEvent.change(await screen.findByLabelText('Klient'), { target: { value: 'päikese' } })
    const option = await screen.findByRole('option', { name: /Päikese Tarkvara OÜ/ })
    await act(async () => {
      fireEvent.click(option)
    })
    await waitFor(() => expect(repo.saveClient).toHaveBeenCalledWith(expect.objectContaining({ name: 'Päikese Tarkvara OÜ', registryCode: '16543210' })))
    const step = screen.getByRole('region', { name: 'Ostja' })
    // The fixture's registry code fails the checksum, so the buyer fields open for correcting it.
    expect(await within(step).findByLabelText(/^Nimi/)).toHaveValue('Päikese Tarkvara OÜ')
    expect(within(step).getByLabelText(/^Registrikood/)).toHaveValue('16543210')
    expect(within(step).getByRole('button', { name: 'Vaheta klienti' })).toBeInTheDocument()
  })
})
