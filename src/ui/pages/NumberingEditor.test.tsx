import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { localTodayISO } from '../util'
import { createMemoryRepo, sampleProfile } from '../testing/memoryRepo'
import type { Invoice } from '../../domain'

vi.mock('../../registry', async () => (await import('../testing/mocks')).registryMock())
vi.mock('../../pdf', async () => (await import('../testing/mocks')).pdfMock())
vi.mock('../../integrations', async () => (await import('../testing/mocks')).integrationsMock())
vi.mock('../../einvoice', async () => (await import('../testing/mocks')).einvoiceMock())
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

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const today = localTodayISO()
const ymd = today.replace(/-/g, '')
const year = today.slice(0, 4)

function issued(number: string): Invoice {
  const profile = sampleProfile()
  return {
    id: number,
    number,
    type: 'invoice',
    status: 'issued',
    issueDate: today,
    dueDate: today,
    seller: profile,
    buyer: { kind: 'company', name: 'Klient AS', address: { street: 'Pikk 1', city: 'Tartu', postalCode: '51004', country: 'EE' } },
    bankAccountIds: [],
    lines: [],
    currency: 'EUR',
    vatScheme: 'domestic',
    language: 'et',
    templateId: 'standard',
    accentColor: '#1f4e79',
    createdAt: `${today}T00:00:00.000Z`,
    updatedAt: `${today}T00:00:00.000Z`,
  }
}

async function openSection(name: string) {
  return within((await screen.findByRole('heading', { name })).closest('section')!)
}

describe('company page: numbering', () => {
  it('picks the per-day preset, previews the next numbers and saves the series', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile({ numbering: { prefix: '{YYYY}-', nextNumber: 1, padding: 4, reset: 'yearly', counters: {} } }) })
    window.location.hash = '#/company'
    render(<App repository={repo} />)
    const section = await openSection('Arvete numeratsioon')
    expect(section.getByRole('radio', { name: `${year}-0001` })).toBeChecked()

    fireEvent.click(section.getByRole('radio', { name: `${ymd}001` }))
    expect(section.getByText(`${ymd}001, ${ymd}002, ${ymd}003`)).toBeInTheDocument()
    expect(section.queryByLabelText('Eesliide')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Salvesta' }))
    await waitFor(() => expect(repo.saveProfile).toHaveBeenCalledTimes(1))
    expect(repo.saveProfile.mock.calls[0][0].numbering).toMatchObject({ prefix: '{YYYYMMDD}', padding: 3, reset: 'daily' })
  })

  it('continues after used numbers when a preset is chosen, and warns when the number is set below them', async () => {
    const repo = createMemoryRepo({
      profile: sampleProfile({ numbering: { prefix: 'X-', nextNumber: 1, padding: 4 } }),
      invoices: [issued(`${year}-0007`)],
    })
    window.location.hash = '#/company'
    render(<App repository={repo} />)
    const section = await openSection('Arvete numeratsioon')
    expect(section.getByRole('radio', { name: 'Kohandatud' })).toBeChecked()
    expect(section.getByLabelText('Eesliide')).toHaveValue('X-')

    fireEvent.click(section.getByRole('radio', { name: `${year}-0001` }))
    expect(section.getByLabelText('Järgmine number')).toHaveValue('8')
    expect(section.queryByText(/on selles seerias juba kasutatud/)).toBeNull()

    fireEvent.change(section.getByLabelText('Järgmine number'), { target: { value: '2' } })
    fireEvent.blur(section.getByLabelText('Järgmine number'))
    expect(await section.findByText(new RegExp(`Numbrid kuni ${year}-0007 on selles seerias juba kasutatud`))).toBeInTheDocument()
    fireEvent.click(section.getByRole('button', { name: 'Jätka numbrist 8' }))
    expect(section.getByLabelText('Järgmine number')).toHaveValue('8')
  })

  it('edits a custom format and flags a prefix that cannot restart per period', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile({ numbering: { prefix: 'ARVE-', nextNumber: 4, padding: 4 } }) })
    window.location.hash = '#/company'
    render(<App repository={repo} />)
    const section = await openSection('Arvete numeratsioon')
    expect(section.getByRole('radio', { name: 'ARVE-0001' })).toBeChecked()
    fireEvent.click(section.getByRole('radio', { name: 'Kohandatud' }))
    fireEvent.change(section.getByLabelText('Number algab uuesti 1-st'), { target: { value: 'yearly' } })
    expect(section.getByText(/peab eesliites olema selle perioodi kuupäev/)).toBeInTheDocument()
    fireEvent.change(section.getByLabelText('Eesliide'), { target: { value: 'A{YY}/{Q}' } })
    expect(section.getByText(/tundmatu märgend \{Q\}/)).toBeInTheDocument()
  })

  it('has its own block for the quote series', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    window.location.hash = '#/company'
    render(<App repository={repo} />)
    const section = await openSection('Hinnapakkumiste numeratsioon')
    expect(section.getByRole('radio', { name: `HP-${year}-001` })).toBeChecked()
    expect(section.getByText(`HP-${year}-001, HP-${year}-002, HP-${year}-003`)).toBeInTheDocument()
    fireEvent.click(section.getByRole('radio', { name: 'HP-0001' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvesta' }))
    await waitFor(() => expect(repo.saveProfile).toHaveBeenCalledTimes(1))
    expect(repo.saveProfile.mock.calls[0][0].quoteNumbering).toMatchObject({ prefix: 'HP-', reset: 'never' })
  })
})
