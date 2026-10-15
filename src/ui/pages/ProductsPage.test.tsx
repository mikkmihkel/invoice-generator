import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { createMemoryRepo, sampleProfile } from '../testing/memoryRepo'

vi.mock('../../registry', async () => (await import('../testing/mocks')).registryMock())
vi.mock('../../pdf', async () => (await import('../testing/mocks')).pdfMock())
vi.mock('../../integrations', async () => (await import('../testing/mocks')).integrationsMock())
vi.mock('../../einvoice', async () => (await import('../testing/mocks')).einvoiceMock())
vi.mock('../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../storage')>()),
  getRepository: () => {
    throw new Error('tests pass a repository explicitly')
  },
  subscribe: () => () => undefined,
}))

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const ts = '2026-01-01T00:00:00.000Z'

describe('products page', () => {
  it('is reachable from the navigation and adds a product from the empty state', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    render(<App repository={repo} />)
    fireEvent.click(await screen.findByRole('link', { name: 'Tooted' }))
    expect(await screen.findByRole('heading', { name: 'Tooted ja teenused', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Kataloog on tühi' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lisa toode või teenus' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Uus toode või teenus' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Salvesta' }))
    expect(await dialog.findByText('Sisesta kirjeldus.')).toBeInTheDocument()
    expect(repo.saveProduct).not.toHaveBeenCalled()

    fireEvent.change(dialog.getByLabelText(/Kirjeldus/), { target: { value: 'Veebilehe hooldus' } })
    fireEvent.change(dialog.getByLabelText('Ühik'), { target: { value: 'kuu' } })
    fireEvent.change(dialog.getByLabelText('Ühikuhind (km-ta)'), { target: { value: '120,5' } })
    fireEvent.change(dialog.getByLabelText('Käibemaksumäär'), { target: { value: '13' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Salvesta' }))

    await waitFor(() => expect(repo.saveProduct).toHaveBeenCalledTimes(1))
    expect(repo.saveProduct.mock.calls[0][0]).toMatchObject({ description: 'Veebilehe hooldus', unit: 'kuu', unitPrice: 120.5, vatRate: 13 })
    const row = (await screen.findByText('Veebilehe hooldus')).closest('tr')!
    expect(within(row).getByText('13%')).toBeInTheDocument()
    expect(within(row).getByText(/120,50/)).toBeInTheDocument()
  })

  it('edits, rejects a duplicate description, searches and deletes', async () => {
    const repo = createMemoryRepo({
      profile: sampleProfile(),
      products: [
        { id: 'p1', description: 'Konsultatsioon', unit: 'h', unitPrice: 60, createdAt: ts, updatedAt: ts },
        { id: 'p2', description: 'Serveri majutus', unit: 'kuu', unitPrice: 15, vatRate: 24, createdAt: ts, updatedAt: ts },
      ],
    })
    window.location.hash = '#/products'
    render(<App repository={repo} />)
    expect(await screen.findByText('Kataloogis: 2')).toBeInTheDocument()
    // No own rate: the profile default is shown.
    expect(within(screen.getByText('Konsultatsioon').closest('tr')!).getByText('24%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Muuda: Konsultatsioon' }))
    let dialog = within(await screen.findByRole('dialog', { name: 'Muuda toodet või teenust' }))
    fireEvent.change(dialog.getByLabelText(/Kirjeldus/), { target: { value: 'serveri MAJUTUS' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Salvesta' }))
    expect(await dialog.findByText('Sama kirjeldusega toode on kataloogis juba olemas.')).toBeInTheDocument()
    fireEvent.change(dialog.getByLabelText(/Kirjeldus/), { target: { value: 'Konsultatsioon (kaugtöö)' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Salvesta' }))
    await waitFor(() => expect(repo.saveProduct).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', description: 'Konsultatsioon (kaugtöö)' })))
    expect(await screen.findByText('Konsultatsioon (kaugtöö)')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Otsi tooteid ja teenuseid' }), { target: { value: 'kaug' } })
    expect(screen.queryByText('Serveri majutus')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Otsi tooteid ja teenuseid' }), { target: { value: '' } })

    fireEvent.click(screen.getByRole('button', { name: 'Kustuta: Serveri majutus' }))
    dialog = within(await screen.findByRole('dialog', { name: 'Kas kustutada „Serveri majutus“?' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Kustuta' }))
    await waitFor(() => expect(repo.deleteProduct).toHaveBeenCalledWith('p2'))
    await waitFor(() => expect(screen.queryByText('Serveri majutus')).not.toBeInTheDocument())
  })
})
