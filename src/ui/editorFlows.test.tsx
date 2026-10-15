import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createEmptyInvoice, type Invoice } from '../domain'
import { createMemoryRepo, sampleProfile } from './testing/memoryRepo'
import { addDaysISO, localTodayISO, newClient } from './util'

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

const profile = sampleProfile()
const client = newClient({
  name: 'Ostja AS',
  registryCode: '10000001',
  address: { street: 'Rüütli 1', city: 'Pärnu', postalCode: '80010', country: 'EE' },
})

/** A draft that passes validation (issue button enabled). */
function validDraft(patch: Partial<Invoice> = {}): Invoice {
  const inv = createEmptyInvoice(profile, client)
  return { ...inv, lines: [{ ...inv.lines[0], description: 'Arendus', unitPrice: 100 }], ...patch }
}

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('malformed records', () => {
  it('render in the list and the editor without crashing', async () => {
    const broken = { ...validDraft(), number: '2026-0099', status: 'issued' } as Partial<Invoice>
    delete broken.issueDate
    delete broken.lines
    delete broken.bankAccountIds
    delete broken.buyer
    const repo = createMemoryRepo({ profile, invoices: [broken as Invoice] })
    const { unmount } = renderAt('#/', repo)
    expect(await screen.findByText('2026-0099')).toBeInTheDocument()
    unmount()
    renderAt(`#/invoices/${broken.id}`, repo)
    expect(await screen.findByRole('heading', { name: /Arve 2026-0099/ })).toBeInTheDocument()
    expect(screen.queryByText('Midagi läks valesti')).not.toBeInTheDocument()
  })
})

describe('VAT note field', () => {
  it('appears for a domestic 0% line and resolves the validation warning', async () => {
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [validDraft()] })
    const inv = (await repo.listInvoices())[0]
    renderAt(`#/invoices/${inv.id}`, repo)
    await screen.findByLabelText('Kirjeldus 1')
    expect(screen.queryByLabelText(/Viide 0% määra õiguslikule alusele/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('KM %'), { target: { value: '0' } })
    const panel = screen.getByRole('heading', { name: 'Nõuete kontroll' }).closest('section')!
    expect(await within(panel).findByText(/0% määraga maksustatava käibe/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Viide 0% määra õiguslikule alusele/), { target: { value: 'KMS § 15 lg 3 p 4' } })
    await waitFor(() => expect(within(panel).queryByText(/0% määraga maksustatava käibe/)).not.toBeInTheDocument())
    expect(screen.getByText(/Arvele trükitakse:/).parentElement).toHaveTextContent('KMS § 15 lg 3 p 4')
  })

  it('explains that EU wording is kept and the note is appended', async () => {
    const repo = createMemoryRepo({ profile, invoices: [validDraft({ vatScheme: 'eu-reverse-charge' })] })
    const inv = (await repo.listInvoices())[0]
    renderAt(`#/invoices/${inv.id}`, repo)
    expect(await screen.findByLabelText(/Lisatekst käibemaksu märkusele/)).toBeInTheDocument()
    expect(screen.getByText(/kohustuslik tekst jääb alati alles/)).toBeInTheDocument()
  })
})

describe('issuing a stale draft', () => {
  it('offers to date it today (default), moving the due date by the same term', async () => {
    const old = addDaysISO(localTodayISO(), -20)
    const draft = validDraft({ issueDate: old, dueDate: addDaysISO(old, 14) })
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [draft] })
    renderAt(`#/invoices/${draft.id}`, repo)
    expect(await screen.findByText(/rohkem kui nädal minevikus/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Väljasta arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Väljasta arve' })
    expect(within(dialog).getByText(/Tavaliselt märgitakse arvele väljastamise päev/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Muuda arve kuupäevaks tänane päev')).toBeChecked()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Väljasta' }))
    })
    await waitFor(() => expect(repo.issueInvoice).toHaveBeenCalledTimes(1))
    const saved = repo.saveInvoice.mock.calls.at(-1)![0]
    expect(saved).toMatchObject({ issueDate: localTodayISO(), dueDate: addDaysISO(localTodayISO(), 14) })
    expect(repo.saveInvoice.mock.invocationCallOrder.at(-1)!).toBeLessThan(repo.issueInvoice.mock.invocationCallOrder[0])
  })

  it('points out the year in the number when the year changes, and can keep the old date', async () => {
    const year = Number(localTodayISO().slice(0, 4))
    const draft = validDraft({ issueDate: `${year - 1}-12-20`, dueDate: `${year}-01-03` })
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [draft] })
    renderAt(`#/invoices/${draft.id}`, repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Väljasta arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Väljasta arve' })
    expect(within(dialog).getByText(new RegExp(`aasta arvenumbris: arve saab numbri ${year}-0001`))).toBeInTheDocument()
    fireEvent.click(within(dialog).getByLabelText('Muuda arve kuupäevaks tänane päev'))
    expect(within(dialog).getByText(`Arvele antakse number ${year - 1}-0001.`)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Väljasta' }))
    })
    await waitFor(() => expect(repo.issueInvoice).toHaveBeenCalledTimes(1))
    expect((await repo.getInvoice(draft.id))?.issueDate).toBe(`${year - 1}-12-20`)
  })
})

