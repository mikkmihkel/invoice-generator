import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeTotals, type InvoiceLine, type Product } from '../../../domain'
import { line, sampleInvoice } from '../../../pdf/testFixtures'
import type { Repository } from '../../../storage'
import { AppProvider } from '../../AppContext'
import { createMemoryRepo, sampleProfile } from '../../testing/memoryRepo'
import { ToastProvider } from '../../Toasts'
import { LinesEditor } from './LinesEditor'

vi.mock('../../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../storage')>()),
  getRepository: () => {
    throw new Error('tests pass a repository explicitly')
  },
  subscribe: () => () => undefined,
}))

afterEach(cleanup)

const ts = '2026-01-01T00:00:00.000Z'
const products: Product[] = [
  { id: 'p1', description: 'Veebilehe hooldus', unit: 'kuu', unitPrice: 120, vatRate: 13, createdAt: ts, updatedAt: ts },
  { id: 'p2', description: 'Konsultatsioon', unit: 'h', unitPrice: 55, createdAt: ts, updatedAt: ts },
]
const buyer = { clientId: 'c1', name: 'Klient Žürii OÜ', registryCode: '87654321' }
const earlier = sampleInvoice({
  id: 'old',
  number: '2026-0003',
  issueDate: '2026-09-15',
  buyer: { ...sampleInvoice().buyer, ...buyer },
  lines: [line({ id: 'o1', description: 'Konsultatsioon', unit: 'h', unitPrice: 65, vatRate: 24 })],
})

function Harness({ initial, withBuyer = true }: { initial: InvoiceLine[]; withBuyer?: boolean }) {
  const [lines, setLines] = useState(initial)
  return (
    <>
      <LinesEditor
        lines={lines}
        onChange={setLines}
        vatScheme="domestic"
        currency="EUR"
        totals={computeTotals({ lines, vatScheme: 'domestic' })}
        defaultUnit="tk"
        defaultVatRate={24}
        buyer={withBuyer ? buyer : undefined}
      />
      <output data-testid="lines">{JSON.stringify(lines.map(({ description, unit, unitPrice, vatRate }) => ({ description, unit, unitPrice, vatRate })))}</output>
    </>
  )
}

function setup(repo: Repository, initial: InvoiceLine[] = [line({ id: 'l1', description: '', unit: 'tk', unitPrice: 0, vatRate: 24 })], withBuyer = true) {
  render(
    <AppProvider repository={repo}>
      <ToastProvider>
        <Harness initial={initial} withBuyer={withBuyer} />
      </ToastProvider>
    </AppProvider>,
  )
}

const current = () => JSON.parse(screen.getByTestId('lines').textContent!)

describe('line description suggestions', () => {
  it('suggests catalogue items while typing and fills the line with the keyboard', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile(), products })
    setup(repo, undefined, false)
    await waitFor(() => expect(repo.listProducts).toHaveBeenCalled())
    const box = screen.getByRole('textbox', { name: 'Kirjeldus 1' })
    expect(box).toHaveAttribute('aria-autocomplete', 'list')
    fireEvent.change(box, { target: { value: 'hool' } })

    const list = await screen.findByRole('listbox', { name: 'Soovitused' })
    expect(box).toHaveAttribute('aria-controls', list.id)
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('Soovitusi: 1. Liigu nooleklahvidega ja vali Enteriga.')).toBeInTheDocument()

    fireEvent.keyDown(box, { key: 'ArrowDown' })
    const option = within(list).getByRole('option', { name: /Veebilehe hooldus/ })
    expect(option).toHaveAttribute('aria-selected', 'true')
    expect(box).toHaveAttribute('aria-activedescendant', option.id)
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(current()).toEqual([{ description: 'Veebilehe hooldus', unit: 'kuu', unitPrice: 120, vatRate: 13 }])
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('offers the buyer’s last price first and uses the default rate for catalogue items without one', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile(), products, invoices: [earlier] })
    setup(repo)
    const box = screen.getByRole('textbox', { name: 'Kirjeldus 1' })
    await waitFor(() => expect(repo.listInvoices).toHaveBeenCalled())
    fireEvent.change(box, { target: { value: 'konsult' } })
    const list = await screen.findByRole('listbox')
    const options = within(list).getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('arve 2026-0003, 15.09.2026')
    expect(options[0]).toHaveTextContent('65,00')
    expect(within(list).getByText('Sellele kliendile varem arveldatud')).toBeInTheDocument()
    expect(within(list).getByText('Kataloogist')).toBeInTheDocument()

    fireEvent.click(options[1])
    expect(current()).toEqual([{ description: 'Konsultatsioon', unit: 'h', unitPrice: 55, vatRate: 24 }])
  })

  it('closes on Escape and leaves Enter alone when no suggestion is active', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile(), products })
    setup(repo, undefined, false)
    await waitFor(() => expect(repo.listProducts).toHaveBeenCalled())
    const box = screen.getByRole('textbox', { name: 'Kirjeldus 1' })
    fireEvent.change(box, { target: { value: 'veeb' } })
    await screen.findByRole('listbox')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    // ArrowDown reopens the list on a one-line description.
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Escape' })
    fireEvent.change(box, { target: { value: 'veebi' } })
    await screen.findByRole('listbox')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(current()[0].description).toBe('veebi')
    fireEvent.blur(box)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('saves a line to the catalogue, updating an item with the same description', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile(), products })
    setup(repo, [line({ id: 'l1', description: 'Uus teenus', unit: 'päev', unitPrice: 400, vatRate: 24 }), line({ id: 'l2', description: 'konsultatsioon', unit: 'h', unitPrice: 70, vatRate: 24 }), line({ id: 'l3', description: '' })])
    await waitFor(() => expect(repo.listProducts).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Salvesta rida 3 kataloogi' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Salvesta rida 1 kataloogi' }))
    await waitFor(() => expect(repo.saveProduct).toHaveBeenCalledTimes(1))
    expect(repo.saveProduct.mock.calls[0][0]).toMatchObject({ description: 'Uus teenus', unit: 'päev', unitPrice: 400, vatRate: 24 })
    expect(await screen.findByText('„Uus teenus“ lisati kataloogi.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Salvesta rida 2 kataloogi' }))
    await waitFor(() => expect(repo.saveProduct).toHaveBeenCalledTimes(2))
    expect(repo.saveProduct.mock.calls[1][0]).toMatchObject({ id: 'p2', description: 'konsultatsioon', unitPrice: 70 })
    expect(await screen.findByText('„konsultatsioon“ uuendati kataloogis.')).toBeInTheDocument()
  })
})
