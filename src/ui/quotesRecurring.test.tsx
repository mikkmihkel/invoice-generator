import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { newId, type Invoice, type RecurringRule } from '../domain'
import { AppProvider } from './AppContext'
import { createMemoryRepo, sampleProfile } from './testing/memoryRepo'
import { ToastProvider } from './Toasts'
import { useRecurringDrafts } from './useRecurringDrafts'
import { localTodayISO } from './util'

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
const today = localTodayISO()

function doc(patch: Partial<Invoice> = {}): Invoice {
  return {
    id: newId(),
    number: '2026-0001',
    type: 'invoice',
    status: 'issued',
    issueDate: '2026-01-05',
    dueDate: '2099-01-19',
    seller: { ...profile },
    buyer: { kind: 'company', name: 'Klient AS', registryCode: '10234957', address: profile.address },
    bankAccountIds: [],
    lines: [{ id: newId(), description: 'Veebileht', quantity: 1, unit: 'tk', unitPrice: 1000, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic',
    language: 'et',
    templateId: 'classic',
    accentColor: '#2457c5',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
    ...patch,
  }
}

const quote = (patch: Partial<Invoice> = {}) => doc({ type: 'quote', number: 'HP-2026-001', validUntil: '2099-01-01', dueDate: '2099-01-01', ...patch })

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

describe('invoice list: invoices and quotes', () => {
  it('keeps quotes out of the invoice view and shows quote statuses in their own view', async () => {
    const invoice = doc({ buyer: { kind: 'company', name: 'Arve Klient OÜ', address: profile.address } })
    const open = quote({ buyer: { kind: 'company', name: 'Avatud OÜ', address: profile.address } })
    const expired = quote({ number: 'HP-2026-002', validUntil: '2026-01-10', buyer: { kind: 'company', name: 'Aegunud OÜ', address: profile.address } })
    const accepted = quote({ number: 'HP-2026-003', quoteAcceptedAt: '2026-01-07T10:00:00Z', buyer: { kind: 'company', name: 'Nõus OÜ', address: profile.address } })
    // Sent, so the "needs attention" strip does not name the client too.
    const events = [{ id: 's', invoiceId: invoice.id, kind: 'sent' as const, at: new Date().toISOString() }]
    renderAt('#/', createMemoryRepo({ profile, invoices: [invoice, open, expired, accepted], events }))
    await screen.findAllByText('Arve Klient OÜ')
    const list = () => within(document.querySelector<HTMLElement>('.arved-list')!)
    expect(list().getByText('Arve Klient OÜ')).toBeInTheDocument()
    expect(list().queryByText('Avatud OÜ')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Hinnapakkumised'))
    expect(await list().findByText('Avatud OÜ')).toBeInTheDocument()
    expect(list().queryByText('Arve Klient OÜ')).not.toBeInTheDocument()
    const row = (name: string) => list().getByText(name).closest('a')!
    expect(within(row('Avatud OÜ')).getByText('Kehtib kuni 01.01.2099')).toBeInTheDocument()
    expect(within(row('Aegunud OÜ')).getByText('Aegunud')).toBeInTheDocument()
    expect(within(row('Nõus OÜ')).getByText('Vastu võetud')).toBeInTheDocument()
    expect(list().getByRole('link', { name: 'Uus hinnapakkumine' })).toHaveAttribute('href', '#/invoices/new?type=quote')
    // Open quotes are summed separately from receivables.
    expect(screen.getByText(/Avatud hinnapakkumised kokku/)).toBeInTheDocument()
  })

  it('offers to create the first quote when there is none', async () => {
    renderAt('#/?kind=quotes', createMemoryRepo({ profile, invoices: [doc()] }))
    expect(await screen.findByText('Hinnapakkumisi veel ei ole')).toBeInTheDocument()
  })

  it('marks drafts prepared by a recurring rule', async () => {
    const draft = doc({ status: 'draft', number: '', recurringRuleId: 'r1', buyer: { kind: 'company', name: 'Kuuklient OÜ', address: profile.address } })
    renderAt('#/', createMemoryRepo({ profile, invoices: [doc(), draft] }))
    const row = (await screen.findAllByText('Kuuklient OÜ')).map((e) => e.closest('a')).find(Boolean)!
    expect(within(row).getByText(/Korduv/)).toHaveAttribute('title', 'Korduvarve mustand')
  })
})

describe('quote editor', () => {
  it('a new quote has a validity date and no payment fields', async () => {
    renderAt('#/invoices/new?type=quote', createMemoryRepo({ profile }))
    expect(await screen.findByRole('heading', { name: 'Uus hinnapakkumine', level: 1 }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Kehtib kuni/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Pakkumise kuupäev/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Maksetähtaeg')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Viitenumber/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Väljasta hinnapakkumine' })).toBeInTheDocument()
    expect(screen.getByText(/Saab väljastamisel numbri HP-\d{4}-001/)).toBeInTheDocument()
  })

  it('"Koosta arve" turns an issued quote into an invoice draft and opens it', async () => {
    const q = quote()
    const repo = createMemoryRepo({ profile, invoices: [q] })
    renderAt(`#/invoices/${q.id}`, repo)
    expect(await screen.findByRole('heading', { name: 'Hinnapakkumine HP-2026-001', level: 1 }, { timeout: 5000 })).toBeInTheDocument()
    // Issued but not e-mailed yet.
    expect(screen.getByText('Väljastatud')).toBeInTheDocument()
    expect(screen.queryByText('Saadetud')).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Koosta arve' }))
    })
    await waitFor(() => expect(repo.saveInvoice).toHaveBeenCalledTimes(2))
    const draft = repo.saveInvoice.mock.calls[0][0] as Invoice
    expect(draft).toMatchObject({ type: 'invoice', status: 'draft', number: '', issueDate: today, convertedFromQuoteId: q.id })
    expect(draft.lines[0].description).toBe('Veebileht')
    expect(repo.saveInvoice.mock.calls[1][0]).toMatchObject({ id: q.id, convertedToInvoiceId: draft.id })
    expect(await screen.findByRole('heading', { name: 'Uus arve', level: 1 }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'HP-2026-001' })).toBeInTheDocument()
  })
})

