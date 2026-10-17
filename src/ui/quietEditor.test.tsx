import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createEmptyInvoice } from '../domain'
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

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

const appearance = () => document.getElementById('sec-appearance')!

describe('appearance on a new invoice', () => {
  it('is one summary line while it follows the company defaults, and opens on "Muuda"', async () => {
    renderAt('#/invoices/new', createMemoryRepo({ profile, clients: [client] }))
    const change = await screen.findByRole('button', { name: 'Muuda kujundust' })
    expect(change).toHaveAttribute('aria-expanded', 'false')
    expect(appearance()).toHaveTextContent(/standard\W+eesti keel\W+ühevärviline/i)
    expect(within(appearance()).queryByRole('radio')).not.toBeInTheDocument()

    fireEvent.click(change)
    const language = await within(appearance()).findByLabelText('Arve keel')
    await waitFor(() => expect(language).toHaveFocus())
    expect(within(appearance()).getAllByRole('radio').length).toBeGreaterThan(1)
    // It stays open even though nothing has changed yet.
    fireEvent.change(language, { target: { value: 'et' } })
    expect(within(appearance()).getByLabelText('Arve keel')).toBeInTheDocument()
  })

  it('is shown in full when the draft differs from the defaults', async () => {
    const draft = { ...createEmptyInvoice(profile, client), templateId: 'bold' as const }
    renderAt(`#/invoices/${draft.id}`, createMemoryRepo({ profile, clients: [client], invoices: [draft] }))
    expect(await screen.findByLabelText('Arve keel')).toBeInTheDocument()
    expect(appearance()).toContainElement(screen.getByLabelText('Arve keel'))
    expect(screen.queryByRole('button', { name: 'Muuda kujundust' })).not.toBeInTheDocument()
  })

  it('stays a summary when the client’s own invoice language is applied', async () => {
    const english = newClient({ ...client, id: 'en-client', name: 'Buyer Ltd', registryCode: undefined, defaultLanguage: 'en' })
    renderAt(`#/invoices/new?client=${english.id}`, createMemoryRepo({ profile, clients: [english] }))
    await screen.findByRole('button', { name: 'Muuda kujundust' })
    expect(appearance()).toHaveTextContent(/standard\W+inglise keel\W+ühevärviline/i)
  })
})

describe('checklist on a blank draft', () => {
  const toggle = () => screen.getByRole('button', { name: /^Vigu enne väljastamist: \d+$/ })

  it('stays folded to its count, in a neutral tone, until a buyer is picked', async () => {
    renderAt('#/invoices/new', createMemoryRepo({ profile, clients: [client] }))
    await screen.findByRole('heading', { name: 'Nõuete kontroll' })
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).not.toHaveClass('check-has-errors')
    fireEvent.change(screen.getByLabelText('Klient'), { target: { value: 'ostja' } })
    fireEvent.click(await screen.findByRole('option', { name: /Ostja AS/ }))
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'true'))
    expect(toggle()).toHaveClass('check-has-errors')
  })

  it('opens when a line is added or filled in', async () => {
    renderAt('#/invoices/new', createMemoryRepo({ profile, clients: [client] }))
    await screen.findByRole('heading', { name: 'Nõuete kontroll' })
    fireEvent.click(screen.getByRole('button', { name: 'Lisa rida' }))
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'true'))
  })

  it('opens and takes focus when Issue is pressed', async () => {
    renderAt('#/invoices/new', createMemoryRepo({ profile, clients: [client] }))
    const issue = await screen.findByRole('button', { name: 'Väljasta arve' })
    expect(issue).toHaveAttribute('aria-disabled', 'true')
    expect(issue).toBeEnabled()
    fireEvent.click(issue)
    await waitFor(() => expect(toggle()).toHaveFocus())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
