import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeTotals, type InvoiceLine, type Product } from '../../../domain'
import { line, sampleInvoice } from '../../../pdf/testFixtures'
import type { Repository } from '../../../storage'
import { AppProvider } from '../../AppContext'
import { ConfirmProvider } from '../../components/Dialog'
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

function Harness({ initial, withBuyer = true, currency = 'EUR', catalogue }: { initial: InvoiceLine[]; withBuyer?: boolean; currency?: string; catalogue?: boolean }) {
  const [lines, setLines] = useState(initial)
  return (
    <>
      <LinesEditor
        lines={lines}
        onChange={setLines}
        vatScheme="domestic"
        currency={currency}
        totals={computeTotals({ lines, vatScheme: 'domestic' })}
        defaultUnit="tk"
        defaultVatRate={24}
        buyer={withBuyer ? buyer : undefined}
        catalogue={catalogue}
      />
      <output data-testid="lines">{JSON.stringify(lines.map(({ description, unit, unitPrice, vatRate }) => ({ description, unit, unitPrice, vatRate })))}</output>
    </>
  )
}

function setup(repo: Repository, initial: InvoiceLine[] = [line({ id: 'l1', description: '', unit: 'tk', unitPrice: 0, vatRate: 24 })], withBuyer = true, currency = 'EUR', catalogue?: boolean) {
  render(
    <AppProvider repository={repo}>
      <ToastProvider>
        <ConfirmProvider>
          <Harness initial={initial} withBuyer={withBuyer} currency={currency} catalogue={catalogue} />
        </ConfirmProvider>
      </ToastProvider>
    </AppProvider>,
  )
}

const row = (n: number) => within(screen.getByRole('listitem', { name: `Rida ${n}` }))

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
    expect(within(list).getByText('Selle kliendi varasematelt arvetelt')).toBeInTheDocument()
    expect(within(list).getByText('Kataloogist')).toBeInTheDocument()

    fireEvent.click(options[1])
    expect(current()).toEqual([{ description: 'Konsultatsioon', unit: 'h', unitPrice: 55, vatRate: 24 }])
  })

  it('opens above the field when the bars pinned to the bottom would cover the list', async () => {
    const bar = document.createElement('div')
    bar.className = 'main-nav'
    bar.style.position = 'fixed'
    document.body.appendChild(bar)
    const rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 390, width: 390, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
      if (this === bar) return box(661, 844)
      if (this.classList.contains('line-desc')) return box(580, 620)
      if (this.classList.contains('line-suggestions')) return box(624, 924)
      return box(0, 0)
    })
    try {
      const repo = createMemoryRepo({ profile: sampleProfile(), products })
      setup(repo, undefined, false)
      await waitFor(() => expect(repo.listProducts).toHaveBeenCalled())
      fireEvent.change(screen.getByRole('textbox', { name: 'Kirjeldus 1' }), { target: { value: 'hool' } })
      const list = await screen.findByRole('listbox')
      expect(list).toHaveAttribute('data-side', 'above')
    } finally {
      rects.mockRestore()
      bar.remove()
    }
  })

  it('says that catalogue prices are not converted on a foreign-currency invoice', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile(), products })
    setup(repo, undefined, false, 'USD')
    await waitFor(() => expect(repo.listProducts).toHaveBeenCalled())
    fireEvent.change(screen.getByRole('textbox', { name: 'Kirjeldus 1' }), { target: { value: 'hool' } })
    const list = await screen.findByRole('listbox')
    expect(within(list).getByText('Kataloogist – hind kantakse arvele ümber arvestamata')).toBeInTheDocument()
    fireEvent.click(within(list).getByRole('option', { name: /Veebilehe hooldus/ }))
    expect(current()).toEqual([{ description: 'Veebilehe hooldus', unit: 'kuu', unitPrice: 120, vatRate: 13 }])
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

})

