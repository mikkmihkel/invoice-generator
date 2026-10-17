import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

const writeText = vi.fn(async (_text: string) => undefined)

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

beforeEach(() => writeText.mockClear())

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

function invoice(patch: Partial<Invoice> = {}): Invoice {
  const inv = createEmptyInvoice(profile, client)
  return { ...inv, dueDate: '2026-10-30', lines: [{ ...inv.lines[0], description: 'Arendus', unitPrice: 100 }], ...patch }
}

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

// Role queries over the whole screen (list, detail or editor) are slow in jsdom and, when several suites share the
// CPUs, can take most of the test's time limit. Find the part of the screen by its text, then query inside it.
const detail = async (number: string) => within((await screen.findByText(`Arve ${number}`, { selector: 'h2' })).closest('article')!)
const openMenu = (scope: ReturnType<typeof within>) => {
  fireEvent.click(scope.getByRole('button', { name: 'Rohkem' }))
  return within(screen.getByRole('menu'))
}

describe('copy payment details', () => {
  it('copies amount, IBAN, reference number, due date and number from the detail menu', async () => {
    const inv = invoice({ number: '2026-0012', status: 'issued', issuedAt: new Date().toISOString(), referenceNumber: '202600127' })
    renderAt(`#/?id=${inv.id}`, createMemoryRepo({ profile, clients: [client], invoices: [inv] }))
    fireEvent.click(openMenu(await detail('2026-0012')).getByRole('menuitem', { name: 'Kopeeri makseandmed' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = writeText.mock.calls[0][0]
    expect(text).toContain('Arve: 2026-0012')
    expect(text).toContain('Summa: 124,00 €')
    expect(text).toContain('Saaja: Näidis OÜ')
    expect(text).toContain('IBAN: EE38 2200 2210 2014 5685 (Swedbank)')
    expect(text).toContain('Viitenumber: 202600127')
    expect(text).toContain('Maksetähtaeg: 30.10.2026')
    expect(await screen.findByText('Makseandmed on kopeeritud. Kleebi need sõnumisse.')).toBeInTheDocument()
  })

  it('is not offered for a paid invoice', async () => {
    const inv = invoice({ number: '2026-0012', status: 'paid', issuedAt: new Date().toISOString(), paidAt: '2026-10-10' })
    renderAt(`#/?id=${inv.id}`, createMemoryRepo({ profile, clients: [client], invoices: [inv] }))
    const menu = openMenu(await detail('2026-0012'))
    expect(menu.getByRole('menuitem', { name: 'Tee koopia' })).toBeInTheDocument()
    expect(menu.queryByRole('menuitem', { name: 'Kopeeri makseandmed' })).not.toBeInTheDocument()
  })

  it('is offered right after issuing, in the English of an English invoice', async () => {
    const draft = invoice({ language: 'en' })
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [draft] })
    renderAt(`#/invoices/${draft.id}`, repo)
    const issue = (await screen.findAllByText('Väljasta arve', { selector: 'button, button *' }))[0].closest('button')!
    await waitFor(() => expect(issue).toBeEnabled())
    fireEvent.click(issue)
    const dialog = within(await screen.findByRole('dialog'))
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: 'Väljasta' }))
    })
    const copy = (await screen.findByText('Kopeeri makseandmed', { selector: 'button, button *' })).closest('button')!
    fireEvent.click(copy)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = writeText.mock.calls[0][0]
    expect(text).toMatch(/^Invoice: 2026-0001$/m)
    expect(text).toMatch(/^Amount: €124\.00$/m)
    expect(text).toMatch(/^Due date: 30 Oct 2026$/m)
  })
})
