import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createEmptyInvoice, type Invoice } from '../domain'
import { createMemoryRepo, sampleProfile } from './testing/memoryRepo'
import { newClient } from './util'

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
const client = newClient({
  name: 'Ostja AS',
  registryCode: '10000001',
  address: { street: 'Rüütli 1', city: 'Pärnu', postalCode: '80010', country: 'EE' },
})

function issued(patch: Partial<Invoice>): Invoice {
  const inv = createEmptyInvoice(profile, client)
  return {
    ...inv,
    status: 'issued',
    issuedAt: new Date().toISOString(),
    lines: [
      { ...inv.lines[0], id: 'l1', description: 'Raamatupidamisteenus', unit: 'kuu', unitPrice: 300 },
      { ...inv.lines[0], id: 'l2', description: 'Lisatöö', quantity: 3, unit: 'h', unitPrice: 40 },
    ],
    ...patch,
  }
}

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

async function pickClient() {
  fireEvent.change(await screen.findByLabelText('Klient'), { target: { value: 'ostja' } })
  fireEvent.click(await screen.findByRole('option', { name: /Ostja AS/ }))
}

describe('repeat for a client', () => {
  it('offers the lines of the client’s latest invoice in a blank draft, copies them in one click and undoes', async () => {
    const older = issued({ number: '2026-0011', issueDate: '2026-08-31' })
    const latest = issued({ number: '2026-0012', issueDate: '2026-09-30', status: 'paid', paidAt: '2026-10-05' })
    renderAt('#/invoices/new', createMemoryRepo({ profile, clients: [client], invoices: [older, latest] }))
    // No buyer yet: nothing to offer.
    await screen.findByLabelText('Klient')
    expect(screen.queryByRole('button', { name: /Kopeeri read/ })).not.toBeInTheDocument()

    await pickClient()
    const offer = await screen.findByRole('button', { name: /^Kopeeri read arvelt 2026-0012 \(september( 2026)?\)$/ })
    expect(screen.getByText(/^2 rida, 520,80\s€$/)).toBeInTheDocument()
    fireEvent.click(offer)

    expect(screen.getByLabelText('Kirjeldus 1')).toHaveValue('Raamatupidamisteenus')
    expect(screen.getByLabelText('Kirjeldus 2')).toHaveValue('Lisatöö')
    await waitFor(() => expect(screen.getByTestId('total-gross')).toHaveTextContent('520,80'))
    expect(screen.queryByRole('button', { name: /Kopeeri read/ })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByLabelText('Kogus')[0]).toHaveFocus())

    fireEvent.click(await screen.findByRole('button', { name: 'Võta tagasi' }))
    await waitFor(() => expect(screen.getByLabelText('Kirjeldus 1')).toHaveValue(''))
    expect(screen.queryByLabelText('Kirjeldus 2')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Kopeeri read arvelt 2026-0012/ })).toBeInTheDocument()
  })

  it('is not offered once the user has typed a line, or for a client without issued invoices', async () => {
    const draftOnly = { ...issued({}), status: 'draft' as const, number: '' }
    renderAt('#/invoices/new', createMemoryRepo({ profile, clients: [client], invoices: [draftOnly] }))
    await pickClient()
    await screen.findByText('Rüütli 1, 80010 Pärnu', { exact: false })
    expect(screen.queryByRole('button', { name: /Kopeeri read/ })).not.toBeInTheDocument()
  })

  it('hides the offer when the user starts typing a line', async () => {
    renderAt('#/invoices/new', createMemoryRepo({ profile, clients: [client], invoices: [issued({ number: '2026-0012' })] }))
    await pickClient()
    await screen.findByRole('button', { name: /Kopeeri read/ })
    fireEvent.change(screen.getByLabelText('Kirjeldus 1'), { target: { value: 'Midagi muud' } })
    expect(screen.queryByRole('button', { name: /Kopeeri read/ })).not.toBeInTheDocument()
  })

  it('starts a new invoice for the client from the detail menu', async () => {
    const inv = issued({ number: '2026-0012' })
    renderAt(`#/?id=${inv.id}`, createMemoryRepo({ profile, clients: [client], invoices: [inv] }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rohkem' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Uus arve sellele kliendile' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Uus arve' })).toBeInTheDocument()
    const buyer = document.getElementById('sec-buyer')!
    expect(within(buyer).getByText('Ostja AS')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Kopeeri read arvelt 2026-0012/ })).toBeInTheDocument()
  })

  it('offers no new invoice for a buyer that is not a saved client', async () => {
    const inv = issued({ number: '2026-0012', buyer: { kind: 'person', name: 'Mari Maasikas', address: { street: '', city: '', postalCode: '', country: 'EE' } } })
    renderAt(`#/?id=${inv.id}`, createMemoryRepo({ profile, clients: [client], invoices: [inv] }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rohkem' }))
    expect(await screen.findByRole('menuitem', { name: 'Tee koopia' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Uus arve sellele kliendile' })).not.toBeInTheDocument()
  })
})
