import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { newId } from '../domain'
import { newClient } from './util'
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

beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

describe('onboarding', () => {
  it('saves a manually entered company and lands on the empty invoice list', async () => {
    const repo = createMemoryRepo()
    renderAt('#/', repo)

    fireEvent.click(await screen.findByRole('button', { name: 'Sisesta andmed käsitsi' }))

    // Required fields are enforced before saving.
    fireEvent.click(screen.getByRole('button', { name: 'Salvesta ja alusta' }))
    expect(await screen.findByText('Sisesta ettevõtte nimi.')).toBeInTheDocument()
    expect(repo.saveProfile).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/^Nimi/), { target: { value: 'Minu Firma OÜ' } })
    fireEvent.change(screen.getByLabelText(/^Registrikood/), { target: { value: '12345678' } })
    fireEvent.change(screen.getByLabelText(/^Tänav/), { target: { value: 'Pikk 1' } })
    fireEvent.change(screen.getByLabelText(/^IBAN/), { target: { value: 'EE38 2200 2210 2014 5685' } })
    // Estonian IBANs prefill bank name / BIC.
    expect(screen.getByLabelText(/^BIC/)).toHaveValue('HABAEE2X')

    fireEvent.click(screen.getByRole('button', { name: 'Salvesta ja alusta' }))

    expect(await screen.findByText('Esimene arve ootab')).toBeInTheDocument()
    expect(repo.saveProfile).toHaveBeenCalledTimes(1)
    const saved = repo.saveProfile.mock.calls[0][0]
    expect(saved.name).toBe('Minu Firma OÜ')
    expect(saved.registryCode).toBe('12345678')
    expect(saved.bankAccounts).toEqual([expect.objectContaining({ iban: 'EE382200221020145685' })])
  })

  it('prefills the company from the e-Business Register', async () => {
    const repo = createMemoryRepo()
    renderAt('#/', repo)

    const search = await screen.findByRole('combobox')
    fireEvent.change(search, { target: { value: 'päikese' } })
    fireEvent.click(await screen.findByRole('option', { name: /Päikese Tarkvara OÜ/ }))

    expect(await screen.findByLabelText(/^Nimi/)).toHaveValue('Päikese Tarkvara OÜ')
    expect(screen.getByLabelText(/^Registrikood/)).toHaveValue('16543210')
    expect(screen.getByLabelText(/^KMKR number/)).toHaveValue('EE102345678')
    expect(screen.getByLabelText(/^Linn/)).toHaveValue('Tallinn')
    expect(screen.getByLabelText('Olen käibemaksukohustuslane (KMKR)')).toBeChecked()
  })
})

