import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createDefaultSettings, createEmptyInvoice, type Invoice } from '../domain'
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

function draft(type: Invoice['type'], registryCode?: string, unitPrice = 100): Invoice {
  const client = newClient({ name: 'Ostja AS', registryCode, address: { street: 'Rüütli 1', city: 'Pärnu', postalCode: '80010', country: 'EE' } })
  const inv = createEmptyInvoice(profile, client)
  return { ...inv, type, lines: [{ ...inv.lines[0], description: 'Arendus', unitPrice }] }
}

async function openIssueDialog(inv: Invoice, title: string, uiLanguage: 'et' | 'en' = 'et') {
  window.location.hash = `#/invoices/${inv.id}`
  render(<App repository={createMemoryRepo({ profile, invoices: [inv], settings: { ...createDefaultSettings(), uiLanguage } })} />)
  const issue = await screen.findByRole('button', { name: title })
  await waitFor(() => expect(issue).toBeEnabled())
  fireEvent.click(issue)
  return screen.findByRole('dialog', { name: title })
}

describe('issue confirmation', () => {
  it('lists the warnings with their legal basis instead of only counting them', async () => {
    const dialog = await openIssueDialog(draft('invoice'), 'Väljasta arve')
    expect(within(dialog).getByText('Arvel on üks hoiatus. Vaata see enne väljastamist üle.')).toBeInTheDocument()
    const items = within(dialog).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Ostja registrikood puudub')
    expect(within(items[0]).getByText('RPS § 7')).toBeInTheDocument()
  })

  it('shows no warning box when there is nothing to review', async () => {
    const dialog = await openIssueDialog(draft('invoice', '10000001'), 'Väljasta arve')
    expect(within(dialog).queryByText(/hoiatus/)).not.toBeInTheDocument()
  })

  it('lists them for quotes too', async () => {
    const dialog = await openIssueDialog(draft('quote'), 'Väljasta hinnapakkumine')
    expect(within(dialog).getByText('Hinnapakkumisel on üks hoiatus. Vaata see enne väljastamist üle.')).toBeInTheDocument()
    expect(within(dialog).getByRole('listitem')).toHaveTextContent('Hinnapakkumise kehtivusaeg puudub.')
  })

  it('counts several warnings with a proper plural, in English too', async () => {
    const dialog = await openIssueDialog(draft('invoice', undefined, 0), 'Väljasta arve')
    expect(within(dialog).getByText('Arvel on 2 hoiatust. Vaata need enne väljastamist üle.')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2)
    cleanup()
    const en = await openIssueDialog(draft('invoice', undefined, 0), 'Issue invoice', 'en')
    expect(within(en).getByText('The invoice has 2 warnings. Review them before issuing.')).toBeInTheDocument()
    cleanup()
    const one = await openIssueDialog(draft('invoice'), 'Issue invoice', 'en')
    expect(within(one).getByText('The invoice has one warning. Review it before issuing.')).toBeInTheDocument()
  })
})
