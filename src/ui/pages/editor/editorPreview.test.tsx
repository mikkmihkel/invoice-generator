import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../../App'
import { createEmptyInvoice, type Invoice } from '../../../domain'
import { createMemoryRepo, sampleProfile } from '../../testing/memoryRepo'
import { newClient } from '../../util'
import { pdfPageCount } from './previewPages'

vi.mock('../../../registry', async () => (await import('../../testing/mocks')).registryMock())
vi.mock('../../../pdf', async () => (await import('../../testing/mocks')).pdfMock())
vi.mock('../../../integrations', async () => (await import('../../testing/mocks')).integrationsMock())
vi.mock('../../../einvoice', async () => (await import('../../testing/mocks')).einvoiceMock())
vi.mock('../../components/brand/pdfRaster', () => ({
  renderPdfPageImage: vi.fn(async (_pdf: Blob, width: number, page = 1) => ({ src: `data:image/png;base64,page${page}`, width, height: Math.round(width * 1.414) })),
}))
vi.mock('../../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../storage')>()),
  getRepository: () => {
    throw new Error('tests pass a repository explicitly')
  },
  subscribe: () => () => undefined,
}))

const PREVIEW_KEY = 'invoice-generator:editorPreview'

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

beforeEach(async () => {
  const { renderInvoicePdf } = await import('../../../pdf')
  vi.mocked(renderInvoicePdf).mockClear()
  const { renderPdfPageImage } = await import('../../components/brand/pdfRaster')
  vi.mocked(renderPdfPageImage).mockClear()
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
  localStorage.clear()
})

const profile = sampleProfile()
const client = newClient({
  name: 'Ostja AS',
  registryCode: '10000001',
  address: { street: 'Rüütli 1', city: 'Pärnu', postalCode: '80010', country: 'EE' },
})

function validDraft(patch: Partial<Invoice> = {}): Invoice {
  const inv = createEmptyInvoice(profile, client)
  return { ...inv, lines: [{ ...inv.lines[0], description: 'Arendus', unitPrice: 100 }], ...patch }
}

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

async function mocks() {
  const { renderInvoicePdf } = await import('../../../pdf')
  const { renderPdfPageImage } = await import('../../components/brand/pdfRaster')
  return { renderPdf: vi.mocked(renderInvoicePdf), raster: vi.mocked(renderPdfPageImage) }
}

