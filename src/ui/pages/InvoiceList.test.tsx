import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { newId, type Invoice, type RecurringRule } from '../../domain'
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
    fireEvent.click(within(root).getByRole('button', { name: /^Näita üle tähtaja arveid: 124,00\s€$/ }))
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
    expect(within(root).queryByRole('option', { name: 'Üle tähtaja' })).not.toBeInTheDocument()
    fireEvent.click(chip)
    expect(rowNames(root)).toHaveLength(2)
    view.unmount()

    renderAt('#/', createMemoryRepo({ profile, invoices: [invoice()] }))
    root = await list()
    expect(within(root).queryByRole('radio', { name: /Üle tähtaja/ })).not.toBeInTheDocument()
    expect(within(root).getByRole('option', { name: 'Üle tähtaja' })).toBeInTheDocument()
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

describe('needs attention strip', () => {
  const strip = async () => (await screen.findByRole('region', { name: 'Vajab tähelepanu' })) as HTMLElement
  const named = (name: string) => ({ ...invoice().buyer, name })

  it('lists what to do today; a line with several documents filters the list', async () => {
    const a = overdue({ buyer: named('Hiline A OÜ') })
    const b = overdue({ buyer: named('Hiline B OÜ') })
    const reminded = overdue({ buyer: named('Meeldetuletatud OÜ') })
    const unsent = invoice({ buyer: named('Saatmata OÜ') })
    const draft = invoice({ status: 'draft', number: '', issuedAt: undefined, buyer: named('Mustand OÜ') })
    const events = [{ id: 'r', invoiceId: reminded.id, kind: 'reminder' as const, at: new Date().toISOString() }]
    renderAt('#/', createMemoryRepo({ profile, invoices: [a, b, reminded, unsent, draft], events }))
    const box = await strip()
    const lines = within(box).getAllByRole('button').filter((el) => el.classList.contains('attention-item'))
    expect(lines.map((l) => l.textContent)).toEqual([
      'Üle tähtaja, meeldetuletus saatmata: 2 arvet',
      'Väljastatud, aga saatmata: Saatmata OÜ',
      'Pooleli mustand: Mustand OÜ',
    ])
    const root = await list()
    fireEvent.click(lines[0])
    expect(rowNames(root).sort()).toEqual(['Hiline A OÜ', 'Hiline B OÜ'])
    expect(lines[0]).toHaveAttribute('aria-pressed', 'true')
    // No main chip is selected while the strip's filter is on.
    const statusChips = within(root).getByRole('radiogroup', { name: 'Olek' })
    expect(within(statusChips).getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)).toHaveLength(0)
  })

  it('opens the document of a line with only one', async () => {
    const unsent = invoice({ buyer: named('Saatmata OÜ') })
    const sent = invoice({ buyer: named('Saadetud OÜ') })
    renderAt('#/', createMemoryRepo({ profile, invoices: [unsent, sent], events: [{ id: 's', invoiceId: sent.id, kind: 'sent', at: new Date().toISOString() }] }))
    const box = await strip()
    fireEvent.click(within(box).getByRole('button', { name: 'Väljastatud, aga saatmata: Saatmata OÜ' }))
    expect(window.location.hash).toBe(`#/?id=${unsent.id}`)
    expect(await screen.findByRole('heading', { level: 2, name: `Arve ${unsent.number}` })).toBeInTheDocument()
  })

  it('shows quotes about to expire and switches to the quotes view for them', async () => {
    const q1 = invoice({ type: 'quote', validUntil: addDaysISO(today, 1), dueDate: addDaysISO(today, 1), referenceNumber: undefined, buyer: named('Pakkumine A OÜ') })
    const q2 = invoice({ type: 'quote', validUntil: addDaysISO(today, 3), dueDate: addDaysISO(today, 3), referenceNumber: undefined, buyer: named('Pakkumine B OÜ') })
    const later = invoice({ type: 'quote', validUntil: addDaysISO(today, 20), dueDate: addDaysISO(today, 20), referenceNumber: undefined, buyer: named('Hiljem OÜ') })
    const events = [q1, q2, later].map((q) => ({ id: `s-${q.id}`, invoiceId: q.id, kind: 'sent' as const, at: new Date().toISOString() }))
    renderAt('#/', createMemoryRepo({ profile, invoices: [q1, q2, later], events }))
    const box = await strip()
    fireEvent.click(within(box).getByRole('button', { name: 'Hinnapakkumised aegumas: 2 hinnapakkumist' }))
    const root = await screen.findByRole('region', { name: 'Hinnapakkumised' })
    expect(rowNames(root as HTMLElement).sort()).toEqual(['Pakkumine A OÜ', 'Pakkumine B OÜ'])
  })

  it('says how many drafts were prepared today from recurring rules', async () => {
    const now = new Date().toISOString()
    const drafts = [1, 2].map((n) => invoice({ id: `rec-${n}`, status: 'draft', number: '', issuedAt: undefined, recurringRuleId: `rule-${n}`, createdAt: now, updatedAt: now }))
    renderAt('#/', createMemoryRepo({ profile, invoices: [...drafts, invoice({ status: 'draft', number: '', issuedAt: undefined })] }))
    const box = await strip()
    expect(within(box).getByRole('button', { name: 'Pooleli mustandid: 3 mustandit, neist 2 täna koostatud korduvarvet' })).toBeInTheDocument()
  })

  it('is hidden when there is nothing to do', async () => {
    const sent = invoice()
    renderAt('#/', createMemoryRepo({ profile, invoices: [sent], events: [{ id: 's', invoiceId: sent.id, kind: 'sent', at: new Date().toISOString() }] }))
    await list()
    expect(screen.queryByRole('region', { name: 'Vajab tähelepanu' })).not.toBeInTheDocument()
  })

  it('can be hidden for the session and comes back when something new needs attention', async () => {
    const unsent = invoice()
    const view = renderAt('#/', createMemoryRepo({ profile, invoices: [unsent] }))
    fireEvent.click(within(await strip()).getByRole('button', { name: 'Peida' }))
    expect(screen.queryByRole('region', { name: 'Vajab tähelepanu' })).not.toBeInTheDocument()
    view.unmount()
    const again = renderAt('#/', createMemoryRepo({ profile, invoices: [unsent] }))
    await list()
    expect(screen.queryByRole('region', { name: 'Vajab tähelepanu' })).not.toBeInTheDocument()
    again.unmount()
    renderAt('#/', createMemoryRepo({ profile, invoices: [unsent, overdue()] }))
    expect(await strip()).toBeInTheDocument()
  })
})