describe('catalogue', () => {
  it('offers "Salvesta tooteks" for filled lines that are not in the catalogue and marks the ones that are', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile(), products })
    setup(repo, [line({ id: 'l1', description: 'Uus teenus', unit: 'päev', unitPrice: 400, vatRate: 24 }), line({ id: 'l2', description: 'veebilehe hooldus', unit: 'kuu', unitPrice: 120, vatRate: 13 }), line({ id: 'l3', description: '', unitPrice: 0 })])
    await waitFor(() => expect(repo.listProducts).toHaveBeenCalled())
    await row(2).findByText('Kataloogis')
    expect(row(2).queryByRole('button', { name: 'Salvesta tooteks' })).not.toBeInTheDocument()
    expect(row(3).queryByRole('button', { name: 'Salvesta tooteks' })).not.toBeInTheDocument()

    fireEvent.click(row(1).getByRole('button', { name: 'Salvesta tooteks' }))
    await waitFor(() => expect(repo.saveProduct).toHaveBeenCalledTimes(1))
    expect(repo.saveProduct.mock.calls[0][0]).toMatchObject({ description: 'Uus teenus', unit: 'päev', unitPrice: 400, vatRate: 24 })
    expect(await screen.findByText('Salvestatud kataloogi: Uus teenus')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ava tooted' })).toBeInTheDocument()
    // Saved: the chip gives way to the marker.
    expect(await row(1).findByText('Kataloogis')).toBeInTheDocument()
    expect(row(1).queryByRole('button', { name: 'Salvesta tooteks' })).not.toBeInTheDocument()
  })

  it('asks before updating an item whose details differ, from the line menu', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile(), products })
    setup(repo, [line({ id: 'l1', description: 'konsultatsioon', unit: 'h', unitPrice: 70, vatRate: 24 })])
    expect(await row(1).findByText('Kataloogis, andmed erinevad')).toBeInTheDocument()
    // The marker says so in plain sight and shows the catalogue's values on focus or tap.
    const marker = row(1).getByRole('button', { name: 'Kataloogis, andmed erinevad' })
    expect(marker).toHaveTextContent('erineb')
    expect(marker).toHaveAttribute('aria-expanded', 'false')
    fireEvent.focus(marker)
    expect(marker).toHaveAttribute('aria-expanded', 'true')
    expect(row(1).getByRole('status')).toHaveTextContent('Kataloogis: 55,00 € / h, km 24%')
    fireEvent.keyDown(marker, { key: 'Escape' })
    expect(marker).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(marker)
    expect(marker).toHaveAttribute('aria-expanded', 'true')
    fireEvent.blur(marker)
    expect(marker).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(row(1).getByRole('button', { name: 'Rea 1 toimingud' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Uuenda kataloogis' }))
    let dialog = within(await screen.findByRole('dialog', { name: 'Kas uuendada „Konsultatsioon“ kataloogis?' }))
    expect(dialog.getByText(/Kataloogis on praegu 55,00 € \/ h, km 24%\. Uued andmed: 70,00 € \/ h, km 24%\./)).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'Loobu' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(repo.saveProduct).not.toHaveBeenCalled()

    fireEvent.click(row(1).getByRole('button', { name: 'Rea 1 toimingud' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Uuenda kataloogis' }))
    dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: 'Uuenda' }))
    await waitFor(() => expect(repo.saveProduct).toHaveBeenCalledTimes(1))
    expect(repo.saveProduct.mock.calls[0][0]).toMatchObject({ id: 'p2', description: 'konsultatsioon', unitPrice: 70 })
    expect(await screen.findByText('Uuendatud kataloogis: konsultatsioon')).toBeInTheDocument()
    expect(await row(1).findByText('Kataloogis')).toBeInTheDocument()
  })

  it('adds the best match with Enter and replaces the empty first line', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile(), products })
    setup(repo, undefined, false)
    fireEvent.click(await screen.findByRole('button', { name: 'Lisa kataloogist' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Lisa kataloogist' }))
    const search = dialog.getByRole('searchbox', { name: 'Otsi tooteid ja teenuseid' })
    expect(search).toHaveFocus()
    // Alphabetical without a query.
    expect(dialog.getAllByRole('checkbox').map((c) => c.closest('label')!.querySelector('.pick-name')!.textContent)).toEqual(['Konsultatsioon', 'Veebilehe hooldus'])
    fireEvent.change(search, { target: { value: 'hool' } })
    expect(dialog.getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(current()).toEqual([{ description: 'Veebilehe hooldus', unit: 'kuu', unitPrice: 120, vatRate: 13 }])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('adds several selected items with their quantities in the order they were chosen', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile(), products })
    setup(repo, [line({ id: 'l1', description: 'Konsultatsioon', unit: 'h', unitPrice: 55, vatRate: 24 })], false)
    fireEvent.click(await screen.findByRole('button', { name: 'Lisa kataloogist' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Lisa kataloogist' }))
    expect(dialog.getByRole('button', { name: 'Lisa arvele' })).toBeDisabled()
    expect(within(dialog.getByRole('checkbox', { name: /Konsultatsioon/ }).closest('li')!).getByText('juba arvel')).toBeInTheDocument()

    fireEvent.click(dialog.getByRole('checkbox', { name: /Veebilehe hooldus/ }))
    fireEvent.click(dialog.getByRole('checkbox', { name: /Konsultatsioon/ }))
    expect(dialog.getByText('Valitud: 2')).toBeInTheDocument()
    fireEvent.change(dialog.getByRole('textbox', { name: 'Kogus: Veebilehe hooldus' }), { target: { value: '3' } })
    fireEvent.change(dialog.getByRole('textbox', { name: 'Kogus: Konsultatsioon' }), { target: { value: '2,5' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Lisa arvele (2)' }))

    expect(current()).toEqual([
      { description: 'Konsultatsioon', unit: 'h', unitPrice: 55, vatRate: 24 },
      { description: 'Veebilehe hooldus', unit: 'kuu', unitPrice: 120, vatRate: 13 },
      { description: 'Konsultatsioon', unit: 'h', unitPrice: 55, vatRate: 24 },
    ])
    expect(screen.getAllByRole('textbox', { name: 'Kogus' }).map((i) => (i as HTMLInputElement).value)).toEqual(['1', '3', '2,5'])
  })

  it('moves between items with the arrow keys and selects with the keyboard', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile(), products })
    setup(repo, undefined, false)
    fireEvent.click(await screen.findByRole('button', { name: 'Lisa kataloogist' }))
    const dialog = within(await screen.findByRole('dialog'))
    const search = dialog.getByRole('searchbox')
    const [first, second] = dialog.getAllByRole('checkbox')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(second).toHaveFocus()
    fireEvent.keyDown(second, { key: 'ArrowUp' })
    fireEvent.keyDown(first, { key: 'ArrowUp' })
    expect(search).toHaveFocus()
    // Enter on an item with nothing selected adds that item.
    fireEvent.keyDown(second, { key: 'Enter' })
    expect(current()).toEqual([{ description: 'Veebilehe hooldus', unit: 'kuu', unitPrice: 120, vatRate: 13 }])
  })

  it('shows a quiet hint instead of the picker while the catalogue is empty', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    setup(repo, undefined, false)
    await waitFor(() => expect(repo.listProducts).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Lisa kataloogist' })).not.toBeInTheDocument()
    expect(screen.getByText(/Korduva arverea saad salvestada tooteks/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ava tooted' })).toHaveAttribute('href', '#/products')
  })

  it('leaves the catalogue out when the editor asks for it (credit notes)', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile(), products })
    setup(repo, [line({ id: 'l1', description: 'Uus teenus', quantity: 1, unitPrice: 400 })], false, 'EUR', false)
    await waitFor(() => expect(repo.listProducts).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Lisa kataloogist' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salvesta tooteks' })).not.toBeInTheDocument()
    fireEvent.click(row(1).getByRole('button', { name: 'Rea 1 toimingud' }))
    expect(screen.queryByRole('menuitem', { name: 'Salvesta kataloogi' })).not.toBeInTheDocument()
  })
})

