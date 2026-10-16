import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { Client, Invoice } from '../domain'
import { createMemoryRepo, sampleProfile } from './testing/memoryRepo'
import { addDaysISO, localTodayISO, newClient } from './util'

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

function regular(patch: Partial<Client> = {}): Client {
  return newClient({
    name: 'Ostja AS',
    registryCode: '10000001',
    address: { street: 'Rüütli 1', city: 'Pärnu', postalCode: '80010', country: 'EE' },
    email: 'arved@ostja.ee',
    paymentTermDays: 30,
    lateInterestPercentPerDay: 0.1,
    emailCc: 'raamatupidaja@ostja.ee',
    notes: 'Arved saata ainult Marile.',
    ...patch,
  })
}

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

async function pickClient(name: RegExp) {
  fireEvent.change(await screen.findByLabelText('Klient'), { target: { value: 'ostja' } })
  fireEvent.click(await screen.findByRole('option', { name }))
}

describe('per-client defaults in the editor', () => {
  it('apply the client card term and late interest, and show its note without printing it', async () => {
    const client = regular()
    const repo = createMemoryRepo({ profile, clients: [client] })
    renderAt('#/invoices/new', repo)
    await pickClient(/Ostja AS/)

    const today = localTodayISO()
    await waitFor(() => expect(screen.getByLabelText('Maksetähtaeg *')).toHaveValue(addDaysISO(today, 30)))
    expect(screen.getByText('Kliendikaardil määratud maksetingimus.')).toBeInTheDocument()
    const note = screen.getByRole('note', { name: 'Kliendi märkmed, arvele ei trükita' })
    expect(within(note).getByText('Arved saata ainult Marile.')).toBeInTheDocument()

    await waitFor(() => expect(repo.saveInvoice).toHaveBeenCalled(), { timeout: 3000 })
    const saved: Invoice = repo.saveInvoice.mock.calls.at(-1)![0]
    expect(saved.lateInterestPercentPerDay).toBe(0.1)
    expect(saved.dueDate).toBe(addDaysISO(today, 30))
    // The note stays on the client card: nothing of it is copied into the invoice.
    expect(JSON.stringify(saved)).not.toContain('Marile')
  })

  it('keep a payment term the user already changed in this draft', async () => {
    const repo = createMemoryRepo({ profile, clients: [regular()] })
    renderAt('#/invoices/new', repo)
    fireEvent.click(await screen.findByRole('button', { name: '7 päeva' }))
    await pickClient(/Ostja AS/)
    await screen.findByRole('note')
    expect(screen.getByLabelText('Maksetähtaeg *')).toHaveValue(addDaysISO(localTodayISO(), 7))
  })

  it('apply when a new invoice is started for the client from the client list', async () => {
    const client = regular()
    renderAt(`#/invoices/new?client=${client.id}`, createMemoryRepo({ profile, clients: [client] }))
    await waitFor(() => expect(screen.getByLabelText('Maksetähtaeg *')).toHaveValue(addDaysISO(localTodayISO(), 30)))
  })

  // The e-mail dialog is owned by another workstream: it prefills its CC field with clientEmailCc() once wired.
})

describe('client card', () => {
  it('saves the per-client defaults, and an empty field falls back to the company default', async () => {
    const client = regular({ paymentTermDays: undefined, lateInterestPercentPerDay: undefined, emailCc: undefined, notes: undefined })
    const repo = createMemoryRepo({ profile, clients: [client] })
    renderAt('#/clients', repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Muuda klienti Ostja AS' }))
    const dialog = await screen.findByRole('dialog')
    const term = within(dialog).getByLabelText('Selle kliendi maksetingimus')
    expect(term).toHaveAttribute('placeholder', '14')
    fireEvent.change(term, { target: { value: '30' } })
    fireEvent.change(within(dialog).getByLabelText('Selle kliendi viivis'), { target: { value: '0,05' } })
    fireEvent.change(within(dialog).getByLabelText('E-kirja koopia saajad (CC)'), { target: { value: 'raamatupidaja@ostja.ee' } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Salvesta' }))
    })
    await waitFor(() => expect(repo.saveClient).toHaveBeenCalled())
    expect(repo.saveClient.mock.calls.at(-1)![0]).toMatchObject({ paymentTermDays: 30, lateInterestPercentPerDay: 0.05, emailCc: 'raamatupidaja@ostja.ee' })
  })

  it('does not save an invalid CC address', async () => {
    const client = regular()
    const repo = createMemoryRepo({ profile, clients: [client] })
    renderAt('#/clients', repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Muuda klienti Ostja AS' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('E-kirja koopia saajad (CC)'), { target: { value: 'pole-aadress' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvesta' }))
    expect(await within(dialog).findByText(/pole-aadress/, { selector: '.field-error' })).toBeInTheDocument()
    expect(repo.saveClient).not.toHaveBeenCalled()
  })
})
