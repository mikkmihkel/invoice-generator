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

function draft(type: Invoice['type'], registryCode?: string): Invoice {
  const client = newClient({ name: 'Ostja AS', registryCode, address: { street: 'Rüütli 1', city: 'Pärnu', postalCode: '80010', country: 'EE' } })
  const inv = createEmptyInvoice(profile, client)
  return { ...inv, type, lines: [{ ...inv.lines[0], description: 'Arendus', unitPrice: 100 }] }
}

async function openIssueDialog(inv: Invoice, title: string) {
  window.location.hash = `#/invoices/${inv.id}`
  render(<App repository={createMemoryRepo({ profile, invoices: [inv] })} />)
  const issue = await screen.findByRole('button', { name: title })
  await waitFor(() => expect(issue).toBeEnabled())
  fireEvent.click(issue)
  return screen.findByRole('dialog', { name: title })
}

describe('issue confirmation', () => {
  it('lists the warnings with their legal basis instead of only counting them', async () => {
    const dialog = await openIssueDialog(draft('invoice'), 'Väljasta arve')
    expect(within(dialog).getByText('Hoiatusi arvel: 1. Vaata need enne väljastamist üle.')).toBeInTheDocument()
    const items = within(dialog).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Ostja registrikood puudub')
    expect(within(items[0]).getByText('RPS § 7')).toBeInTheDocument()
  })

  it('shows no warning box when there is nothing to review', async () => {
    const dialog = await openIssueDialog(draft('invoice', '10000001'), 'Väljasta arve')
    expect(within(dialog).queryByText(/Hoiatusi arvel/)).not.toBeInTheDocument()
  })

  it('lists them for quotes too', async () => {
    const dialog = await openIssueDialog(draft('quote'), 'Väljasta hinnapakkumine')
    expect(within(dialog).getByText(/Hoiatusi pakkumisel: 1/)).toBeInTheDocument()
    expect(within(dialog).getByRole('listitem')).toHaveTextContent('Hinnapakkumise kehtivusaeg puudub.')
  })
})