describe('live preview panel', () => {
  it('docks beside the editable form, re-renders after edits without dropping the page, and remembers being open', async () => {
    const { renderPdf } = await mocks()
    const draft = validDraft()
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [draft] })
    const { unmount } = renderAt(`#/invoices/${draft.id}`, repo)
    const toggle = await screen.findByRole('button', { name: 'Eelvaade' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(renderPdf).not.toHaveBeenCalled()

    fireEvent.click(toggle)
    const panel = await screen.findByRole('complementary', { name: 'Eelvaade' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const page = await within(panel).findByRole('img', { name: 'Arve PDF-eelvaade' })
    expect(page).toHaveAttribute('src', 'data:image/png;base64,page1')
    expect(renderPdf).toHaveBeenCalledTimes(1)
    expect(renderPdf.mock.calls[0][1]).toEqual({ embedEInvoice: false })
    expect(within(panel).getByRole('button', { name: 'Mustandi PDF' })).toBeInTheDocument()

    // The form stays editable; the preview follows after a pause, keeping the old page meanwhile.
    fireEvent.change(screen.getByLabelText('Kirjeldus 1'), { target: { value: 'Konsultatsioon' } })
    expect(within(panel).getByRole('img', { name: 'Arve PDF-eelvaade' })).toBe(page)
    await waitFor(() => expect(renderPdf).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect(renderPdf.mock.calls[1][0]).toMatchObject({ lines: [expect.objectContaining({ description: 'Konsultatsioon' })] })
    expect(localStorage.getItem(PREVIEW_KEY)).toBe('1')

    unmount()
    renderAt(`#/invoices/${draft.id}`, repo)
    expect(await screen.findByRole('complementary', { name: 'Eelvaade' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sulge eelvaade' }))
    expect(screen.queryByRole('complementary', { name: 'Eelvaade' })).not.toBeInTheDocument()
    expect(localStorage.getItem(PREVIEW_KEY)).toBe('0')
  })

  it('shows every page of a longer invoice', async () => {
    const { renderPdf, raster } = await mocks()
    renderPdf.mockResolvedValueOnce(new Blob(['%PDF-1.3\n2 0 obj\n<<\n/Type /Pages\n/Count 2\n/Kids [3 0 R 5 0 R]\n>>\nendobj'], { type: 'application/pdf' }))
    const draft = validDraft()
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [draft] })
    renderAt(`#/invoices/${draft.id}`, repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Eelvaade' }))
    const panel = await screen.findByRole('complementary', { name: 'Eelvaade' })
    expect(await within(panel).findByRole('img', { name: 'Arve PDF-eelvaade, lehekülg 2/2' })).toHaveAttribute('src', 'data:image/png;base64,page2')
    expect(within(panel).getByRole('img', { name: 'Arve PDF-eelvaade, lehekülg 1/2' })).toBeInTheDocument()
    expect(raster.mock.calls.map((c) => c[2])).toEqual([1, 2])
  })

  it('falls back to the PDF itself when pages cannot be drawn, reuses it on reopening and revokes it on unmount', async () => {
    const { renderPdf, raster } = await mocks()
    raster.mockRejectedValueOnce(new Error('no canvas'))
    vi.mocked(URL.revokeObjectURL).mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const draft = validDraft()
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [draft] })
    const { unmount } = renderAt(`#/invoices/${draft.id}`, repo)
    const toggle = await screen.findByRole('button', { name: 'Eelvaade' })
    fireEvent.click(toggle)
    const panel = await screen.findByRole('complementary', { name: 'Eelvaade' })
    expect(await within(panel).findByTitle('Arve PDF-eelvaade')).toHaveAttribute('src', expect.stringContaining('blob:preview'))
    // Escape inside the panel closes it and returns focus to the toggle.
    within(panel).getByRole('button', { name: 'Sulge eelvaade' }).focus()
    fireEvent.keyDown(within(panel).getByRole('button', { name: 'Sulge eelvaade' }), { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Eelvaade' })).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
    fireEvent.click(toggle)
    await screen.findByRole('complementary', { name: 'Eelvaade' })
    expect(renderPdf).toHaveBeenCalledTimes(1)
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('opens when a template is picked', async () => {
    const draft = validDraft()
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [draft] })
    renderAt(`#/invoices/${draft.id}`, repo)
    await screen.findByRole('button', { name: 'Eelvaade' })
    expect(screen.queryByRole('complementary', { name: 'Eelvaade' })).not.toBeInTheDocument()
    const other = screen.getAllByRole('radio').find((r) => !(r as HTMLInputElement).checked && (r as HTMLInputElement).name && /modern|classic/.test((r as HTMLInputElement).value))!
    fireEvent.click(other)
    expect(await screen.findByRole('complementary', { name: 'Eelvaade' })).toBeInTheDocument()
  })

  it('reads the page count of a pdfmake document', async () => {
    expect(await pdfPageCount(new Blob(['<<\n/Type /Pages\n/Count 3\n/Kids [1 0 R]\n>>']))).toBe(3)
    expect(await pdfPageCount(new Blob(['%PDF-1.7']))).toBe(1)
  })
})

describe('text rows around the lines', () => {
  it('adds, edits, reorders and removes rows before and after the lines', async () => {
    const draft = validDraft()
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [draft] })
    renderAt(`#/invoices/${draft.id}`, repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Lisa rida enne arveridu' }))
    const first = screen.getByRole('textbox', { name: 'Tekst enne arveridu, rida 1' })
    expect(first).toHaveAttribute('placeholder', 'Nt: Vastavalt lepingule nr 12/2026')
    fireEvent.change(first, { target: { value: 'Vastavalt lepingule nr 12/2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lisa rida enne arveridu' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Tekst enne arveridu, rida 2' }), { target: { value: 'Teine rida\nkahel real' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tekst enne arveridu: liiguta rida 2 üles' }))
    expect(screen.getByRole('textbox', { name: 'Tekst enne arveridu, rida 1' })).toHaveValue('Teine rida\nkahel real')

    fireEvent.click(screen.getByRole('button', { name: 'Lisa rida pärast arveridu' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Tekst pärast arveridu, rida 1' }), { target: { value: 'Täname koostöö eest!' } })

    await waitFor(
      () =>
        expect(repo.saveInvoice.mock.calls.at(-1)?.[0]).toMatchObject({
          textBefore: ['Teine rida\nkahel real', 'Vastavalt lepingule nr 12/2026'],
          textAfter: ['Täname koostöö eest!'],
        }),
      { timeout: 3000 },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Tekst pärast arveridu: eemalda rida 1' }))
    expect(screen.queryByRole('textbox', { name: /Tekst pärast arveridu/ })).not.toBeInTheDocument()
    await waitFor(() => expect(repo.saveInvoice.mock.calls.at(-1)?.[0].textAfter).toBeUndefined(), { timeout: 3000 })
  })

  it('shows the printed rows read-only on an issued invoice', async () => {
    const issued = validDraft({
      number: '2026-0004',
      status: 'issued',
      issuedAt: new Date().toISOString(),
      textBefore: ['Vastavalt lepingule nr 12/2026', '  '],
      textAfter: ['Täname koostöö eest!'],
    })
    const repo = createMemoryRepo({ profile, clients: [client], invoices: [issued] })
    renderAt(`#/invoices/${issued.id}`, repo)
    const before = await screen.findByRole('group', { name: 'Tekst enne arveridu' })
    expect(within(before).getByText('Vastavalt lepingule nr 12/2026')).toBeInTheDocument()
    expect(within(before).queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.getByRole('group', { name: 'Tekst pärast arveridu' })).toHaveTextContent('Täname koostöö eest!')
    expect(screen.queryByRole('button', { name: /Lisa rida (enne|pärast) arveridu/ })).not.toBeInTheDocument()
    await act(async () => undefined)
  })
})