describe('quote wording', () => {
  it('says "Saadetud" only once the quote has been e-mailed', async () => {
    const q = quote()
    renderAt(`#/invoices/${q.id}`, createMemoryRepo({ profile, invoices: [q], events: [{ id: 'e1', invoiceId: q.id, kind: 'sent', at: '2026-01-06T10:00:00Z' }] }))
    expect(await screen.findByRole('heading', { name: 'Hinnapakkumine HP-2026-001', level: 1 }, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByText('Saadetud')).toBeInTheDocument()
  })

  it('offers "Koosta arve" right after issuing', async () => {
    const draft = quote({ status: 'draft', number: '', issueDate: today, validUntil: '2099-01-01', dueDate: '2099-01-01' })
    const repo = createMemoryRepo({ profile, invoices: [draft] })
    renderAt(`#/invoices/${draft.id}`, repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Väljasta hinnapakkumine' }, { timeout: 5000 }))
    const dialog = await screen.findByRole('dialog', { name: 'Väljasta hinnapakkumine' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Väljasta' }))
    })
    await waitFor(() => expect(repo.issueInvoice).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Koosta arve' })).toBeInTheDocument()
  })

  it('uses quote words in the editor and the detail pane', async () => {
    const q = quote()
    const repo = createMemoryRepo({ profile, invoices: [q] })
    const { unmount } = renderAt('#/invoices/new?type=quote', repo)
    expect(await screen.findByRole('heading', { name: 'Uus hinnapakkumine', level: 1 }, { timeout: 5000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Muuda kujundust' }))
    expect(screen.getByLabelText('Pakkumise keel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lisa tekstirida enne pakkumise ridu' })).toBeInTheDocument()
    expect(screen.queryByText(/arveridu/)).not.toBeInTheDocument()
    unmount()
    renderAt(`#/?id=${q.id}`, repo)
    const article = (await screen.findByRole('heading', { level: 2, name: 'Hinnapakkumine HP-2026-001' })).closest('article')!
    expect(within(article).getByText('Pakkumise kuupäev')).toBeInTheDocument()
    expect(within(article).getByRole('heading', { name: 'Pakkumise read' })).toBeInTheDocument()
    expect(within(article).getByRole('button', { name: 'Näita hinnapakkumist' })).toBeInTheDocument()
    expect(within(article).queryByText('Arve kuupäev')).not.toBeInTheDocument()
  })
})

describe('recurring invoices', () => {
  it('"Korda" stores a rule with the next date after today', async () => {
    const inv = doc({ issueDate: '2026-01-31' })
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt(`#/invoices/${inv.id}`, repo)
    const select = await screen.findByLabelText('Kordumine', {}, { timeout: 5000 })
    await act(async () => {
      fireEvent.change(select, { target: { value: 'monthly' } })
    })
    await waitFor(() => expect(repo.saveRecurringRule).toHaveBeenCalled())
    const rule = repo.saveRecurringRule.mock.calls[0][0] as RecurringRule
    expect(rule).toMatchObject({ sourceInvoiceId: inv.id, interval: 'monthly', active: true })
    expect(rule.nextDate > today).toBe(true)
    expect(await screen.findByText(/Uus mustand valmib/)).toBeInTheDocument()
  })

  it('is offered for ordinary invoices only, the same in the editor and the list', async () => {
    const pre = doc({ type: 'prepayment', issueDate: '2026-01-31' })
    const repo = createMemoryRepo({ profile, invoices: [pre] })
    const { unmount } = renderAt(`#/invoices/${pre.id}`, repo)
    expect(await screen.findByRole('heading', { name: /2026-0001/ }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByLabelText('Kordumine')).not.toBeInTheDocument()
    unmount()
    renderAt(`#/?id=${pre.id}`, repo)
    expect(await screen.findByRole('heading', { level: 2, name: /2026-0001/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Kordumine')).not.toBeInTheDocument()
  })

  it('still lets a rule set up earlier on a prepayment invoice be stopped', async () => {
    const pre = doc({ type: 'prepayment', issueDate: '2026-01-31' })
    const rule: RecurringRule = { id: 'r1', sourceInvoiceId: pre.id, interval: 'monthly', nextDate: '2099-02-28', active: true, createdAt: '2026-01-31T10:00:00Z', updatedAt: '2026-01-31T10:00:00Z' }
    const repo = createMemoryRepo({ profile, invoices: [pre], recurringRules: [rule] })
    renderAt(`#/?id=${pre.id}`, repo)
    const select = await screen.findByLabelText('Kordumine', {}, { timeout: 5000 })
    await act(async () => {
      fireEvent.change(select, { target: { value: 'none' } })
    })
    // "Ei kordu" stops it: the rule is removed (undo is offered in the toast).
    await waitFor(() => expect(repo.deleteRecurringRule).toHaveBeenCalledWith('r1'))
  })

  it('prepares the due drafts once and says how many', async () => {
    const inv = doc({ issueDate: '2026-01-31' })
    const rule: RecurringRule = { id: 'r1', sourceInvoiceId: inv.id, interval: 'monthly', nextDate: '2026-02-28', active: true, createdAt: '2026-01-31T10:00:00Z', updatedAt: '2026-01-31T10:00:00Z' }
    const repo = createMemoryRepo({ profile, invoices: [inv], recurringRules: [rule] })
    function Harness() {
      useRecurringDrafts()
      return null
    }
    render(
      <AppProvider repository={repo}>
        <ToastProvider>
          <Harness />
        </ToastProvider>
      </AppProvider>,
    )
    await waitFor(() => expect(repo.saveRecurringRule).toHaveBeenCalled())
    const drafts = repo.saveInvoice.mock.calls.map((c) => c[0] as Invoice)
    expect(drafts.length).toBeGreaterThan(0)
    expect(drafts.every((d) => d.status === 'draft' && d.recurringRuleId === 'r1')).toBe(true)
    expect(drafts[0].issueDate <= today).toBe(true)
    const saved = repo.saveRecurringRule.mock.calls.at(-1)![0] as RecurringRule
    expect(saved.nextDate > today).toBe(true)
    expect(await screen.findByText(/korduvarve mustand/)).toBeInTheDocument()
    expect(repo.issueInvoice).not.toHaveBeenCalled()
  })

  describe('in two tabs at once', () => {
    const source = doc({ issueDate: '2026-01-31' })
    const rule: RecurringRule = { id: 'r1', sourceInvoiceId: source.id, interval: 'monthly', nextDate: '2026-02-28', active: true, createdAt: '2026-01-31T10:00:00Z', updatedAt: '2026-01-31T10:00:00Z' }
    function Harness() {
      useRecurringDrafts()
      return null
    }
    const tab = (repo: ReturnType<typeof createMemoryRepo>) => (
      <AppProvider repository={repo}>
        <ToastProvider>
          <Harness />
        </ToastProvider>
      </AppProvider>
    )
    const expected = () => {
      let n = 0
      for (let d = new Date(Date.UTC(2026, 1, 28)); d.toISOString().slice(0, 10) <= today; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0))) n++
      return Math.min(n, 12)
    }

    it('gives each period one draft, with an id from the rule and the date', async () => {
      const repo = createMemoryRepo({ profile, invoices: [source], recurringRules: [rule] })
      render(
        <>
          {tab(repo)}
          {tab(repo)}
        </>,
      )
      await waitFor(() => expect(repo.saveRecurringRule).toHaveBeenCalledTimes(2))
      const drafts = (await repo.listInvoices()).filter((i) => i.recurringRuleId === 'r1')
      expect(drafts).toHaveLength(expected())
      expect(drafts.every((d) => d.id === `rec-r1-${d.issueDate}`)).toBe(true)
    })

    it('takes turns where the browser can lock, so the second tab writes nothing', async () => {
      let queue = Promise.resolve()
      let finished = 0
      const locks = {
        request: (_name: string, fn: () => Promise<unknown>) => {
          const run = queue.then(fn).finally(() => finished++)
          queue = run.then(
            () => undefined,
            () => undefined,
          )
          return run
        },
      }
      Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
      try {
        const repo = createMemoryRepo({ profile, invoices: [source], recurringRules: [rule] })
        render(
          <>
            {tab(repo)}
            {tab(repo)}
          </>,
        )
        await waitFor(() => expect(finished).toBe(2))
        // The second tab reads the rule the first one moved forward and has nothing left to do.
        expect(repo.saveRecurringRule).toHaveBeenCalledTimes(1)
        expect(repo.saveInvoice).toHaveBeenCalledTimes(expected())
      } finally {
        delete (navigator as { locks?: unknown }).locks
      }
    })
  })
})