describe('autosave', () => {
  it('shows a failed save with retry, and issuing stops while edits cannot be saved', async () => {
    const draft = validDraft()
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [draft] })
    repo.saveInvoice.mockRejectedValue(new Error('QuotaExceededError'))
    renderAt(`#/invoices/${draft.id}`, repo)
    fireEvent.change(await screen.findByLabelText(/^Lisainfo/), { target: { value: 'Oluline märkus' } })
    expect(await screen.findByText('Salvestamine ebaõnnestus', {}, { timeout: 3000 })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Väljasta arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Väljasta arve' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Väljasta' }))
    })
    expect(await screen.findByText(/Arvet ei väljastatud, sest muudatuste salvestamine ebaõnnestus/)).toBeInTheDocument()
    expect(repo.issueInvoice).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Väljasta arve' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Loobu' }))
    expect(screen.getByLabelText(/^Lisainfo/)).toHaveValue('Oluline märkus')

    repo.saveInvoice.mockImplementation(async () => undefined)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Proovi uuesti' }))
    })
    expect(await screen.findByText('Mustand salvestatud')).toBeInTheDocument()
    expect(repo.saveInvoice.mock.calls.at(-1)![0].notes).toBe('Oluline märkus')
  })

  it('deleting a new draft during its first save leaves no orphan', async () => {
    const repo = createMemoryRepo({ profile })
    const gate = deferred()
    const realSave = repo.saveInvoice.getMockImplementation()!
    repo.saveInvoice.mockImplementation(async (inv: Invoice) => {
      await gate.promise
      await realSave(inv)
    })
    renderAt('#/invoices/new', repo)
    fireEvent.change(await screen.findByLabelText('Kirjeldus 1'), { target: { value: 'Töö' } })
    await waitFor(() => expect(repo.saveInvoice).toHaveBeenCalled(), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: 'Kustuta mustand' }))
    const confirm = await screen.findByRole('dialog')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Kustuta' }))
    await act(async () => {
      gate.resolve()
    })
    await waitFor(() => expect(repo.deleteInvoice).toHaveBeenCalled())
    expect(await repo.listInvoices()).toEqual([])
    expect(repo.deleteInvoice.mock.invocationCallOrder[0]).toBeGreaterThan(repo.saveInvoice.mock.invocationCallOrder[0])
  })

  it('keeps the issue dialog open on Escape while issuing', async () => {
    const draft = validDraft()
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [draft] })
    const gate = deferred()
    const realIssue = repo.issueInvoice.getMockImplementation()!
    repo.issueInvoice.mockImplementation(async (id: string) => {
      await gate.promise
      return realIssue(id)
    })
    renderAt(`#/invoices/${draft.id}`, repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Väljasta arve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Väljasta arve' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Väljasta' }))
    await waitFor(() => expect(repo.issueInvoice).toHaveBeenCalled())
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Väljasta arve' })).toBeInTheDocument()
    await act(async () => {
      gate.resolve()
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Väljasta arve' })).not.toBeInTheDocument())
  })
})

describe('line precision', () => {
  it('rounds quantity, unit price and discount to what the PDF prints', async () => {
    const repo = createMemoryRepo({ profile })
    renderAt('#/invoices/new', repo)
    fireEvent.change(await screen.findByLabelText('Kogus'), { target: { value: '1,23456' } })
    fireEvent.change(screen.getByLabelText('Ühikuhind'), { target: { value: '10,123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lisa allahindlus' }))
    fireEvent.change(screen.getByLabelText('Allahindlus %'), { target: { value: '12,345' } })
    await waitFor(() => expect(repo.saveInvoice).toHaveBeenCalled(), { timeout: 3000 })
    expect(repo.saveInvoice.mock.calls.at(-1)![0].lines[0]).toMatchObject({ quantity: 1.235, unitPrice: 10.1235, discountPercent: 12.35 })
  })
})

describe('draft seller snapshot', () => {
  it('does not store the logo in autosaved drafts', async () => {
    const repo = createMemoryRepo({ profile: { ...profile, logoDataUrl: 'data:image/png;base64,AAAA' } })
    renderAt('#/invoices/new', repo)
    fireEvent.change(await screen.findByLabelText('Kirjeldus 1'), { target: { value: 'Töö' } })
    await waitFor(() => expect(repo.saveInvoice).toHaveBeenCalled(), { timeout: 3000 })
    expect(repo.saveInvoice.mock.calls.at(-1)![0].seller).not.toHaveProperty('logoDataUrl')
  })
})

describe('issued invoice actions', () => {
  it('offers a payment reminder as the one primary action once overdue', async () => {
    const overdue = { ...validDraft(), number: '2026-0005', status: 'issued' as const, issueDate: '2026-01-05', dueDate: '2026-01-19', issuedAt: '2026-01-05T10:00:00Z' }
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [overdue] })
    renderAt(`#/invoices/${overdue.id}`, repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Saada meeldetuletus' }))
    const dialog = await screen.findByRole('dialog', { name: 'Meeldetuletus arve 2026-0005 kohta' })
    expect(within(dialog).getByLabelText('Teema')).toHaveValue('Meeldetuletus: arve 2026-0005 on tasumata')
    expect(screen.getByRole('button', { name: 'Märgi tasutuks' })).toBeInTheDocument()
  })
})

describe('buyer e-mail suggestion', () => {
  it('suggests adding an e-mail address and asks for it under the buyer', async () => {
    const draft = validDraft()
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [draft] })
    renderAt(`#/invoices/${draft.id}`, repo)
    expect(await screen.findByRole('button', { name: /Kõik kohustuslikud andmed on olemas\. 1 soovitus/ })).toBeInTheDocument()
    const email = screen.getByLabelText('E-post')
    fireEvent.change(email, { target: { value: 'arved@ostja.ee' } })
    expect(await screen.findByText('Kõik kohustuslikud andmed on olemas.')).toBeInTheDocument()
    // The field stays while typing, even though the address is now set.
    expect(screen.getByLabelText('E-post')).toHaveValue('arved@ostja.ee')
  })
})