describe('line menu', () => {
  it('duplicates and moves lines', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    setup(repo, [line({ id: 'a', description: 'Esimene' }), line({ id: 'b', description: 'Teine' })], false)
    fireEvent.click(row(1).getByRole('button', { name: 'Rea 1 toimingud' }))
    expect(screen.getByRole('menuitem', { name: 'Liiguta üles' })).toBeDisabled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tee koopia' }))
    expect(current().map((l: InvoiceLine) => l.description)).toEqual(['Esimene', 'Esimene', 'Teine'])

    fireEvent.click(row(1).getByRole('button', { name: 'Rea 1 toimingud' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Liiguta alla' }))
    fireEvent.click(row(3).getByRole('button', { name: 'Rea 3 toimingud' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Liiguta üles' }))
    expect(current().map((l: InvoiceLine) => l.description)).toEqual(['Esimene', 'Teine', 'Esimene'])
  })
})

describe('read-only lines', () => {
  it('show unit prices as money and label the description without a number', async () => {
    const lines = [line({ id: 'r1', description: 'Veebileht', quantity: 1, unit: 'tk', unitPrice: 2500, vatRate: 24 }), line({ id: 'r2', description: 'Tugi', quantity: 2, unit: 'h', unitPrice: 65, vatRate: 24 })]
    render(
      <AppProvider repository={createMemoryRepo({ profile: sampleProfile() })}>
        <ToastProvider>
          <ConfirmProvider>
            <LinesEditor lines={lines} onChange={() => undefined} vatScheme="domestic" currency="EUR" totals={computeTotals({ lines, vatScheme: 'domestic' })} defaultUnit="tk" defaultVatRate={24} disabled />
          </ConfirmProvider>
        </ToastProvider>
      </AppProvider>,
    )
    const prices = await screen.findAllByLabelText('Ühikuhind')
    expect(prices.map((p) => p.textContent)).toEqual(['2 500,00 €', '65,00 €'])
    expect(screen.getAllByLabelText('Kirjeldus')).toHaveLength(2)
    expect(screen.queryByLabelText('Kirjeldus 1')).not.toBeInTheDocument()
  })
})
