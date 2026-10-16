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

function validDraft(patch: Partial<Invoice> = {}): Invoice {
  const inv = createEmptyInvoice(profile, client)
  return { ...inv, lines: [{ ...inv.lines[0], description: 'Arendus', unitPrice: 100 }], ...patch }
}

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

const ctrlEnter = (target: Element = document.body) => fireEvent.keyDown(target, { key: 'Enter', ctrlKey: true })

describe('focus on a new invoice', () => {
  it('starts in the client search without opening its list', async () => {
    renderAt('#/invoices/new', createMemoryRepo({ profile, clients: [client] }))
    const search = await screen.findByRole('combobox', { name: 'Klient' })
    await waitFor(() => expect(search).toHaveFocus())
    expect(search).toHaveAttribute('aria-expanded', 'false')
    // The list still opens as soon as the user asks for it.
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not move focus when an existing draft is opened', async () => {
    const draft = { ...createEmptyInvoice(profile) }
    renderAt(`#/invoices/${draft.id}`, createMemoryRepo({ profile, clients: [client], invoices: [draft] }))
    const search = await screen.findByRole('combobox', { name: 'Klient' })
    expect(search).not.toHaveFocus()
  })
})

describe('Ctrl/⌘+Enter in the editor', () => {
  it('opens the issue dialog, also from inside a field', async () => {
    const draft = validDraft()
    renderAt(`#/invoices/${draft.id}`, createMemoryRepo({ profile, clients: [client], invoices: [draft] }))
    const description = await screen.findByLabelText('Kirjeldus 1')
    expect(screen.getByRole('button', { name: 'Väljasta arve' })).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter')
    fireEvent.keyDown(description, { key: 'Enter', metaKey: true })
    expect(await screen.findByRole('dialog', { name: 'Väljasta arve' })).toBeInTheDocument()
  })

  it('with missing details opens the checklist and moves focus to it instead', async () => {
    const draft = validDraft({ lines: [{ ...createEmptyInvoice(profile).lines[0] }] })
    renderAt(`#/invoices/${draft.id}`, createMemoryRepo({ profile, clients: [client], invoices: [draft] }))
    await screen.findByLabelText('Kirjeldus 1')
    ctrlEnter()
    const toggle = screen.getByRole('button', { name: /Vigu enne väljastamist/ })
    await waitFor(() => expect(toggle).toHaveFocus())
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does nothing on an issued invoice', async () => {
    const issued = validDraft({ number: '2026-0001', status: 'issued', issuedAt: new Date().toISOString() })
    renderAt(`#/invoices/${issued.id}`, createMemoryRepo({ profile, clients: [client], invoices: [issued] }))
    await screen.findByRole('heading', { level: 1, name: /Arve 2026-0001/ })
    ctrlEnter()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('shortcut sheet', () => {
  it('opens with "?", lists the shortcuts and closes with Escape', async () => {
    renderAt('#/', createMemoryRepo({ profile, invoices: [validDraft()] }))
    await screen.findByRole('link', { name: /Uus arve/ })
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true })
    const sheet = await screen.findByRole('dialog', { name: 'Kiirklahvid' })
    expect(within(sheet).getByText('Uus arve')).toBeInTheDocument()
    expect(within(sheet).getByText('Väljasta või näita, mis on puudu')).toBeInTheDocument()
    expect(within(sheet).getAllByText('Enter').length).toBeGreaterThan(1)
    expect(within(sheet).getByText('Ctrl')).toBeInTheDocument()
    fireEvent.keyDown(sheet, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Kiirklahvid' })).not.toBeInTheDocument())
  })

  it('does not open while typing in a field', async () => {
    renderAt('#/', createMemoryRepo({ profile, invoices: [validDraft()] }))
    const search = await screen.findByRole('searchbox')
    search.focus()
    fireEvent.keyDown(search, { key: '?', shiftKey: true })
    expect(screen.queryByRole('dialog', { name: 'Kiirklahvid' })).not.toBeInTheDocument()
  })
})