describe('list search', () => {
  const hosting = () =>
    invoice({
      buyer: { ...invoice().buyer, name: 'Tartu Kohvik OÜ', email: 'arved@tartukohvik.ee' },
      lines: [{ id: 'l', description: 'Veebimajutus aastaks', quantity: 1, unit: 'tk', unitPrice: 1000, vatRate: 24 }],
    })

  async function search(text: string) {
    const root = await list()
    fireEvent.change(within(root).getByRole('searchbox', { name: 'Otsi numbri, kliendi, summa või rea järgi' }), { target: { value: text } })
    return root
  }

  it('finds an invoice by its amount however it is typed, and marks the amount', async () => {
    renderAt('#/', createMemoryRepo({ profile, invoices: [hosting(), invoice()] }))
    for (const text of ['1240', '1 240,00', '1240.0', '1 240 €']) {
      const root = await search(text)
      expect(rowNames(root)).toEqual(['Tartu Kohvik OÜ'])
      expect(root.querySelector('.row-amount mark')).toHaveTextContent(/1\s240,00/)
    }
  })

  it('finds line descriptions and the buyer e-mail, and shows which field matched', async () => {
    renderAt('#/', createMemoryRepo({ profile, invoices: [hosting(), invoice()] }))
    let root = await search('majutus')
    expect(rowNames(root)).toEqual(['Tartu Kohvik OÜ'])
    expect(root.querySelector('.row-hit')).toHaveTextContent('Rida: Veebimajutus aastaks')
    expect(root.querySelector('.row-hit mark')).toHaveTextContent('majutus')
    root = await search('tartukohvik.ee')
    expect(root.querySelector('.row-hit')).toHaveTextContent('E-post: arved@tartukohvik.ee')
    root = await search('1000')
    expect(root.querySelector('.row-hit')).toHaveTextContent(/^Summa käibemaksuta: 1\s000,00\s€$/)
  })

  it('finds the reference number and marks a matching client name in the row', async () => {
    const inv = hosting()
    renderAt('#/', createMemoryRepo({ profile, invoices: [inv, invoice()] }))
    let root = await search(inv.referenceNumber!)
    expect(rowNames(root)).toEqual(['Tartu Kohvik OÜ'])
    expect(root.querySelector('.row-hit')).toHaveTextContent(`Viitenumber: ${inv.referenceNumber}`)
    root = await search('kohvik')
    expect(root.querySelector('.row-client mark')).toHaveTextContent('Kohvik')
    expect(root.querySelector('.row-hit')).toBeNull()
  })
})

