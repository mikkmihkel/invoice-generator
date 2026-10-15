import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { creditNoteInvoice, sampleInvoice } from '../../../pdf/testFixtures'
import type { Repository } from '../../../storage'
import { AppProvider } from '../../AppContext'
import { createMemoryRepo, sampleProfile } from '../../testing/memoryRepo'
import { ToastProvider } from '../../Toasts'
import ExportSection from './ExportSection'

vi.mock('../../../pdf', async () => (await import('../../testing/mocks')).pdfMock())
vi.mock('../../../einvoice', async () => (await import('../../testing/mocks')).einvoiceMock())
vi.mock('../../../integrations', async () => (await import('../../testing/mocks')).integrationsMock())
vi.mock('../../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../storage')>()),
  getRepository: () => {
    throw new Error('tests pass a repository explicitly')
  },
  subscribe: () => () => undefined,
}))

const { downloadBlob } = await import('../../../integrations')
const { renderInvoicePdf } = await import('../../../pdf')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 15, 12, 0))
  vi.mocked(downloadBlob).mockClear()
  vi.mocked(renderInvoicePdf).mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const invoices = [
  sampleInvoice({ id: 'a', number: '2026-0005', issueDate: '2026-09-03' }),
  creditNoteInvoice({ id: 'b', number: '2026-0006', issueDate: '2026-09-20' }),
  sampleInvoice({ id: 'c', number: '2026-0007', issueDate: '2026-10-02' }),
  sampleInvoice({ id: 'd', number: '', status: 'draft', issueDate: '2026-09-10' }),
  sampleInvoice({ id: 'e', number: 'HP-2026-001', type: 'quote', issueDate: '2026-09-11' }),
]

function setup(repo: Repository) {
  render(
    <AppProvider repository={repo}>
      <ToastProvider>
        <ExportSection />
      </ToastProvider>
    </AppProvider>,
  )
}

async function blobText(call: number): Promise<string> {
  const blob = vi.mocked(downloadBlob).mock.calls[call][0] as Blob
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blob.arrayBuffer())
}

describe('accountant export section', () => {
  it('exports last month’s invoices and credit notes as CSV, without drafts and quotes', async () => {
    setup(createMemoryRepo({ profile: sampleProfile(), invoices }))
    expect(await screen.findByText(/Valitud dokumente: 2/)).toBeInTheDocument()
    expect(screen.getByText('01.09.2026–30.09.2026')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Laadi alla CSV' }))
    expect(downloadBlob).toHaveBeenCalledTimes(1)
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('arved_2026-09-01_2026-09-30.csv')
    const csv = await blobText(0)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const rows = csv.trim().split('\r\n')
    expect(rows).toHaveLength(3)
    expect(rows[1].startsWith('2026-0005;Arve;03.09.2026')).toBe(true)
    expect(rows[2].startsWith('2026-0006;Kreeditarve;20.09.2026')).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Kreeditarved' }))
    expect(await screen.findByText(/Valitud dokumente: 1/)).toBeInTheDocument()
  })

  it('uses a custom period and validates it', async () => {
    setup(createMemoryRepo({ profile: sampleProfile(), invoices }))
    await screen.findByText(/Valitud dokumente/)
    fireEvent.change(screen.getByLabelText('Periood'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Alates'), { target: { value: '2026-09-15' } })
    fireEvent.change(screen.getByLabelText('Kuni'), { target: { value: '2026-10-31' } })
    expect(await screen.findByText(/Valitud dokumente: 2/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Kuni'), { target: { value: '2026-09-01' } })
    expect(screen.getAllByText('Alguskuupäev ei saa olla hilisem kui lõppkuupäev.').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Laadi alla CSV' })).toBeDisabled()
  })

  it('builds the ZIP with progress and can be cancelled', async () => {
    setup(createMemoryRepo({ profile: sampleProfile(), invoices }))
    await screen.findByText(/Valitud dokumente: 2/)
    fireEvent.click(screen.getByRole('button', { name: /Laadi alla ZIP/ }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0]
    expect(name).toBe('arved_2026-09-01_2026-09-30.zip')
    expect((blob as Blob).type).toBe('application/zip')
    expect(renderInvoicePdf).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Fail arved_2026-09-01_2026-09-30.zip on alla laaditud.')).toBeInTheDocument()

    let release!: () => void
    vi.mocked(renderInvoicePdf).mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(new Blob(['%PDF'])))))
    fireEvent.click(screen.getByRole('button', { name: /Laadi alla ZIP/ }))
    const status = (await screen.findByText('Koostan PDF-faile: 0 / 2')).closest<HTMLElement>('[role="status"]')!
    fireEvent.click(within(status).getByRole('button', { name: 'Katkesta' }))
    release()
    expect(await screen.findByText('Eksport katkestati.')).toBeInTheDocument()
    expect(downloadBlob).toHaveBeenCalledTimes(1)
  })
})
