import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../../App'
import { createDefaultSettings, newId, reopenBlocker, type Invoice, type InvoiceEvent } from '../../../domain'
import { addDaysISO, localTodayISO } from '../../util'
import { createMemoryRepo, sampleProfile } from '../../testing/memoryRepo'
import * as integrations from '../../../integrations'
import { canMarkSent, sentPromptKey } from './markSent'

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
  vi.restoreAllMocks()
})

const profile = sampleProfile()
const today = localTodayISO()

function invoice(patch: Partial<Invoice> = {}): Invoice {
  return {
    id: newId(),
    number: '2026-0004',
    type: 'invoice',
    status: 'issued',
    issueDate: addDaysISO(today, -3),
    dueDate: addDaysISO(today, 11),
    seller: { ...profile },
    buyer: { kind: 'company', name: 'Kalda Puutöö OÜ', registryCode: '14520336', email: 'arved@kalda.ee', address: { street: 'Pärnu mnt 140', city: 'Tallinn', postalCode: '11317', country: 'EE' } },
    bankAccountIds: [],
    lines: [{ id: newId(), description: 'Veebipoe arendus', quantity: 2, unit: 'h', unitPrice: 65, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic',
    referenceNumber: '202600046',
    language: 'et',
    templateId: 'classic',
    accentColor: '#2457c5',
    issuedAt: addDaysISO(today, -3) + 'T09:00:00Z',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
    ...patch,
  }
}

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

const doc = async () => (await screen.findByRole('heading', { level: 2, name: /^(Arve|Kreeditarve|Hinnapakkumine)/ })).closest('article')!
const actions = (article: HTMLElement) => within(article).getByRole('group', { name: 'Arve toimingud' })

describe('canMarkSent', () => {
  const sent = (invoiceId: string, kind: InvoiceEvent['kind'] = 'sent') => ({ invoiceId, kind })

  it('is offered for an issued document that has not been sent', () => {
    expect(canMarkSent(invoice({ id: 'a' }), [])).toBe(true)
    expect(canMarkSent(invoice({ id: 'a', type: 'quote' }), [sent('other')])).toBe(true)
    // A reminder alone does not say the invoice itself was sent.
    expect(canMarkSent(invoice({ id: 'a' }), [sent('a', 'reminder')])).toBe(true)
  })

  it('is not offered once sent, nor for drafts, paid or cancelled documents', () => {
    expect(canMarkSent(invoice({ id: 'a' }), [sent('a')])).toBe(false)
    expect(canMarkSent(invoice({ status: 'draft', number: '' }), [])).toBe(false)
    expect(canMarkSent(invoice({ status: 'paid' }), [])).toBe(false)
    expect(canMarkSent(invoice({ status: 'cancelled' }), [])).toBe(false)
  })

  it('records the same event as e-mail sending, so the document can no longer be reopened', () => {
    const inv = invoice({ id: 'a' })
    expect(reopenBlocker(inv, [inv], [])).toBeNull()
    expect(reopenBlocker(inv, [inv], [sent('a')])).toBe('sent')
  })

  it('asks about the right kind of document', () => {
    expect(sentPromptKey('invoice')).toBe('sent.prompt')
    expect(sentPromptKey('prepayment')).toBe('sent.prompt')
    expect(sentPromptKey('credit-note')).toBe('sent.promptCredit')
    expect(sentPromptKey('quote')).toBe('sent.promptQuote')
    expect(sentPromptKey('invoice', 'reminder')).toBe('sent.promptReminder')
  })
})

describe('mark as sent in the selected invoice', () => {
  it('records a sent event from "More", locks reopening, and undoes it from the toast', async () => {
    const inv = invoice()
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt(`#/?id=${inv.id}`, repo)
    const article = await doc()
    expect(within(actions(article)).getByRole('button', { name: 'Saada e-kirjaga' })).toHaveClass('btn-primary')
    expect(within(article).getByRole('button', { name: 'muutmiseks avada' })).toBeInTheDocument()

    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Märgi saadetuks' }))
    })
    expect(repo.addInvoiceEvent).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: inv.id, kind: 'sent' }))
    expect(await screen.findByText('Arve 2026-0004 on märgitud saadetuks.')).toBeInTheDocument()
    // Counts as sent everywhere: the next step is the payment, the status line says so, it cannot be reopened.
    expect(await within(actions(article)).findByRole('button', { name: 'Märgi tasutuks' })).toHaveClass('btn-primary')
    expect(within(article).getByText(/saadetud \d{2}\.\d{2}\.\d{4}/)).toBeInTheDocument()
    expect(within(article).queryByRole('button', { name: 'muutmiseks avada' })).not.toBeInTheDocument()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    expect(screen.queryByRole('menuitem', { name: 'Märgi saadetuks' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Võta tagasi' }))
    })
    const event = repo.addInvoiceEvent.mock.calls[0][0] as InvoiceEvent
    expect(repo.deleteInvoiceEvent).toHaveBeenCalledWith(event.id)
    expect(await screen.findByText('Arve 2026-0004 ei ole enam märgitud saadetuks.')).toBeInTheDocument()
    expect(await within(actions(article)).findByRole('button', { name: 'Saada e-kirjaga' })).toHaveClass('btn-primary')
    expect(within(article).getByRole('button', { name: 'muutmiseks avada' })).toBeInTheDocument()
  })

  it('asks after a PDF download whether it was sent, and marks it in one click', async () => {
    const inv = invoice()
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt(`#/?id=${inv.id}`, repo)
    const article = await doc()
    expect(within(article).queryByText('Kas saatsid arve kliendile?')).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(actions(article)).getByRole('button', { name: /PDF/ }))
    })
    const prompt = (await within(article).findByText('Kas saatsid arve kliendile?')).closest('.sent-prompt') as HTMLElement
    expect(prompt).toHaveAttribute('role', 'status')
    await act(async () => {
      fireEvent.click(within(prompt).getByRole('button', { name: 'Märgi saadetuks' }))
    })
    expect(repo.addInvoiceEvent).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: inv.id, kind: 'sent' }))
    await waitFor(() => expect(within(article).queryByText('Kas saatsid arve kliendile?')).not.toBeInTheDocument())
  })

  it('asks after the e-invoice XML and printing too, and the prompt can be closed', async () => {
    const inv = invoice({ type: 'credit-note', creditedInvoiceNumber: '2026-0001', lines: [{ id: 'l', description: 'Tagasi', quantity: -1, unit: 'tk', unitPrice: 10, vatRate: 24 }] })
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt(`#/?id=${inv.id}`, repo)
    const article = await doc()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'E-arve (XML)' }))
    })
    const prompt = (await within(article).findByText('Kas saatsid kreeditarve kliendile?')).closest('.sent-prompt') as HTMLElement
    fireEvent.click(within(prompt).getByRole('button', { name: 'Sulge' }))
    expect(within(article).queryByText('Kas saatsid kreeditarve kliendile?')).not.toBeInTheDocument()

    const win = { opener: {}, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Prindi' }))
    })
    expect(await within(article).findByText('Kas saatsid kreeditarve kliendile?')).toBeInTheDocument()
    expect(repo.addInvoiceEvent).not.toHaveBeenCalled()
  })

  it('asks after a quote was saved to Drive', async () => {
    const q = invoice({ type: 'quote', number: 'HP-2026-001', referenceNumber: undefined, validUntil: addDaysISO(today, 10), dueDate: addDaysISO(today, 10) })
    const settings = { ...createDefaultSettings(), googleClientId: '1-own.apps.googleusercontent.com' }
    renderAt(`#/?id=${q.id}`, createMemoryRepo({ profile, settings, invoices: [q] }))
    const article = await doc()
    fireEvent.click(within(article).getByRole('button', { name: 'Rohkem' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Salvesta Drive’i' }))
    })
    expect(await within(article).findByText('Kas saatsid hinnapakkumise kliendile?')).toBeInTheDocument()
  })

  it('does not ask for a document that was already sent, nor for a draft preview', async () => {
    const inv = invoice()
    const draft = invoice({ id: 'd', number: '', status: 'draft', issuedAt: undefined, issueDate: today })
    const events = [{ id: 'e', invoiceId: inv.id, kind: 'sent' as const, at: new Date().toISOString() }]
    const view = renderAt(`#/?id=${inv.id}`, createMemoryRepo({ profile, invoices: [inv, draft], events }))
    let article = await doc()
    await within(article).findByText(/saadetud/)
    await act(async () => {
      fireEvent.click(within(actions(article)).getByRole('button', { name: /PDF/ }))
    })
    expect(within(article).queryByText('Kas saatsid arve kliendile?')).not.toBeInTheDocument()
    view.unmount()
    renderAt('#/?id=d', createMemoryRepo({ profile, invoices: [inv, draft], events }))
    article = (await screen.findByRole('heading', { level: 2, name: 'Arve mustand' })).closest('article')!
    await act(async () => {
      fireEvent.click(within(actions(article)).getByRole('button', { name: /PDF/ }))
    })
    expect(within(article).queryByText('Kas saatsid arve kliendile?')).not.toBeInTheDocument()
  })
})

