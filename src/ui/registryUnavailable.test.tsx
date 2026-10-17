import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import * as registry from '../registry'
import { createMemoryRepo, sampleProfile } from './testing/memoryRepo'
import { REGISTRY_FIXTURE } from './testing/mocks'

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

const search = vi.mocked(registry.searchCompanies)
const matches = (q: string) => REGISTRY_FIXTURE.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))

/** The live pass cannot reach the register (offline, blocked); the bundled index still answers. */
function liveOffline() {
  search.mockImplementation(async (q, opts) => {
    if (opts?.live) opts.onUnavailable?.('live')
    return matches(q)
  })
}

beforeEach(() => {
  search.mockReset()
  search.mockImplementation(async (q) => matches(q))
})

const UNAVAILABLE = 'Äriregistrist ei saanud praegu otsida. Kontrolli internetiühendust ja proovi uuesti või sisesta andmed käsitsi.'
const NO_RESULTS = 'Ühtegi ettevõtet ei leitud. Kontrolli nime või sisesta andmed käsitsi.'

async function openRegisterSearch() {
  window.location.hash = '#/clients'
  render(<App repository={createMemoryRepo({ profile: sampleProfile() })} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Lisa äriregistrist' }))
  return within(await screen.findByRole('dialog')).getByRole('combobox', { name: 'Otsi äriregistrist' })
}

describe('register search that cannot reach the register', () => {
  it('says "no companies found" only when every source answered', async () => {
    const input = await openRegisterSearch()
    fireEvent.change(input, { target: { value: 'olematu' } })
    expect(await screen.findByText(NO_RESULTS)).toBeInTheDocument()
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Proovi uuesti' })).not.toBeInTheDocument()
  })

  it('says the search failed instead of "not found" and offers to try again', async () => {
    liveOffline()
    const input = await openRegisterSearch()
    fireEvent.change(input, { target: { value: 'olematu' } })
    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument()
    expect(screen.queryByText(NO_RESULTS)).not.toBeInTheDocument()

    // The connection is back: retrying runs the same query again and finds the company.
    search.mockImplementation(async () => [REGISTRY_FIXTURE[0]])
    const calls = search.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Proovi uuesti' }))
    await waitFor(() => expect(search.mock.calls.length).toBeGreaterThan(calls))
    expect(search.mock.calls.at(-1)?.[0]).toBe('olematu')
    expect(await screen.findByRole('option', { name: /Päikese Tarkvara OÜ/ })).toBeInTheDocument()
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument()
  })

  it('keeps the results it found but says the list may be incomplete', async () => {
    liveOffline()
    const input = await openRegisterSearch()
    fireEvent.change(input, { target: { value: 'päikese' } })
    expect(await screen.findByText('Osa äriregistri päringutest jäi vastuseta, seega võib mõni ettevõte tulemustest puududa.')).toBeInTheDocument()
    expect(within(screen.getByRole('listbox', { name: 'Otsingutulemused' })).getAllByRole('option')).toHaveLength(2)
  })

  it('tells the same in the invoice buyer picker', async () => {
    liveOffline()
    window.location.hash = '#/invoices/new'
    render(<App repository={createMemoryRepo({ profile: sampleProfile() })} />)
    const input = await screen.findByLabelText('Klient')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'olematu' } })
    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument()
    expect(screen.queryByText('Vasteid ei leitud. Lisa uus klient või sisesta andmed käsitsi.')).not.toBeInTheDocument()
    // The message sits under the field, not in a popup over the retry button, and no empty listbox is left open.
    expect(screen.getByText(UNAVAILABLE)).toHaveAttribute('id', input.getAttribute('aria-describedby'))
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    // Retry runs the search again while the field keeps focus.
    search.mockImplementation(async () => [REGISTRY_FIXTURE[1]])
    const calls = search.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Proovi uuesti' }))
    await waitFor(() => expect(search.mock.calls.length).toBeGreaterThan(calls))
    expect(await screen.findByRole('option', { name: /Päikesekiir AS/ })).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'true')
  })

  it('says "no matches" under the buyer field without opening an empty list', async () => {
    window.location.hash = '#/invoices/new'
    render(<App repository={createMemoryRepo({ profile: sampleProfile() })} />)
    const input = await screen.findByLabelText('Klient')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'olematu' } })
    expect(await screen.findByText('Vasteid ei leitud. Lisa uus klient või sisesta andmed käsitsi.')).toHaveClass('field-hint')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Proovi uuesti' })).not.toBeInTheDocument()
  })
})
