import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../../App'
import { createDefaultSettings, newId, type Invoice, type RecurringRule } from '../../../domain'
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
    expect(within(article).getByText(/Arve on väljastatud ja lukustatud\. Kuni dokumenti pole kliendile saadetud/)).toBeInTheDocument()
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
    // Sent (recorded as an event): the next step is the payment.
    expect(repo.addInvoiceEvent).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: inv.id, kind: 'sent', note: 'arved@kalda.ee' }))
    const paid = await within(actions(article)).findByRole('button', { name: 'Märgi tasutuks' })
    expect(paid).toHaveClass('btn-primary')
    expect(within(article).getByText(/saadetud \d{2}\.\d{2}\.\d{4}/)).toBeInTheDocument()
    // One click, no dialog: paid today.
    await act(async () => {
      fireEvent.click(paid)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(repo.markInvoicePaid).toHaveBeenCalledWith(inv.id, today)
    expect(await screen.findByText('Arve 2026-0004 märgiti tasutuks.')).toBeInTheDocument()
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
    expect(within(article).getByText('Tasumata, 16 päeva üle tähtaja')).toHaveClass('tone-danger')
    fireEvent.click(within(actions(article)).getByRole('button', { name: 'Saada meeldetuletus' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Teema')).toHaveValue('Meeldetuletus: arve 2026-0004 on tasumata')
    expect((within(dialog).getByLabelText('Sõnum') as HTMLTextAreaElement).value).not.toContain('viivis')
  })

  it('states the late interest, logs reminders and makes the second one firmer', async () => {
    const inv = invoice({ issueDate: addDaysISO(today, -30), dueDate: addDaysISO(today, -16), lateInterestPercentPerDay: 0.05 })
    const first = addDaysISO(today, -9)
    const repo = createMemoryRepo({ profile, invoices: [inv], events: [{ id: 'e1', invoiceId: inv.id, kind: 'reminder', at: `${first}T10:00:00.000Z` }] })
    renderAt('#/', repo)
    const article = await doc()
    const [y, m, d] = first.split('-')
    expect(await within(article).findByText(`Meeldetuletus: ${d}.${m}.${y}`)).toBeInTheDocument()
    fireEvent.click(within(actions(article)).getByRole('button', { name: 'Saada meeldetuletus' }))
    const dialog = await screen.findByRole('dialog', { name: 'Teine meeldetuletus arve 2026-0004 kohta' })
    expect(within(dialog).getByLabelText('Teema')).toHaveValue('Teine meeldetuletus: arve 2026-0004 on endiselt tasumata')
    // 1481,68 × 0,05% × 16 days = 11,85
    const body = (within(dialog).getByLabelText('Sõnum') as HTMLTextAreaElement).value.replace(/[\u00a0\u202f]/g, ' ')
    expect(body).toContain('Arvel kokku lepitud viivis on 0,05% päevas. Makse on hilinenud 16 päeva ja tänaseks on viivist kogunenud 11,85 €.')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ava e-posti rakendus' }))
    })
    expect(repo.addInvoiceEvent).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: inv.id, kind: 'reminder' }))
    expect(await within(article).findByText(/^Meeldetuletused: \d{2}\.\d{2}\.\d{4}, \d{2}\.\d{2}\.\d{4}$/)).toBeInTheDocument()
    // Just reminded: the main action is the payment again, another reminder stays under "More".
    expect(within(actions(article)).getByRole('button', { name: 'Märgi tasutuks' })).toHaveClass('btn-primary')
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    expect(screen.getByRole('menuitem', { name: 'Saada uus meeldetuletus' })).toBeInTheDocument()
  })

  it('moves the sent dates kept by earlier versions into the invoice history once', async () => {
    const inv = invoice()
    localStorage.setItem('invoice-generator:sentInvoices', JSON.stringify({ [inv.id]: '2026-01-06' }))
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt('#/', repo)
    const article = await doc()
    expect(await within(article).findByText(/saadetud 06\.01\.2026/)).toBeInTheDocument()
    expect(repo.addInvoiceEvent).toHaveBeenCalledTimes(1)
    expect(repo.addInvoiceEvent).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: inv.id, kind: 'sent', at: '2026-01-06T12:00:00.000Z' }))
    expect(localStorage.getItem('invoice-generator:sentInvoices')).toBeNull()
  })

  it('undoes "mark paid" from the toast and lets the date be changed afterwards', async () => {
    const inv = invoice()
    const repo = createMemoryRepo({ profile, invoices: [inv], events: [{ id: 's', invoiceId: inv.id, kind: 'sent', at: new Date().toISOString() }] })
    renderAt('#/', repo)
    const article = await doc()
    await act(async () => {
      fireEvent.click(await within(actions(article)).findByRole('button', { name: 'Märgi tasutuks' }))
    })
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Võta tagasi' }))
    })
    expect(repo.markInvoiceUnpaid).toHaveBeenCalledWith(inv.id)
    expect(await screen.findByText('Arve 2026-0004 on jälle tasumata.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(await within(actions(article)).findByRole('button', { name: 'Märgi tasutuks' }))
    })
    fireEvent.click(await within(article).findByRole('button', { name: 'muuda kuupäeva' }))
    const dialog = await screen.findByRole('dialog', { name: 'Arve 2026-0004 laekumise kuupäev' })
    const yesterday = addDaysISO(today, -1)
    fireEvent.change(within(dialog).getByLabelText('Laekumise kuupäev'), { target: { value: yesterday } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Salvesta' }))
    })
    expect(repo.markInvoicePaid).toHaveBeenLastCalledWith(inv.id, yesterday)
  })

  it('keeps the other actions in one "More" menu and cancels through the repository', async () => {
    const inv = invoice()
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt('#/', repo)
    const article = await doc()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Märgi saadetuks',
      'Salvesta Drive’i',
      'E-arve (XML)',
      'Prindi',
      'Ava muutmiseks',
      'Tee koopia',
      'Koosta kreeditarve',
      'Tasutud muul kuupäeval…',
      'Tühista arve',
      'Kustuta arve',
    ])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Tühista arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas tühistada arve 2026-0004?' })
    expect(within(dialog).getByText(/tühistatakse kreeditarvega/)).toBeInTheDocument()
    expect(within(dialog).getByText(/kreeditarve summas 1\s481,68\s€/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Tühista kreeditarvega' }))
    })
    // One step: a full credit note is saved and issued, then the invoice is cancelled.
    const credit = repo.saveInvoice.mock.calls[0][0] as Invoice
    expect(credit).toMatchObject({ type: 'credit-note', creditedInvoiceNumber: '2026-0004', status: 'draft' })
    expect(credit.lines.map((l) => l.quantity)).toEqual([-18, -1])
    expect(repo.issueInvoice).toHaveBeenCalledWith(credit.id)
    expect(repo.cancelInvoice).toHaveBeenCalledWith(inv.id)
    // The cancelled invoice stays selected and links to its credit note.
    const after = await doc()
    expect(within(after).getByRole('heading', { name: 'Arve 2026-0004' })).toBeInTheDocument()
    expect(await within(after).findByText('Tühistatud')).toBeInTheDocument()
    expect(within(after).getByRole('link', { name: '2026-0001' })).toBeInTheDocument()
    expect(await screen.findByText('Arve 2026-0004 tühistati kreeditarvega 2026-0001.')).toBeInTheDocument()
  })

  it('opens a credit note draft when no credit note comes to exactly the remainder', async () => {
    // 124.04 € invoiced and 62.01 € credited by hand: one 24 % line cannot credit exactly 62.03 €.
    const inv = invoice({ lines: [{ id: newId(), description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 100.03, vatRate: 24 }] })
    const manual = invoice({
      number: '2026-0005',
      type: 'credit-note',
      creditedInvoiceNumber: '2026-0004',
      referenceNumber: undefined,
      lines: [{ id: newId(), description: 'Hinnaalandus', quantity: -1, unit: '', unitPrice: 50.01, vatRate: 24 }],
    })
    const repo = createMemoryRepo({ profile, invoices: [inv, manual] })
    renderAt(`#/?id=${inv.id}`, repo)
    const article = await doc()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tühista arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas tühistada arve 2026-0004?' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Tühista kreeditarvega' }))
    })
    expect(repo.issueInvoice).not.toHaveBeenCalled()
    expect(repo.cancelInvoice).not.toHaveBeenCalled()
    const draft = repo.saveInvoice.mock.calls[0][0] as Invoice
    expect(draft).toMatchObject({ type: 'credit-note', status: 'draft', creditedInvoiceNumber: '2026-0004' })
    expect(await screen.findByText(/Täpselt jäägi 62,03\s€ suurust kreeditarvet ei õnnestunud automaatselt koostada/)).toBeInTheDocument()
    await waitFor(() => expect(window.location.hash).toBe(`#/invoices/${draft.id}`))
  })

  it('keeps a partial credit note one link away from the cancel dialog', async () => {
    const inv = invoice()
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt('#/', repo)
    const article = await doc()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tühista arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas tühistada arve 2026-0004?' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Krediteeri ainult osa summast/ }))
    })
    expect(repo.issueInvoice).not.toHaveBeenCalled()
    expect(repo.cancelInvoice).not.toHaveBeenCalled()
    const draft = repo.saveInvoice.mock.calls[0][0] as Invoice
    expect(draft).toMatchObject({ type: 'credit-note', status: 'draft' })
    await waitFor(() => expect(window.location.hash).toBe(`#/invoices/${draft.id}`))
  })

  it('shows a quote with its validity and without payment details', async () => {
    const q = invoice({ type: 'quote', number: 'HP-2026-001', referenceNumber: undefined, validUntil: addDaysISO(today, 10), dueDate: addDaysISO(today, 10) })
    renderAt(`#/?id=${q.id}`, createMemoryRepo({ profile, invoices: [q] }))
    const article = (await screen.findByRole('heading', { level: 2, name: 'Hinnapakkumine HP-2026-001' })).closest('article')!
    const [y, m, d] = addDaysISO(today, 10).split('-')
    expect(within(article).getByText(`Kehtib kuni ${d}.${m}.${y}`)).toBeInTheDocument()
    expect(within(article).queryByText('Pangakonto')).not.toBeInTheDocument()
    expect(within(article).queryByText('Maksetähtaeg')).not.toBeInTheDocument()
    expect(within(article).queryByRole('button', { name: 'Märgi tasutuks' })).not.toBeInTheDocument()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)
    expect(items).not.toContain('E-arve (XML)')
    expect(items).not.toContain('Koosta kreeditarve')
    expect(items).toContain('Tühista hinnapakkumine')
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

describe('deleting and reopening', () => {
  const sent = (invoiceId: string) => ({ id: 'e1', invoiceId, kind: 'sent' as const, at: `${addDaysISO(today, -9)}T10:00:00.000Z` })

  it('explains what deleting a sent invoice means, offers the credit note, and can undo it', async () => {
    const inv = invoice()
    const repo = createMemoryRepo({ profile, invoices: [inv], events: [sent(inv.id)] })
    renderAt(`#/?id=${inv.id}`, repo)
    const article = await doc()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)
    expect(items).not.toContain('Ava muutmiseks')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Kustuta arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas kustutada arve 2026-0004?' })
    expect(within(dialog).getByText(/Arve on kliendile juba saadetud/)).toBeInTheDocument()
    expect(within(dialog).getByText(/säilitada 7 aastat \(RPS § 12\)/)).toHaveTextContent(
      'Numeratsiooni jääb lünk (2026-0004). Kui dokument on juba kliendile saadetud, tasutud, krediteeritud või tühistatud, selle numbrit uuesti ei kasutata.',
    )
    expect(within(dialog).getByRole('button', { name: 'Koosta kreeditarve' })).toHaveClass('btn-primary')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Kustuta' }))
    })
    expect(repo.deleteInvoice).toHaveBeenCalledWith(inv.id)
    expect(await repo.listInvoices()).toEqual([])
    expect(await screen.findByText('Arve 2026-0004 on kustutatud.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Võta tagasi' }))
    })
    expect(repo.restoreDeleted).toHaveBeenCalled()
    expect(await screen.findByText('Arve 2026-0004 on taastatud.')).toBeInTheDocument()
    expect((await repo.listInvoices()).map((i) => i.id)).toEqual([inv.id])
  })

  it('lists the credit notes deleted with an invoice and opens the credit note instead on request', async () => {
    const inv = invoice({ status: 'paid', paidAt: today })
    const cn = invoice({ id: 'cn', number: '2026-0005', type: 'credit-note', creditedInvoiceNumber: '2026-0004', lines: [{ id: 'l', description: 'Allahindlus', quantity: -1, unit: 'tk', unitPrice: 10, vatRate: 24 }] })
    const repo = createMemoryRepo({ profile, invoices: [inv, cn] })
    renderAt(`#/?id=${inv.id}`, repo)
    const article = await doc()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Kustuta arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas kustutada arve 2026-0004?' })
    expect(within(dialog).getByText('Koos arvega kustutatakse ka selle kreeditarve 2026-0005.')).toBeInTheDocument()
    const [y, m, d] = today.split('-')
    expect(within(dialog).getByText(`Arve on märgitud tasutuks (${d}.${m}.${y}). Sel juhul tuleks see tühistada kreeditarvega, mitte kustutada.`)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Kui arve on kliendile juba saadetud/)).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Koosta kreeditarve' }))
    })
    expect(repo.deleteInvoice).not.toHaveBeenCalled()
    const draft = repo.saveInvoice.mock.calls[0][0] as Invoice
    expect(draft).toMatchObject({ type: 'credit-note', status: 'draft', creditedInvoiceNumber: '2026-0004' })
  })

  it('says that undoing restores the credit notes deleted with the invoice too', async () => {
    const inv = invoice()
    const cn = invoice({ id: 'cn', number: '2026-0005', type: 'credit-note', creditedInvoiceNumber: '2026-0004', lines: [{ id: 'l', description: 'Allahindlus', quantity: -1, unit: 'tk', unitPrice: 10, vatRate: 24 }] })
    const repo = createMemoryRepo({ profile, invoices: [inv, cn] })
    renderAt(`#/?id=${inv.id}`, repo)
    const article = await doc()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Kustuta arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas kustutada arve 2026-0004?' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Kustuta' }))
    })
    expect(await screen.findByText('Arve 2026-0004 on kustutatud koos seotud kreeditarvetega.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Võta tagasi' }))
    })
    expect(await screen.findByText('Arve 2026-0004 on taastatud koos seotud kreeditarvetega.')).toBeInTheDocument()
  })

  it('warns about a paid invoice with nothing left to credit and offers no credit note', async () => {
    const inv = invoice({ status: 'paid', paidAt: today })
    const lines = inv.lines.map((l) => ({ ...l, id: newId(), quantity: -l.quantity }))
    const cn = invoice({ id: 'cn', number: '2026-0005', type: 'credit-note', creditedInvoiceNumber: '2026-0004', lines })
    renderAt(`#/?id=${inv.id}`, createMemoryRepo({ profile, invoices: [inv, cn] }))
    const article = await doc()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Kustuta arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas kustutada arve 2026-0004?' })
    expect(within(dialog).getByText(/Arve on märgitud tasutuks .* Kliendile saadetud või tasutud dokument peaks raamatupidamises alles jääma\./)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Koosta kreeditarve' })).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/vabaneb/)).not.toBeInTheDocument()
  })

  it('says that deleting the only credit note of a cancelled invoice restores the invoice', async () => {
    const inv = invoice({ status: 'cancelled' })
    const cn = invoice({ id: 'cn', number: '2026-0005', type: 'credit-note', creditedInvoiceNumber: '2026-0004', lines: [{ id: 'l', description: 'Tagasi', quantity: -1, unit: 'tk', unitPrice: 10, vatRate: 24 }] })
    const repo = createMemoryRepo({ profile, invoices: [inv, cn] })
    renderAt('#/?id=cn', repo)
    await screen.findByRole('heading', { level: 2, name: 'Kreeditarve 2026-0005' })
    fireEvent.click(screen.getByRole('button', { name: 'Rohkem' }))
    // A credit note is not cancelled like an invoice.
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'Tühista arve' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Kustuta kreeditarve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas kustutada kreeditarve 2026-0005?' })
    expect(within(dialog).getByText('Arve 2026-0004 jääb alles ega ole enam tühistatud, sest ükski teine kreeditarve seda ei krediteeri. Arve on jälle tasumata.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Kustuta' }))
    })
    expect((await repo.getInvoice(inv.id))?.status).toBe('issued')
  })

  it('records the deleted documents for the automatic backup before deleting, and takes them back on failure', async () => {
    const key = 'invoice-generator:deletedSinceBackup'
    localStorage.removeItem(key)
    const inv = invoice()
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    let seen: string | null = null
    const remove = repo.deleteInvoice.getMockImplementation()!
    repo.deleteInvoice.mockImplementationOnce(async () => {
      seen = localStorage.getItem(key)
      throw new Error('Andmebaas ei vasta')
    })
    renderAt(`#/?id=${inv.id}`, repo)
    const article = await doc()
    const openDialog = async () => {
      fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Kustuta arve' }))
      return screen.findByRole('dialog', { name: 'Kas kustutada arve 2026-0004?' })
    }
    let dialog = await openDialog()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Kustuta' }))
    })
    expect(JSON.parse(seen!)).toMatchObject({ count: 1 })
    expect(localStorage.getItem(key)).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Loobu' }))
    repo.deleteInvoice.mockImplementation(remove)
    dialog = await openDialog()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Kustuta' }))
    })
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ count: 1 })
    localStorage.removeItem(key)
  })

  it('says why a sent invoice, credit note or quote cannot be reopened, in words for its type', async () => {
    const inv = invoice()
    const cn = invoice({ id: 'cn', number: '2026-0005', type: 'credit-note', creditedInvoiceNumber: '2026-0004', lines: [{ id: 'l', description: 'Tagasi', quantity: -1, unit: 'tk', unitPrice: 10, vatRate: 24 }] })
    const q = invoice({ id: 'q', type: 'quote', number: 'HP-2026-001', referenceNumber: undefined, validUntil: addDaysISO(today, 10), dueDate: addDaysISO(today, 10) })
    const events = [sent(inv.id), { ...sent(cn.id), id: 'e2' }, { ...sent(q.id), id: 'e3' }]
    const [y, m, d] = addDaysISO(today, -9).split('-')
    const view = renderAt(`#/?id=${inv.id}`, createMemoryRepo({ profile, invoices: [inv, cn, q], events }))
    let article = await doc()
    expect(article.querySelector('.doc-lock')).toHaveTextContent(`Arve on väljastatud ja lukustatud. Saadetud ${d}.${m}.${y} – vea parandamiseks koosta kreeditarve.`)
    expect(within(article).getByRole('button', { name: 'koosta kreeditarve' })).toBeInTheDocument()
    view.unmount()
    renderAt('#/?id=cn', createMemoryRepo({ profile, invoices: [inv, cn, q], events }))
    article = (await screen.findByRole('heading', { level: 2, name: 'Kreeditarve 2026-0005' })).closest('article')!
    expect(within(article).getByText(`Kreeditarve on väljastatud ja lukustatud. Saadetud ${d}.${m}.${y}, seega seda enam muuta ei saa.`)).toBeInTheDocument()
    cleanup()
    renderAt('#/?id=q', createMemoryRepo({ profile, invoices: [inv, cn, q], events }))
    article = (await screen.findByRole('heading', { level: 2, name: 'Hinnapakkumine HP-2026-001' })).closest('article')!
    expect(within(article).getByText(`Hinnapakkumine on väljastatud ja lukustatud. Saadetud ${d}.${m}.${y} – muutmiseks tee sellest koopia.`)).toBeInTheDocument()
  })

  it('explains reopening a quote in words for quotes', async () => {
    const q = invoice({ type: 'quote', number: 'HP-2026-001', referenceNumber: undefined, validUntil: addDaysISO(today, 10), dueDate: addDaysISO(today, 10) })
    renderAt(`#/?id=${q.id}`, createMemoryRepo({ profile, invoices: [q] }))
    const article = (await screen.findByRole('heading', { level: 2, name: 'Hinnapakkumine HP-2026-001' })).closest('article')!
    fireEvent.click(within(article).getByRole('button', { name: 'muutmiseks avada' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas avada hinnapakkumine HP-2026-001 muutmiseks?' })
    expect(within(dialog).getByText('Nii saab parandada ainult hinnapakkumist, mida pole veel kliendile saadetud. Saadetud pakkumise muutmiseks tee sellest koopia.')).toBeInTheDocument()
  })

  it('reopens an unsent invoice for editing; it keeps its number', async () => {
    const inv = invoice()
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt(`#/?id=${inv.id}`, repo)
    const article = await doc()
    expect(within(article).getByText(/Kuni dokumenti pole kliendile saadetud, saad selle veel/)).toBeInTheDocument()
    fireEvent.click(within(article).getByRole('button', { name: 'muutmiseks avada' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas avada arve 2026-0004 muutmiseks?' })
    expect(within(dialog).getByText(/Arve muutub uuesti mustandiks ja number 2026-0004 jääb samaks/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ava muutmiseks' }))
    })
    expect(repo.reopenInvoice).toHaveBeenCalledWith(inv.id)
    await waitFor(() => expect(window.location.hash).toBe(`#/invoices/${inv.id}`))
    expect(await screen.findByRole('heading', { level: 1, name: 'Arve 2026-0004' })).toBeInTheDocument()
    expect(screen.getByText('Muutmiseks avatud: number 2026-0004 jääb samaks. Kui muudatused on tehtud, väljasta dokument uuesti.')).toBeInTheDocument()
    expect(screen.getByText('Väljastatakse uuesti sama numbriga 2026-0004.')).toBeInTheDocument()
    expect(screen.getByLabelText('Kirjeldus 1')).not.toBeDisabled()
  })
})

describe('year total', () => {
  it('nets an invoice cancelled with a credit note to zero and leaves out one cancelled without', async () => {
    const year = today.slice(0, 4)
    const open = invoice({ number: `${year}-0001`, issueDate: today })
    const credited = invoice({ number: `${year}-0002`, issueDate: today, status: 'cancelled' })
    const credit = invoice({
      number: `${year}-0003`,
      issueDate: today,
      type: 'credit-note',
      creditedInvoiceNumber: `${year}-0002`,
      lines: credited.lines.map((l) => ({ ...l, id: newId(), quantity: -l.quantity })),
    })
    const voided = invoice({ number: `${year}-0004`, issueDate: today, status: 'cancelled' })
    renderAt('#/', createMemoryRepo({ profile, invoices: [open, credited, credit, voided] }))
    expect(await screen.findByText(new RegExp(`${year}\\. aastal on arveid väljastatud`))).toHaveTextContent(/väljastatud 1\s481,68\s€ eest/)
  })
})

describe('recurring source cancelled', () => {
  const rule = (invoiceId: string): RecurringRule => ({ id: 'r1', sourceInvoiceId: invoiceId, interval: 'monthly', nextDate: '2099-01-05', active: true, createdAt: '2026-01-05T10:00:00Z', updatedAt: '2026-01-05T10:00:00Z' })

  it('stops the rule when the invoice is cancelled and says so', async () => {
    const inv = invoice()
    const repo = createMemoryRepo({ profile, invoices: [inv], recurringRules: [rule(inv.id)] })
    renderAt(`#/?id=${inv.id}`, repo)
    const article = await doc()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tühista arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas tühistada arve 2026-0004?' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Tühista kreeditarvega' }))
    })
    await waitFor(() => expect(repo.saveRecurringRule).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', active: false })))
    expect(await screen.findByText(/Ka selle arve kordamine on lõpetatud/)).toBeInTheDocument()
  })

  it('lets a rule still running on a cancelled invoice be stopped, not changed', async () => {
    const inv = invoice({ status: 'cancelled' })
    const repo = createMemoryRepo({ profile, invoices: [inv], recurringRules: [rule(inv.id)] })
    renderAt(`#/?id=${inv.id}`, repo)
    const select = (await screen.findByLabelText('Kordumine')) as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['none', 'monthly'])
    await act(async () => {
      fireEvent.change(select, { target: { value: 'none' } })
    })
    await waitFor(() => expect(repo.saveRecurringRule).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', active: false })))
  })
})