describe('mark as sent in the editor', () => {
  it('is in the "More" menu of an issued, unsent invoice and records the same event', async () => {
    const inv = invoice()
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt(`#/invoices/${inv.id}`, repo)
    await screen.findByRole('heading', { level: 1, name: 'Arve 2026-0004' })
    fireEvent.click(screen.getByRole('button', { name: 'Rohkem' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Märgi saadetuks' }))
    })
    expect(repo.addInvoiceEvent).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: inv.id, kind: 'sent' }))
    expect(await screen.findByText('Arve 2026-0004 on märgitud saadetuks.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rohkem' }))
    expect(screen.queryByRole('menuitem', { name: 'Märgi saadetuks' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Ava muutmiseks' })).not.toBeInTheDocument()
  })
})

describe('e-mail handed to the mail app or the share sheet', () => {
  it('does not record the invoice as sent, even without a recipient, but asks', async () => {
    const inv = invoice({ buyer: { kind: 'company', name: 'Kalda Puutöö OÜ', address: { street: '', city: '', postalCode: '', country: 'EE' } } })
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt(`#/?id=${inv.id}`, repo)
    const article = await doc()
    fireEvent.click(within(actions(article)).getByRole('button', { name: 'Saada e-kirjaga' }))
    const dialog = await screen.findByRole('dialog', { name: 'Saada arve 2026-0004' })
    const mailApp = within(dialog).getByRole('button', { name: 'Ava e-posti rakendus' })
    await waitFor(() => expect(mailApp).toBeEnabled())
    await act(async () => {
      fireEvent.click(mailApp)
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(repo.addInvoiceEvent).not.toHaveBeenCalled()
    // Still unsent: e-mail stays the next step and the invoice can still be reopened.
    expect(within(actions(article)).getByRole('button', { name: 'Saada e-kirjaga' })).toHaveClass('btn-primary')
    expect(within(article).getByRole('button', { name: 'muutmiseks avada' })).toBeInTheDocument()
    const prompt = (await within(article).findByText('Kas saatsid arve kliendile?')).closest('.sent-prompt') as HTMLElement
    await act(async () => {
      fireEvent.click(within(prompt).getByRole('button', { name: 'Märgi saadetuks' }))
    })
    expect(repo.addInvoiceEvent).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: inv.id, kind: 'sent' }))
  })

  it('asks after sharing instead of recording it', async () => {
    vi.mocked(integrations.canShareFiles).mockReturnValue(true)
    try {
      const inv = invoice()
      const repo = createMemoryRepo({ profile, invoices: [inv] })
      renderAt(`#/?id=${inv.id}`, repo)
      const article = await doc()
      fireEvent.click(within(actions(article)).getByRole('button', { name: 'Saada e-kirjaga' }))
      const dialog = await screen.findByRole('dialog', { name: 'Saada arve 2026-0004' })
      const share = await within(dialog).findByRole('button', { name: 'Jaga…' })
      await waitFor(() => expect(share).toBeEnabled())
      await act(async () => {
        fireEvent.click(share)
      })
      expect(integrations.shareFiles).toHaveBeenCalled()
      expect(repo.addInvoiceEvent).not.toHaveBeenCalled()
      expect(await within(article).findByText('Kas saatsid arve kliendile?')).toBeInTheDocument()
    } finally {
      vi.mocked(integrations.canShareFiles).mockReturnValue(false)
    }
  })

  it('asks with a toast in the editor, whose action records the sent event', async () => {
    const inv = invoice()
    const repo = createMemoryRepo({ profile, invoices: [inv] })
    renderAt(`#/invoices/${inv.id}`, repo)
    await screen.findByRole('heading', { level: 1, name: 'Arve 2026-0004' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Saada e-kirjaga' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Saada arve 2026-0004' })
    const mailApp = within(dialog).getByRole('button', { name: 'Ava e-posti rakendus' })
    await waitFor(() => expect(mailApp).toBeEnabled())
    await act(async () => {
      fireEvent.click(mailApp)
    })
    expect(repo.addInvoiceEvent).not.toHaveBeenCalled()
    const toast = (await screen.findByText('Kas saatsid arve kliendile?')).closest('.toast') as HTMLElement
    await act(async () => {
      fireEvent.click(within(toast).getByRole('button', { name: 'Märgi saadetuks' }))
    })
    expect(repo.addInvoiceEvent).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: inv.id, kind: 'sent' }))
  })
})
