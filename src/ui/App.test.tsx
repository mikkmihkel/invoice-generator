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

    // Step 1 (company): required fields are enforced before moving on.
    fireEvent.click(screen.getByRole('button', { name: 'Edasi' }))
    expect(await screen.findByText('Sisesta ettevõtte nimi.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^Nimi/), { target: { value: 'Minu Firma OÜ' } })
    fireEvent.change(screen.getByLabelText(/^Registrikood/), { target: { value: '12345678' } })
    fireEvent.change(screen.getByLabelText(/^Tänav/), { target: { value: 'Pikk 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edasi' }))

    // Step 2 (bank account and logo): an IBAN is required.
    expect(await screen.findByRole('heading', { name: 'Pangakonto ja logo' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edasi' }))
    expect(await screen.findByText('Lisa vähemalt üks pangakonto (IBAN).')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^IBAN/), { target: { value: 'EE38 2200 2210 2014 5685' } })
    // Estonian IBANs prefill bank name / BIC.
    expect(screen.getByLabelText(/^BIC/)).toHaveValue('HABAEE2X')
    fireEvent.click(screen.getByRole('button', { name: 'Edasi' }))

    // Step 3 (invoice design, defaults behind "Lisavalikud"): pick two colours, then save.
    expect(await screen.findByRole('heading', { name: 'Arve kujundus', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Lisavalikud').closest('details')).not.toHaveAttribute('open')
    fireEvent.click(screen.getByRole('radio', { name: 'Kahevärviline' }))
    fireEvent.change(screen.getByLabelText('Lisavärv'), { target: { value: '#E07A10' } })
    expect(repo.saveProfile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Salvesta ja alusta' }))

    expect(await screen.findByText('Esimene arve ootab')).toBeInTheDocument()
    expect(repo.saveProfile).toHaveBeenCalledTimes(1)
    const saved = repo.saveProfile.mock.calls[0][0]
    expect(saved.name).toBe('Minu Firma OÜ')
    expect(saved.registryCode).toBe('12345678')
    expect(saved.bankAccounts).toEqual([expect.objectContaining({ iban: 'EE382200221020145685' })])
    expect(saved.defaults).toMatchObject({ colorMode: 'duo', secondaryColor: '#e07a10' })
  })

  it('prefills the company from the e-Business Register', async () => {
    const repo = createMemoryRepo()
    renderAt('#/', repo)

    const search = await screen.findByRole('combobox')
    fireEvent.change(search, { target: { value: 'päikese' } })
    fireEvent.click(await screen.findByRole('option', { name: /Päikese Tarkvara OÜ/ }))

    expect(await screen.findByLabelText(/^Nimi/)).toHaveValue('Päikese Tarkvara OÜ')
    expect(screen.getByLabelText(/^Registrikood/)).toHaveValue('16543210')
    expect(screen.getByLabelText(/^KMKR number/)).toHaveValue('EE102345676')
    expect(screen.getByLabelText(/^Linn/)).toHaveValue('Tallinn')
    expect(screen.getByLabelText('Ettevõte on käibemaksukohustuslane')).toBeChecked()
  })

  it('hides the "type 2 characters" hint once searching and warns about companies in liquidation', async () => {
    const repo = createMemoryRepo()
    renderAt('#/', repo)

    const search = await screen.findByRole('combobox')
    expect(screen.getByText(/Sisesta vähemalt 2 tähemärki/)).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'vana' } })
    const option = await screen.findByRole('option', { name: /Vana Firma OÜ/ })
    expect(screen.queryByText(/Sisesta vähemalt 2 tähemärki/)).not.toBeInTheDocument()
    fireEvent.click(option)

    expect(await screen.findByText(/staatus äriregistris on „Likvideerimisel“/)).toBeInTheDocument()
    expect(await screen.findByLabelText(/^Nimi/)).toHaveValue('Vana Firma OÜ')
  })

  it('blocks saving with an invalid registry code', async () => {
    const repo = createMemoryRepo()
    renderAt('#/', repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Sisesta andmed käsitsi' }))
    fireEvent.change(screen.getByLabelText(/^Nimi/), { target: { value: 'Minu Firma OÜ' } })
    // Empty registry code: a warning, not a blocker.
    expect(screen.getByText(/Registrikood on lisamata/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Registrikood/), { target: { value: '12345679' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edasi' }))
    expect(await screen.findByText(/Registrikood on vigane/)).toBeInTheDocument()
    // Still on the company step, nothing saved.
    expect(screen.queryByLabelText(/^IBAN/)).not.toBeInTheDocument()
    expect(repo.saveProfile).not.toHaveBeenCalled()
  })
})

describe('company page', () => {
  it('focuses the field named in the link from the invoice validation panel', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    renderAt('#/company?focus=vatNumber', repo)
    const input = await screen.findByLabelText(/^KMKR number/)
    await waitFor(() => expect(input).toHaveFocus())
  })
})

describe('invoice editor', () => {
  it('updates line and grand totals live while editing lines', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    renderAt('#/invoices/new', repo)

    fireEvent.change(await screen.findByLabelText('Kogus'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Ühikuhind'), { target: { value: '100,5' } })

    await waitFor(() => expect(screen.getByTestId('total-net')).toHaveTextContent('201,00'))
    expect(screen.getByTestId('total-gross')).toHaveTextContent('249,24')
    expect(screen.getByText(/Käibemaks 24%/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lisa rida' }))
    const prices = screen.getAllByLabelText('Ühikuhind')
    expect(prices).toHaveLength(2)
    fireEvent.change(prices[1], { target: { value: '10' } })
    fireEvent.change(screen.getAllByLabelText('Käibemaks')[1], { target: { value: '9' } })

    await waitFor(() => expect(screen.getByTestId('total-gross')).toHaveTextContent('260,14'))
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
    fireEvent.change(await screen.findByLabelText('Ühikuhind'), { target: { value: '50' } })
    await waitFor(() => expect(screen.getByTestId('total-gross')).toHaveTextContent('50,00'))
    expect(screen.queryByTestId('total-net')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Käibemaks')).not.toBeInTheDocument()
  })

  it('lists legal problems, blocks issuing until fixed, then issues and locks the invoice', async () => {
    const client = newClient({
      name: 'Ostja AS',
      registryCode: '10000001',
      address: { street: 'Rüütli 1', city: 'Pärnu', postalCode: '80010', country: 'EE' },
      email: 'arved@ostja.ee',
    })
    const repo = createMemoryRepo({ profile: sampleProfile(), clients: [client] })
    renderAt('#/invoices/new', repo)

    const panel = (await screen.findByRole('heading', { name: 'Nõuete kontroll' })).closest('section')!
    // A blank draft keeps the list folded to its count; pressing Issue opens it instead of the dialog.
    expect(within(panel).queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Väljasta arve' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Väljasta arve' }))
    expect(within(panel).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // The buyer picker searches saved clients (and the register) as you type.
    fireEvent.change(screen.getByLabelText('Klient'), { target: { value: 'ostja' } })
    fireEvent.click(await screen.findByRole('option', { name: /Ostja AS/ }))
    expect(await screen.findByText('Ostja AS')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Kirjeldus 1'), { target: { value: 'Veebilehe arendus' } })
    fireEvent.change(screen.getByLabelText('Ühikuhind'), { target: { value: '400' } })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Väljasta arve' })).not.toHaveAttribute('aria-disabled'))
    expect(within(panel).queryAllByText(/./, { selector: '.issue-error *' })).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Väljasta arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Väljasta arve' })
    expect(within(dialog).getByText(/lukustatakse/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Väljasta' }))
    })

    expect(await screen.findByText(/väljastatud ja lukustatud/)).toBeInTheDocument()
    expect(repo.issueInvoice).toHaveBeenCalledTimes(1)
    // The next step is offered right away: the issued number and the ways to send it.
    const next = screen.getByRole('region', { name: /^Arve \d{4}-\d{4} on väljastatud$/ })
    expect(within(next).getByRole('button', { name: /Saada e-kirjaga/ })).toHaveTextContent('arved@ostja.ee')
    expect(within(next).getByRole('button', { name: /Laadi PDF/ })).toBeInTheDocument()
    expect(within(next).getByRole('button', { name: /Salvesta Drive’i/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Märgi tasutuks' })).toBeInTheDocument()
    expect(screen.getByLabelText('Kirjeldus')).toBeDisabled()
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
    const row = screen.getByText('2026-0001').closest('li')!
    expect(within(row).getByText(/^\d+ päeva üle tähtaja$/)).toBeInTheDocument()
    expect(within(row).getByText(/124,00/)).toBeInTheDocument()
    // One sentence sums up what is owed, with the overdue part called out.
    expect(screen.getByText(/^Tasumata/, { selector: 'p' })).toHaveTextContent(/^Tasumata 124,00 €, neist üle tähtaja 124,00 €$/)
    // The backup reminder is shown while no backup has been made.
    expect(screen.getByText(/Varukoopiat ei ole veel tehtud/)).toBeInTheDocument()
  })
})

describe('credit notes', () => {
  const profile = sampleProfile()
  const base = (patch: Record<string, unknown>) => ({
    id: newId(),
    number: '2026-0001',
    type: 'invoice' as const,
    status: 'issued' as const,
    issueDate: '2026-01-05',
    dueDate: '2026-01-19',
    seller: { ...profile },
    buyer: { kind: 'company' as const, name: 'Ostja AS', address: profile.address },
    bankAccountIds: [],
    lines: [{ id: newId(), description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 100, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic' as const,
    language: 'et' as const,
    templateId: 'classic' as const,
    accentColor: '#2457c5',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
    ...patch,
  })

  it('are never overdue, not counted as unpaid and cannot be marked paid', async () => {
    const credit = base({
      number: '2026-0002',
      type: 'credit-note',
      creditedInvoiceNumber: '2026-0001',
      issueDate: '2026-01-06',
      dueDate: '2026-01-06',
      lines: [{ id: newId(), description: 'Töö', quantity: -1, unit: 'tk', unitPrice: 100, vatRate: 24 }],
    })
    const repo = createMemoryRepo({ profile, invoices: [base({ status: 'paid' }), credit] })
    renderAt('#/', repo)
    const row = (await screen.findByText('2026-0002')).closest('li')!
    expect(within(row).getByText('Kreeditarve arvele 2026-0001')).toBeInTheDocument()
    expect(screen.queryByText(/^\d+ päeva? üle tähtaja$/)).not.toBeInTheDocument()
    // Nothing is owed: the credit note is not counted as unpaid.
    expect(screen.getByText('Kõik väljastatud arved on tasutud.')).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('link'))
    expect(await screen.findByRole('heading', { name: 'Kreeditarve 2026-0002', level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Märgi tasutuks' })).not.toBeInTheDocument()
  })

  it('are linked from the credited invoice, without a "mark as paid" action on the credit note', async () => {
    const original = base({})
    const credit = base({ number: '2026-0002', type: 'credit-note', creditedInvoiceNumber: '2026-0001', issueDate: '2026-01-06', dueDate: '2026-01-06' })
    const repo = createMemoryRepo({ profile, invoices: [original, credit] })
    const { unmount } = renderAt(`#/invoices/${original.id}`, repo)
    const link = await screen.findByRole('link', { name: '2026-0002' })
    expect(link.closest('.credited-by')).toHaveTextContent('Arvele koostatud kreeditarved:')
    expect(screen.getByRole('button', { name: 'Märgi tasutuks' })).toBeInTheDocument()
    unmount()

    renderAt(`#/invoices/${credit.id}`, repo)
    expect(await screen.findByText(/väljastatud ja lukustatud/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Märgi tasutuks' })).not.toBeInTheDocument()
  })
})

describe('status changes', () => {
  it('marks an invoice paid from the Arved screen through the repository status call', async () => {
    const profile = sampleProfile()
    const inv = {
      id: newId(),
      number: '2026-0007',
      type: 'invoice' as const,
      status: 'issued' as const,
      issueDate: '2026-01-05',
      dueDate: '2099-01-19',
      seller: { ...profile },
      buyer: { kind: 'company' as const, name: 'Ostja AS', address: profile.address },
      bankAccountIds: [],
      lines: [{ id: newId(), description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 100, vatRate: 24 }],
      currency: 'EUR',
      vatScheme: 'domestic' as const,
      language: 'et' as const,
      templateId: 'classic' as const,
      accentColor: '#2457c5',
      createdAt: '2026-01-05T10:00:00Z',
      updatedAt: '2026-01-05T10:00:00Z',
    }
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt('#/', repo)
    const row = (await screen.findByText('2026-0007')).closest('li')!
    // The only invoice is shown beside the list; not sent yet, so marking it paid is the quiet link in the status line.
    expect(await screen.findByRole('button', { name: 'Saada e-kirjaga' })).toHaveClass('btn-primary')
    // One click marks it paid today (undo is offered in the toast).
    // (On phones the link is a button among the actions instead; CSS shows one of the two.)
    const [link, button] = screen.getAllByRole('button', { name: 'Märgi tasutuks' })
    expect(link).toHaveClass('link-btn')
    expect(button).toHaveClass('doc-paid-btn')
    await act(async () => {
      fireEvent.click(link)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(repo.markInvoicePaid).toHaveBeenCalledWith(inv.id, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(repo.saveInvoice).not.toHaveBeenCalled()
    expect(await within(row).findByText(/^Tasutud \d{2}\.\d{2}\.\d{4}$/)).toBeInTheDocument()
  })
})

describe('issue button summary', () => {
  it('explains a disabled issue button and points to the requirements check', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    renderAt('#/invoices/new', repo)
    const summary = await screen.findByRole('button', { name: /^Vigu enne väljastamist: \d+$/ })
    expect(screen.getByRole('button', { name: 'Väljasta arve' })).toHaveAttribute('aria-describedby', 'issue-summary')
    // The summary is the requirements check itself: one line that folds the list of problems.
    expect(summary.closest('#validation-panel')).not.toBeNull()
    // Folded on a blank draft (nothing entered yet); it opens on request.
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(summary)
    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Arve saab numbri 2026-0001 ja lukustatakse.')).toBeInTheDocument()
  })
})

describe('settlement by credit notes', () => {
  const profile = sampleProfile()
  const inv = (patch: Record<string, unknown>) => ({
    id: newId(),
    number: '2026-0001',
    type: 'invoice' as const,
    status: 'issued' as const,
    issueDate: '2026-01-05',
    dueDate: '2026-01-19',
    seller: { ...profile },
    buyer: { kind: 'company' as const, name: 'Ostja AS', address: profile.address },
    bankAccountIds: [],
    lines: [{ id: newId(), description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 100, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic' as const,
    language: 'et' as const,
    templateId: 'classic' as const,
    accentColor: '#2457c5',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
    ...patch,
  })
  const creditNote = (unitPrice: number) =>
    inv({
      number: '2026-0005',
      type: 'credit-note',
      creditedInvoiceNumber: '2026-0001',
      issueDate: '2026-01-06',
      dueDate: '2026-01-06',
      lines: [{ id: newId(), description: 'Töö', quantity: -1, unit: 'tk', unitPrice, vatRate: 24 }],
    })

  it('treats a fully credited invoice as settled: not unpaid, not overdue, no payment actions', async () => {
    const original = inv({})
    const repo = createMemoryRepo({ profile, invoices: [original, creditNote(100)] })
    renderAt('#/', repo)
    const row = (await screen.findByText('2026-0001')).closest('li')!
    expect(within(row).getByText('Krediteeritud')).toBeInTheDocument()
    expect(screen.queryByText(/päeva üle tähtaja/)).not.toBeInTheDocument()
    expect(screen.getByText('Kõik väljastatud arved on tasutud.')).toBeInTheDocument()
    // Invoices and credit notes net: the year total agrees with "nothing owed".
    expect(screen.getByText(/aastal on arveid väljastatud/)).toHaveTextContent('0,00 €')

    fireEvent.click(within(row).getByRole('link'))
    const status = await screen.findByText(/^Krediteeritud kreeditarvega/)
    expect(within(status).getByRole('link', { name: '2026-0005' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Märgi tasutuks' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Saada meeldetuletus' })).not.toBeInTheDocument()
  })

  it('shows what is still owed on a partially credited invoice and asks for it in the reminder', async () => {
    const original = inv({})
    const repo = createMemoryRepo({ profile, invoices: [original, creditNote(50)] })
    renderAt(`#/?id=${original.id}`, repo)
    expect(await screen.findByText(/^Tasumata 62,00 € \(kreeditarve 2026-0005 arvesse võetud\), \d+ päeva üle tähtaja$/)).toBeInTheDocument()
    expect(screen.getByText(/^Tasumata/, { selector: 'p.receivable' })).toHaveTextContent(/^Tasumata 62,00 €, neist üle tähtaja 62,00 €$/)

    fireEvent.click(screen.getByRole('button', { name: 'Saada meeldetuletus' }))
    const body = (await screen.findByLabelText('Sõnum')) as HTMLTextAreaElement
    expect(body.value).toMatch(/summas 62,00\s€/)
  })
})

describe('QA fixes', () => {
  const profile = sampleProfile()
  const draft = (patch: Record<string, unknown> = {}) => ({
    id: newId(),
    number: '',
    type: 'invoice' as const,
    status: 'draft' as const,
    issueDate: '2026-10-15',
    dueDate: '2026-10-29',
    seller: { ...profile },
    buyer: { kind: 'company' as const, name: 'Ostja AS', address: profile.address },
    bankAccountIds: [],
    lines: [{ id: newId(), description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 100, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic' as const,
    language: 'et' as const,
    templateId: 'classic' as const,
    accentColor: '#2457c5',
    createdAt: '2026-10-15T10:00:00Z',
    updatedAt: '2026-10-15T10:00:00Z',
    ...patch,
  })

  it('does not claim everything is paid when only drafts exist', async () => {
    renderAt('#/', createMemoryRepo({ profile, invoices: [draft()] }))
    expect(await screen.findByText('Väljastatud arveid veel ei ole.')).toBeInTheDocument()
    expect(screen.queryByText('Kõik väljastatud arved on tasutud.')).not.toBeInTheDocument()
  })

  it('names the credit-note total and issue action in a credit-note draft', async () => {
    const d = draft({ type: 'credit-note', creditedInvoiceNumber: '2026-0001', lines: [{ id: newId(), description: 'Töö', quantity: -1, unit: 'tk', unitPrice: 100, vatRate: 24 }] })
    renderAt(`#/invoices/${d.id}`, createMemoryRepo({ profile, invoices: [d] }))
    expect(await screen.findByRole('button', { name: 'Väljasta kreeditarve' })).toBeInTheDocument()
    expect(screen.getAllByText('Krediteeritav summa').length).toBeGreaterThan(0)
    expect(screen.queryByText('Tasumisele kuulub')).not.toBeInTheDocument()
  })

  it('keeps only the selected invoice row in the tab order', async () => {
    const a = draft({ number: '2026-0001', status: 'issued', issueDate: '2026-10-02' })
    const b = draft({ number: '2026-0002', status: 'issued', issueDate: '2026-10-03' })
    renderAt('#/', createMemoryRepo({ profile, invoices: [a, b] }))
    const rowB = (await screen.findByText('2026-0002')).closest('a')!
    const rowA = screen.getByText('2026-0001').closest('a')!
    expect(rowB).toHaveAttribute('tabindex', '0')
    expect(rowA).toHaveAttribute('tabindex', '-1')
    rowB.focus()
    fireEvent.keyDown(rowB, { key: 'ArrowDown' })
    expect(rowA).toHaveFocus()
    await waitFor(() => expect(rowA).toHaveAttribute('tabindex', '0'))
    expect(rowB).toHaveAttribute('tabindex', '-1')
  })

  it('labels the × of a confirm dialog "Sulge", not with the cancel text', async () => {
    const issued = draft({ number: '2026-0001', status: 'issued' })
    renderAt(`#/?id=${issued.id}`, createMemoryRepo({ profile, invoices: [issued] }))
    fireEvent.click(await screen.findByRole('button', { name: /^Rohkem/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tühista arve' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Sulge' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Tagasi' })).toBeInTheDocument()
  })

  it('"Jätka koostamist" lands focus on the editor title', async () => {
    const d = draft()
    renderAt(`#/?id=${d.id}`, createMemoryRepo({ profile, invoices: [d] }))
    fireEvent.click(await screen.findByRole('link', { name: 'Jätka koostamist' }))
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Uus arve' })
    await waitFor(() => expect(h1).toHaveFocus())
  })

  it('moves focus to the first discount field and offers a skip link to issuing', async () => {
    const d = draft()
    renderAt(`#/invoices/${d.id}`, createMemoryRepo({ profile, invoices: [d] }))
    fireEvent.click(await screen.findByRole('button', { name: 'Lisa allahindlus' }))
    await waitFor(() => expect(screen.getByLabelText('Allahindlus %')).toHaveFocus())

    fireEvent.click(screen.getByRole('link', { name: 'Liigu väljastamise juurde' }))
    expect(screen.getByRole('button', { name: 'Väljasta arve' })).toHaveFocus()
  })

  it('asks before the top bar leaves the company page with unsaved changes', async () => {
    const repo = createMemoryRepo({ profile, invoices: [draft()] })
    renderAt('#/company', repo)
    fireEvent.change(await screen.findByLabelText(/^Nimi/), { target: { value: 'Muudetud OÜ' } })
    const nav = screen.getByRole('navigation', { name: 'Peamenüü' })

    fireEvent.click(within(nav).getByRole('link', { name: 'Arved' }))
    let dialog = await screen.findByRole('dialog', { name: 'Salvestamata muudatused' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Jätka muutmist' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.location.hash).toBe('#/company')
    expect(screen.getByLabelText(/^Nimi/)).toHaveValue('Muudetud OÜ')

    fireEvent.click(within(nav).getByRole('link', { name: 'Arved' }))
    dialog = await screen.findByRole('dialog', { name: 'Salvestamata muudatused' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Loobu muudatustest' }))
    await waitFor(() => expect(window.location.hash).toBe('#/'))
    expect(repo.saveProfile).not.toHaveBeenCalled()
  })
})