describe('recurring overview', () => {
  const now = new Date().toISOString()
  const rule = (patch: Partial<RecurringRule>): RecurringRule => ({ id: 'r', sourceInvoiceId: '', interval: 'monthly', nextDate: addDaysISO(today, 30), active: true, createdAt: now, updatedAt: now, ...patch })
  const named = (name: string) => ({ ...invoice().buyer, name })

  function setup() {
    const a = invoice({ buyer: named('Kuuklient OÜ') })
    const b = invoice({ buyer: named('Kvartaliklient OÜ') })
    const c = invoice({ buyer: named('Peatatud OÜ'), issueDate: addDaysISO(today, -100) })
    const rules = [
      rule({ id: 'ra', sourceInvoiceId: a.id, nextDate: addDaysISO(today, 12) }),
      rule({ id: 'rb', sourceInvoiceId: b.id, interval: 'quarterly', nextDate: addDaysISO(today, 40) }),
      rule({ id: 'rc', sourceInvoiceId: c.id, active: false, nextDate: addDaysISO(today, -20) }),
    ]
    const repo = createMemoryRepo({ profile, invoices: [a, b, c, invoice({ buyer: named('Muu OÜ') })], recurringRules: rules })
    renderAt('#/', repo)
    return { a, b, c, rules, repo }
  }
  const panel = async () => (await screen.findByRole('region', { name: 'Korduvarved' })) as HTMLElement
  const fmt = (iso: string) => iso.split('-').reverse().join('.')

  it('names the next recurring draft in the list header and opens the overview from it', async () => {
    const { a } = setup()
    const root = await list()
    const hint = within(root).getByRole('button', { name: `Järgmine korduvarve ${fmt(addDaysISO(today, 12))}: Kuuklient OÜ` })
    fireEvent.click(hint)
    const box = await panel()
    const rows = within(box).getAllByRole('listitem')
    expect(rows.map((r) => r.querySelector('.row-client')?.textContent)).toEqual(['Kuuklient OÜ', 'Kvartaliklient OÜ', 'Peatatud OÜ'])
    expect(rows[0]).toHaveTextContent(`Iga kuu, järgmine mustand ${fmt(addDaysISO(today, 12))}`)
    expect(rows[0]).toHaveTextContent(/124,00/)
    expect(rows[1]).toHaveTextContent('Iga kvartal, järgmine mustand')
    expect(rows[2]).toHaveTextContent('Iga kuu, peatatud')
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', `#/?id=${a.id}`)
    // Also under "More filters".
    expect(within(root).getByRole('combobox', { name: 'Rohkem filtreid' })).toHaveValue('recurring')
  })

  it('pauses a rule with undo, resumes a paused one without catching up, and stops one', async () => {
    const { rules, repo } = setup()
    const root = await list()
    fireEvent.change(within(root).getByRole('combobox', { name: 'Rohkem filtreid' }), { target: { value: 'recurring' } })
    const box = await panel()
    await act(async () => {
      fireEvent.click(within(box).getByRole('button', { name: 'Peata kordumine: Kuuklient OÜ' }))
    })
    expect(repo.saveRecurringRule).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'ra', active: false }))
    expect(await screen.findByText('Kordumine on peatatud: Kuuklient OÜ. Uusi mustandeid ei koostata.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Võta tagasi' }))
    })
    expect(repo.saveRecurringRule).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'ra', active: true, nextDate: rules[0].nextDate }))

    await act(async () => {
      fireEvent.click(within(box).getByRole('button', { name: 'Jätka kordumist: Peatatud OÜ' }))
    })
    const resumed = repo.saveRecurringRule.mock.lastCall![0] as RecurringRule
    expect(resumed).toMatchObject({ id: 'rc', active: true })
    expect(resumed.nextDate > today).toBe(true)

    await act(async () => {
      fireEvent.click(within(box).getByRole('button', { name: 'Lõpeta kordumine: Kvartaliklient OÜ' }))
    })
    expect(repo.deleteRecurringRule).toHaveBeenCalledWith('rb')
    expect(await screen.findByText('Kordumine on lõpetatud: Kvartaliklient OÜ. Varem koostatud arved jäävad alles.')).toBeInTheDocument()
    expect(within(box).queryByText('Kvartaliklient OÜ')).not.toBeInTheDocument()
  })

  it("lets an older toast's undo take back only its own change", async () => {
    const { rules, repo } = setup()
    const root = await list()
    fireEvent.change(within(root).getByRole('combobox', { name: 'Rohkem filtreid' }), { target: { value: 'recurring' } })
    const box = await panel()
    const undoIn = async (text: string | RegExp) => within((await screen.findByText(text)).closest('.toast') as HTMLElement).getByRole('button', { name: 'Võta tagasi' })

    await act(async () => {
      fireEvent.click(within(box).getByRole('button', { name: 'Peata kordumine: Kuuklient OÜ' }))
    })
    const undoPause = await undoIn('Kordumine on peatatud: Kuuklient OÜ. Uusi mustandeid ei koostata.')
    // Changed elsewhere afterwards (e.g. another tab): quarterly from now on.
    await act(async () => {
      await repo.saveRecurringRule({ ...rules[0], active: false, interval: 'quarterly' })
    })
    await act(async () => {
      fireEvent.click(undoPause)
    })
    expect(repo.saveRecurringRule).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'ra', active: true, interval: 'quarterly' }))

    // Resumed, then paused again: the resume's undo has nothing left to take back.
    await act(async () => {
      fireEvent.click(within(box).getByRole('button', { name: 'Jätka kordumist: Peatatud OÜ' }))
    })
    const undoResume = await undoIn(/^Kordumine jätkub: Peatatud OÜ/)
    await act(async () => {
      fireEvent.click(within(box).getByRole('button', { name: 'Peata kordumine: Peatatud OÜ' }))
    })
    const saves = repo.saveRecurringRule.mock.calls.length
    await act(async () => {
      fireEvent.click(undoResume)
    })
    expect(await screen.findByText('Tagasi võtta ei saa: korduvarve seadistust (Peatatud OÜ) on vahepeal muudetud.')).toBeInTheDocument()
    expect(repo.saveRecurringRule.mock.calls.length).toBe(saves)
  })

  it('"Ei kordu" on an invoice stops its rule (with undo), so only paused rules stay under "Peatatud"', async () => {
    const { a, c, rules, repo } = setup()
    window.location.hash = `#/?id=${a.id}`
    const select = (await screen.findByLabelText('Kordumine')) as HTMLSelectElement
    await act(async () => {
      fireEvent.change(select, { target: { value: 'none' } })
    })
    expect(repo.deleteRecurringRule).toHaveBeenCalledWith('ra')
    expect(repo.saveRecurringRule).not.toHaveBeenCalled()
    const toast = (await screen.findByText('Kordumine on lõpetatud: Kuuklient OÜ. Varem koostatud arved jäävad alles.')).closest('.toast') as HTMLElement
    const root = await list()
    fireEvent.change(within(root).getByRole('combobox', { name: 'Rohkem filtreid' }), { target: { value: 'recurring' } })
    let box = await panel()
    expect(within(box).queryByText('Kuuklient OÜ')).not.toBeInTheDocument()
    // A rule switched off by an earlier version (inactive, not removed) still shows as paused.
    expect(within(within(box).getByRole('list', { name: 'Peatatud' })).getByText('Peatatud OÜ')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(toast).getByRole('button', { name: 'Võta tagasi' }))
    })
    expect(repo.saveRecurringRule).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'ra', active: true, nextDate: rules[0].nextDate }))
    box = await panel()
    expect(await within(box).findByText('Kuuklient OÜ')).toBeInTheDocument()
    // The paused rule's own invoice says it is paused.
    window.location.hash = `#/?id=${c.id}`
    expect(await screen.findByText('Kordumine on peatatud. Jätkamiseks vali sagedus.')).toBeInTheDocument()
  })

  it('shows no hint and no filter without recurring invoices', async () => {
    renderAt('#/', createMemoryRepo({ profile, invoices: [invoice()] }))
    const root = await list()
    expect(within(root).queryByRole('button', { name: /^Järgmine korduvarve/ })).not.toBeInTheDocument()
    expect(within(root).queryByRole('option', { name: 'Korduvarved' })).not.toBeInTheDocument()
  })
})
