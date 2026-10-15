import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../../App'
import { createDefaultSettings, newId, type Invoice } from '../../../domain'
import { renderInvoicePdf } from '../../../pdf'
import { addDaysISO, localTodayISO } from '../../util'
import { createMemoryRepo, sampleProfile } from '../../testing/memoryRepo'

vi.mock('../../../registry', async () => (await import('../../testing/mocks')).registryMock())
vi.mock('../../../pdf', async () => (await import('../../testing/mocks')).pdfMock())
vi.mock('../../../integrations', async () => (await import('../../testing/mocks')).integrationsMock())
vi.mock('../../../einvoice', async () => (await import('../../testing/mocks')).einvoiceMock())
vi.mock('../../components/brand/pdfRaster', () => ({
  renderPdfPageImage: vi.fn(async () => ({ src: 'data:image/png;base64,AAAA', width: 720, height: 1018 })),
}))
vi.mock('../../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../storage')>()),
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

const profile = sampleProfile()
const today = localTodayISO()

function invoice(patch: Partial<Invoice> = {}): Invoice {
  return {
    id: newId(),
    number: '2026-0004',
    type: 'invoice',
    status: 'issued',
    issueDate: addDaysISO(today, -10),
    dueDate: addDaysISO(today, 20),
    seller: { ...profile },
    buyer: { kind: 'company', name: 'Kalda Puutöö OÜ', registryCode: '14520336', email: 'arved@kalda.ee', address: { street: 'Pärnu mnt 140', city: 'Tallinn', postalCode: '11317', country: 'EE' } },
    bankAccountIds: [],
    lines: [
      { id: newId(), description: 'Veebipoe arendus', quantity: 18, unit: 'h', unitPrice: 65, vatRate: 24 },
      { id: newId(), description: 'Domeen', quantity: 1, unit: 'tk', unitPrice: 24.9, vatRate: 24 },
    ],
    currency: 'EUR',
    vatScheme: 'domestic',
    referenceNumber: '202600046',
    language: 'et',
    templateId: 'classic',
    accentColor: '#2457c5',
    issuedAt: addDaysISO(today, -10) + 'T09:00:00Z',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
    ...patch,
  }
}

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

const doc = async () => (await screen.findByRole('heading', { level: 2, name: /^(Arve|Kreeditarve)/ })).closest('article')!
const actions = (article: HTMLElement) => within(article).getByRole('group', { name: 'Arve toimingud' })

