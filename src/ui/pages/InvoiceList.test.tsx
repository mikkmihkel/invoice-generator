import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { newId, type Invoice } from '../../domain'
import { addDaysISO, localTodayISO } from '../util'
import { createMemoryRepo, sampleProfile } from '../testing/memoryRepo'

vi.mock('../../registry', async () => (await import('../testing/mocks')).registryMock())
vi.mock('../../pdf', async () => (await import('../testing/mocks')).pdfMock())
vi.mock('../../integrations', async () => (await import('../testing/mocks')).integrationsMock())
vi.mock('../../einvoice', async () => (await import('../testing/mocks')).einvoiceMock())
vi.mock('../components/brand/pdfRaster', () => ({
  renderPdfPageImage: vi.fn(async () => ({ src: 'data:image/png;base64,AAAA', width: 720, height: 1018 })),
}))
vi.mock('../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../storage')>()),
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
    sessionStorage.clear()
  } catch {
    /* ignore */
  }
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const profile = sampleProfile()
const today = localTodayISO()

let seq = 0
function invoice(patch: Partial<Invoice> = {}): Invoice {
  seq++
  return {
    id: `inv-${seq}`,
    number: `2026-${String(seq).padStart(4, '0')}`,
    type: 'invoice',
    status: 'issued',
    issueDate: addDaysISO(today, -3),
    dueDate: addDaysISO(today, 11),
    seller: { ...profile },
    buyer: { kind: 'company', name: `Klient ${seq} OÜ`, registryCode: '14520336', address: { street: 'Pärnu mnt 140', city: 'Tallinn', postalCode: '11317', country: 'EE' } },
    bankAccountIds: [],
    lines: [{ id: newId(), description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 100, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic',
    referenceNumber: `20260${seq}7`,
    language: 'et',
    templateId: 'classic',
    accentColor: '#2457c5',
    issuedAt: addDaysISO(today, -3) + 'T09:00:00Z',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
    ...patch,
  }
}

const overdue = (patch: Partial<Invoice> = {}) => invoice({ issueDate: addDaysISO(today, -40), dueDate: addDaysISO(today, -26), ...patch })

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

const list = async () => (await screen.findByRole('region', { name: 'Arved' })) as HTMLElement
const rowNames = (root: HTMLElement) => Array.from(root.querySelectorAll('.inv-row .row-client')).map((e) => e.textContent)

describe('receivables and the overdue filter', () => {
  it('opens the unpaid or the overdue invoices from the sums in the receivables sentence', async () => {
    const late = overdue({ buyer: { ...invoice().buyer, name: 'Hiline OÜ' } })
    const open = invoice({ buyer: { ...invoice().buyer, name: 'Avatud OÜ' } })
    const paid = invoice({ status: 'paid', paidAt: today, buyer: { ...invoice().buyer, name: 'Tasunud OÜ' } })
    renderAt('#/', createMemoryRepo({ profile, invoices: [late, open, paid] }))
    const root = await list()
    expect(rowNames(root)).toHaveLength(3)
    fireEvent.click(within(root).getByRole('button', { name: /^Näita tähtaja ületanud arveid: 124,00\s€$/ }))
    expect(rowNames(root)).toEqual(['Hiline OÜ'])
    expect(within(root).getByRole('radio', { name: /Üle tähtaja/ })).toBeChecked()
    fireEvent.click(within(root).getByRole('button', { name: /^Näita tasumata arveid: 248,00\s€$/ }))
    expect(rowNames(root).sort()).toEqual(['Avatud OÜ', 'Hiline OÜ'])
    expect(within(root).getByRole('radio', { name: 'Tasumata' })).toBeChecked()
  })

  it('shows "Overdue (n)" as a main filter only while there are overdue invoices', async () => {
    const view = renderAt('#/', createMemoryRepo({ profile, invoices: [overdue(), overdue(), invoice()] }))
    let root = await list()
    const chip = within(root).getByRole('radio', { name: 'Üle tähtaja 2' })
    // Not offered twice: the overdue choice leaves "More filters".
    expect(within(root).queryByRole('option', { name: 'Tähtaeg ületatud' })).not.toBeInTheDocument()
    fireEvent.click(chip)
    expect(rowNames(root)).toHaveLength(2)
    view.unmount()

    renderAt('#/', createMemoryRepo({ profile, invoices: [invoice()] }))
    root = await list()
    expect(within(root).queryByRole('radio', { name: /Üle tähtaja/ })).not.toBeInTheDocument()
    expect(within(root).getByRole('option', { name: 'Tähtaeg ületatud' })).toBeInTheDocument()
  })

  it('drops the chip once the last overdue invoice is paid', async () => {
    const late = overdue()
    const repo = createMemoryRepo({ profile, invoices: [late], events: [{ id: 'e', invoiceId: late.id, kind: 'reminder', at: new Date().toISOString() }] })
    renderAt(`#/?id=${late.id}`, repo)
    const root = await list()
    fireEvent.click(within(root).getByRole('radio', { name: 'Üle tähtaja 1' }))
    const article = (await screen.findByRole('heading', { level: 2, name: late.number ? `Arve ${late.number}` : '' })).closest('article')!
    await act(async () => {
      fireEvent.click(await within(article).findByRole('button', { name: 'Märgi tasutuks' }))
    })
    expect(repo.markInvoicePaid).toHaveBeenCalled()
    expect(await screen.findByText(/märgiti tasutuks/)).toBeInTheDocument()
    expect(within(root).queryByRole('radio', { name: /Üle tähtaja/ })).not.toBeInTheDocument()
  })
})
