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
  it('is reachable from the navigation and adds products from the quick-add row', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    render(<App repository={repo} />)
    fireEvent.click(await screen.findByRole('link', { name: 'Tooted' }))
    expect(await screen.findByRole('heading', { name: 'Tooted ja teenused', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Kataloog on tühi' })).toBeInTheDocument()
    expect(screen.getByText(/nupuga „Lisa kataloogist“/)).toBeInTheDocument()

    const form = within(screen.getByRole('form', { name: 'Uus toode või teenus' }))
    fireEvent.click(form.getByRole('button', { name: 'Lisa kataloogi' }))
    expect(await form.findByText('Sisesta kirjeldus.')).toBeInTheDocument()
    expect(form.getByLabelText('Kirjeldus')).toHaveFocus()
    expect(repo.saveProduct).not.toHaveBeenCalled()

    fireEvent.change(form.getByLabelText('Kirjeldus'), { target: { value: 'Veebilehe hooldus' } })
    fireEvent.change(form.getByLabelText('Ühik'), { target: { value: 'kuu' } })
    fireEvent.change(form.getByLabelText('Ühikuhind (km-ta)'), { target: { value: '120,5' } })
    fireEvent.change(form.getByLabelText('Käibemaksumäär'), { target: { value: '13' } })
    fireEvent.submit(form.getByLabelText('Kirjeldus'))

    await waitFor(() => expect(repo.saveProduct).toHaveBeenCalledTimes(1))
    expect(repo.saveProduct.mock.calls[0][0]).toMatchObject({ description: 'Veebilehe hooldus', unit: 'kuu', unitPrice: 120.5, vatRate: 13 })
    // Announced to screen readers and shown under the row.
    expect(await screen.findAllByText('Lisatud kataloogi: Veebilehe hooldus')).toHaveLength(2)
    expect(document.querySelector('.pf-added')).toHaveTextContent('Lisatud kataloogi: Veebilehe hooldus')
    const row = (await screen.findByText('Veebilehe hooldus')).closest('tr')!
    expect(within(row).getByText('13%')).toBeInTheDocument()
    expect(within(row).getByText(/120,50/)).toBeInTheDocument()
    // The row is ready for the next item.
    await waitFor(() => expect(form.getByLabelText('Kirjeldus')).toHaveValue(''))
    expect(form.getByLabelText('Kirjeldus')).toHaveFocus()
  })

  it('edits inline, rejects a duplicate description, searches and deletes', async () => {
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
    let form = within(await screen.findByRole('form', { name: 'Muuda: Konsultatsioon' }))
    expect(form.getByLabelText('Kirjeldus')).toHaveFocus()
    fireEvent.keyDown(form.getByLabelText('Kirjeldus'), { key: 'Escape' })
    expect(screen.queryByRole('form', { name: 'Muuda: Konsultatsioon' })).not.toBeInTheDocument()

    // Escape in the unit field first closes its suggestion list; the next one cancels the edit.
    fireEvent.click(screen.getByRole('button', { name: 'Muuda: Konsultatsioon' }))
    form = within(await screen.findByRole('form', { name: 'Muuda: Konsultatsioon' }))
    fireEvent.change(form.getByLabelText('Ühik'), { target: { value: 'kom' } })
    fireEvent.keyDown(form.getByLabelText('Ühik'), { key: 'Escape' })
    expect(screen.getByRole('form', { name: 'Muuda: Konsultatsioon' })).toBeInTheDocument()
    expect(form.getByLabelText('Ühik')).toHaveValue('kom')
    fireEvent.keyDown(form.getByLabelText('Ühik'), { key: 'Escape' })
    expect(screen.queryByRole('form', { name: 'Muuda: Konsultatsioon' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Muuda: Konsultatsioon' }))
    form = within(await screen.findByRole('form', { name: 'Muuda: Konsultatsioon' }))
    fireEvent.change(form.getByLabelText('Kirjeldus'), { target: { value: 'serveri MAJUTUS' } })
    fireEvent.click(form.getByRole('button', { name: 'Salvesta' }))
    expect(await form.findByText('Sama kirjeldusega toode on kataloogis juba olemas.')).toBeInTheDocument()
    // Emptying the field clears the error instead of turning it into another one.
    fireEvent.change(form.getByLabelText('Kirjeldus'), { target: { value: '' } })
    fireEvent.blur(form.getByLabelText('Kirjeldus'))
    expect(form.queryByText('Sisesta kirjeldus.')).not.toBeInTheDocument()
    expect(form.queryByText('Sama kirjeldusega toode on kataloogis juba olemas.')).not.toBeInTheDocument()
    fireEvent.change(form.getByLabelText('Kirjeldus'), { target: { value: 'Konsultatsioon (kaugtöö)' } })
    fireEvent.click(form.getByRole('button', { name: 'Salvesta' }))
    await waitFor(() => expect(repo.saveProduct).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', description: 'Konsultatsioon (kaugtöö)' })))
    expect(await screen.findByText('Konsultatsioon (kaugtöö)')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: /^Muuda:/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Otsi tooteid ja teenuseid' }), { target: { value: 'kaug' } })
    expect(screen.queryByText('Serveri majutus')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Otsi tooteid ja teenuseid' }), { target: { value: '' } })

    fireEvent.click(screen.getByRole('button', { name: 'Kustuta: Serveri majutus' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Kas kustutada „Serveri majutus“?' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Kustuta' }))
    await waitFor(() => expect(repo.deleteProduct).toHaveBeenCalledWith('p2'))
    await waitFor(() => expect(screen.queryByText('Serveri majutus')).not.toBeInTheDocument())
  })
})