describe('selected invoice', () => {
  it('reads as a document: buyer, payment facts, lines and totals', async () => {
    renderAt('#/', createMemoryRepo({ profile, invoices: [invoice()] }))
    const article = await doc()
    expect(within(article).getByRole('heading', { name: 'Arve 2026-0004' })).toBeInTheDocument()
    expect(within(article).getByText('Kalda Puutöö OÜ')).toBeInTheDocument()
    expect(within(article).getByText('14520336')).toBeInTheDocument()
    expect(within(article).getByText('202600046')).toBeInTheDocument()
    expect(within(article).getByText('Veebipoe arendus')).toBeInTheDocument()
    // 18 × 65 + 24,90 = 1194,90 net, 24% VAT 286,78, total 1481,68.
    expect(within(article).getByText('Tasumisele kuulub').nextElementSibling).toHaveTextContent('1 481,68')
    expect(within(article).getByText('sh käibemaks 286,78 €')).toBeInTheDocument()
    expect(within(article).getByText(/Väljastatud arve on lukustatud/)).toBeInTheDocument()
  })

  it('offers "Continue editing" as the one action of a draft, and deleting it under "More"', async () => {
    const draft = invoice({ number: '', status: 'draft', issuedAt: undefined })
    const repo = createMemoryRepo({ profile, invoices: [draft] })
    renderAt('#/', repo)
    const article = await doc()
    expect(within(article).getByRole('heading', { name: 'Arve mustand' })).toBeInTheDocument()
    const primary = within(actions(article)).getByRole('link', { name: 'Jätka koostamist' })
    expect(primary).toHaveAttribute('href', `#/invoices/${draft.id}`)
    expect(within(article).queryByRole('button', { name: 'Märgi tasutuks' })).not.toBeInTheDocument()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Kustuta mustand' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas kustutada mustand?' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Kustuta' }))
    })
    expect(repo.deleteInvoice).toHaveBeenCalledWith(draft.id)
    expect(await screen.findByText('Esimene arve ootab')).toBeInTheDocument()
  })

  it('asks to send an issued invoice first, then to mark it paid', async () => {
    const inv = invoice()
    const settings = { ...createDefaultSettings(), googleClientId: '1-own.apps.googleusercontent.com' }
    const repo = createMemoryRepo({ profile, settings, invoices: [inv] })
    renderAt('#/', repo)
    const article = await doc()
    const send = within(actions(article)).getByRole('button', { name: 'Saada e-kirjaga' })
    expect(send).toHaveClass('btn-primary')
    fireEvent.click(send)
    const dialog = await screen.findByRole('dialog', { name: 'Saada arve 2026-0004' })
    expect(within(dialog).getByLabelText(/^Saaja/)).toHaveValue('arved@kalda.ee')
    const gmail = within(dialog).getByRole('button', { name: 'Saada Gmailiga' })
    await waitFor(() => expect(gmail).toBeEnabled())
    await act(async () => {
      fireEvent.click(gmail)
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Sent: the next step is the payment.
    const paid = await within(actions(article)).findByRole('button', { name: 'Märgi tasutuks' })
    expect(paid).toHaveClass('btn-primary')
    expect(within(article).getByText(/saadetud \d{2}\.\d{2}\.\d{4}/)).toBeInTheDocument()
    fireEvent.click(paid)
    const confirm = await screen.findByRole('dialog', { name: 'Märgi arve 2026-0004 tasutuks' })
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Märgi tasutuks' }))
    })
    expect(repo.markInvoicePaid).toHaveBeenCalledWith(inv.id, today)
    // Paid: no primary action left, but it can be reopened from "More".
    await waitFor(() => expect(within(actions(article)).queryByRole('button', { name: 'Märgi tasutuks' })).not.toBeInTheDocument())
    expect(actions(article).querySelector('.btn-primary')).toBeNull()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Märgi tasumata' }))
    })
    expect(repo.markInvoiceUnpaid).toHaveBeenCalledWith(inv.id)
  })

  it('offers a payment reminder for an overdue invoice', async () => {
    const inv = invoice({ issueDate: addDaysISO(today, -30), dueDate: addDaysISO(today, -16) })
    renderAt('#/', createMemoryRepo({ profile, invoices: [inv] }))
    const article = await doc()
    expect(within(article).getByText('Tasumata, tähtaeg ületatud 16 päeva')).toHaveClass('tone-danger')
    fireEvent.click(within(actions(article)).getByRole('button', { name: 'Saada meeldetuletus' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Teema')).toHaveValue('Meeldetuletus: arve 2026-0004 on tasumata')
  })

  it('keeps the other actions in one "More" menu and cancels through the repository', async () => {
    const inv = invoice()
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt('#/', repo)
    const article = await doc()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Salvesta Drive’i',
      'E-arve (XML)',
      'Prindi',
      'Tee koopia',
      'Koosta kreeditarve',
      'Tühista arve',
    ])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Tühista arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas tühistada arve 2026-0004?' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Tühista arve' }))
    })
    expect(repo.cancelInvoice).toHaveBeenCalledWith(inv.id)
    expect(await within(article).findByText('Tühistatud')).toBeInTheDocument()
  })

  it('shows the real PDF page only on demand', async () => {
    renderAt('#/', createMemoryRepo({ profile, invoices: [invoice()] }))
    const article = await doc()
    expect(renderInvoicePdf).not.toHaveBeenCalled()
    const toggle = within(article).getByRole('button', { name: 'Näita arvet' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(await within(article).findByRole('img', { name: 'Arve PDF-eelvaade' })).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    expect(renderInvoicePdf).toHaveBeenCalledTimes(1)
    expect(within(article).queryByText('Veebipoe arendus')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(within(article).getByText('Veebipoe arendus')).toBeInTheDocument()
  })

  it('opens a tapped invoice with a way back to the list, and selects rows from the list', async () => {
    const a = invoice({ number: '2026-0001', buyer: { kind: 'company', name: 'Esimene OÜ', address: profile.address } })
    const b = invoice({ number: '2026-0002', buyer: { kind: 'company', name: 'Teine OÜ', address: profile.address } })
    renderAt(`#/?id=${b.id}`, createMemoryRepo({ profile, invoices: [a, b] }))
    const article = await doc()
    expect(within(article).getByRole('heading', { name: 'Arve 2026-0002' })).toBeInTheDocument()
    expect(within(article).getByRole('link', { name: 'Arved' })).toHaveAttribute('href', '#/')
    const rowA = screen.getByText('2026-0001').closest('a')!
    expect(rowA).not.toHaveAttribute('aria-current')
    fireEvent.click(rowA)
    expect(await screen.findByRole('heading', { name: 'Arve 2026-0001' })).toBeInTheDocument()
    expect(screen.getByText('2026-0001').closest('a')).toHaveAttribute('aria-current', 'true')
  })
})