describe('invoice editor', () => {
  it('updates line and grand totals live while editing lines', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    renderAt('#/invoices/new', repo)

    fireEvent.change(await screen.findByLabelText('Kogus'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Ühiku hind'), { target: { value: '100,5' } })

    await waitFor(() => expect(screen.getByTestId('total-net')).toHaveTextContent('201,00'))
    expect(screen.getByTestId('total-gross')).toHaveTextContent('249,24')
    expect(screen.getByText(/Käibemaks 24%/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ Lisa rida' }))
    const prices = screen.getAllByLabelText('Ühiku hind')
    expect(prices).toHaveLength(2)
    fireEvent.change(prices[1], { target: { value: '10' } })
    fireEvent.change(screen.getAllByLabelText('KM')[1], { target: { value: '9' } })

    await waitFor(() => expect(screen.getByTestId('total-gross')).toHaveTextContent('259,14'))
    expect(screen.getByText(/Käibemaks 9%/)).toBeInTheDocument()

    // Remove the first line → only the 10 € + 9% line is left.
    fireEvent.click(screen.getByRole('button', { name: 'Eemalda rida 1' }))
    await waitFor(() => expect(screen.getByTestId('total-gross')).toHaveTextContent('10,90'))

    // Drafts are autosaved after a short pause.
    await waitFor(() => expect(repo.saveInvoice).toHaveBeenCalled(), { timeout: 3000 })
    const lastSaved = repo.saveInvoice.mock.calls.at(-1)![0]
    expect(lastSaved.lines).toHaveLength(1)
    expect(lastSaved.lines[0]).toMatchObject({ unitPrice: 10, vatRate: 9 })
  })

  it('hides VAT for a company that is not VAT registered', async () => {
    const base = sampleProfile()
    const repo = createMemoryRepo({
      profile: { ...base, vatRegistered: false, vatNumber: undefined, defaults: { ...base.defaults, vatScheme: 'not-registered' } },
    })
    renderAt('#/invoices/new', repo)
    fireEvent.change(await screen.findByLabelText('Ühiku hind'), { target: { value: '50' } })
    await waitFor(() => expect(screen.getByTestId('total-gross')).toHaveTextContent('50,00'))
    expect(screen.queryByTestId('total-net')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('KM')).not.toBeInTheDocument()
  })

  it('lists legal problems, blocks issuing until fixed, then issues and locks the invoice', async () => {
    const client = newClient({
      name: 'Ostja AS',
      registryCode: '10000000',
      address: { street: 'Rüütli 1', city: 'Pärnu', postalCode: '80010', country: 'EE' },
      email: 'arved@ostja.ee',
    })
    const repo = createMemoryRepo({ profile: sampleProfile(), clients: [client] })
    renderAt('#/invoices/new', repo)

    const panel = (await screen.findByRole('heading', { name: 'Nõuete kontroll' })).closest('section')!
    expect(within(panel).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Väljasta arve' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Klient'), { target: { value: client.id } })
    expect(await screen.findByText('Ostja AS')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Kirjeldus 1'), { target: { value: 'Veebilehe arendus' } })
    fireEvent.change(screen.getByLabelText('Ühiku hind'), { target: { value: '400' } })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Väljasta arve' })).toBeEnabled())
    expect(within(panel).queryAllByText(/./, { selector: '.issue-error *' })).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Väljasta arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Väljasta arve' })
    expect(within(dialog).getByText(/lukustatakse/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Väljasta' }))
    })

    expect(await screen.findByText(/väljastatud ja lukustatud/)).toBeInTheDocument()
    expect(repo.issueInvoice).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Märgi makstuks' })).toBeInTheDocument()
    expect(screen.getByLabelText('Kirjeldus 1')).toBeDisabled()
  })
})

describe('invoice list', () => {
  it('shows totals, derived overdue status and an empty state', async () => {
    const profile = sampleProfile()
    const repo = createMemoryRepo({ profile })
    const { unmount } = renderAt('#/', repo)
    expect(await screen.findByText('Esimene arve ootab')).toBeInTheDocument()
    unmount()

    const mk = (number: string, status: 'issued' | 'paid', dueDate: string, price: number) => ({
      id: newId(),
      number,
      type: 'invoice' as const,
      status,
      issueDate: '2026-01-05',
      dueDate,
      seller: { ...profile },
      buyer: { kind: 'company' as const, name: 'Klient ' + number, address: profile.address },
      bankAccountIds: [],
      lines: [{ id: newId(), description: 'Töö', quantity: 1, unit: 'tk', unitPrice: price, vatRate: 24 }],
      currency: 'EUR',
      vatScheme: 'domestic' as const,
      language: 'et' as const,
      templateId: 'classic' as const,
      accentColor: '#2457c5',
      createdAt: '2026-01-05T10:00:00Z',
      updatedAt: '2026-01-05T10:00:00Z',
    })
    const repo2 = createMemoryRepo({ profile, invoices: [mk('2026-0001', 'issued', '2026-01-19', 100), mk('2026-0002', 'paid', '2026-01-19', 50)] })
    renderAt('#/', repo2)
    expect(await screen.findByText('2026-0001')).toBeInTheDocument()
    const row = screen.getByText('2026-0001').closest('tr')!
    expect(within(row).getByText('Tähtaeg ületatud')).toBeInTheDocument()
    expect(within(row).getByText(/124,00/)).toBeInTheDocument()
    // The backup reminder is shown while no backup has been made.
    expect(screen.getByText(/pole veel varukoopiat teinud/)).toBeInTheDocument()
  })
})
