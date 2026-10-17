import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { setAutoBackupStatus } from '../../integrations/autoBackup'
import { createRepository } from '../../storage'
import { makeInvoice, makeProfile } from '../../storage/testFixtures'
import { createMemoryRepo, sampleProfile } from '../testing/memoryRepo'

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

describe('company page: Arve kujundus', () => {
  it('edits the default template and brand colours and saves them', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    window.location.hash = '#/company'
    render(<App repository={repo} />)

    const section = (await screen.findByRole('heading', { name: 'Arve kujundus' })).closest('section')!
    const design = within(section)
    expect(design.getByRole('group', { name: 'Kujundus' })).toBeInTheDocument()
    expect(design.getByText('Eelvaade')).toBeInTheDocument()

    fireEvent.click(design.getByRole('radio', { name: /Moodne/ }))
    fireEvent.click(design.getByRole('radio', { name: 'Kahevärviline' }))
    fireEvent.change(design.getByLabelText('Põhivärv', { selector: 'input.color-hex' }), { target: { value: '#0B5D7A' } })
    fireEvent.change(design.getByLabelText('Lisavärv'), { target: { value: 'e07a10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvesta' }))

    await waitFor(() => expect(repo.saveProfile).toHaveBeenCalledTimes(1))
    expect(repo.saveProfile.mock.calls[0][0].defaults).toMatchObject({ templateId: 'modern', colorMode: 'duo', accentColor: '#0b5d7a', secondaryColor: '#e07a10' })
  })
})

describe('company page: default text rows', () => {
  it('adds, edits, reorders and removes the rows before/after the invoice lines; blank rows are not saved', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    window.location.hash = '#/company'
    render(<App repository={repo} />)

    const section = within((await screen.findByRole('heading', { name: 'Arve vaikeseaded' })).closest('section')!)
    const before = within(section.getByRole('group', { name: 'Tekst enne arveridu' }))
    fireEvent.click(before.getByRole('button', { name: 'Lisa tekstirida enne arveridu' }))
    fireEvent.click(before.getByRole('button', { name: 'Lisa tekstirida enne arveridu' }))
    fireEvent.change(before.getByRole('textbox', { name: 'Tekst enne arveridu, rida 1' }), { target: { value: 'Esimene' } })
    fireEvent.change(before.getByRole('textbox', { name: 'Tekst enne arveridu, rida 2' }), { target: { value: 'Vastavalt lepingule nr 12/2026' } })
    expect(before.getByRole('button', { name: 'Tekst enne arveridu: liiguta rida 1 üles' })).toBeDisabled()
    fireEvent.click(before.getByRole('button', { name: 'Tekst enne arveridu: liiguta rida 2 üles' }))
    expect(before.getByRole('textbox', { name: 'Tekst enne arveridu, rida 1' })).toHaveValue('Vastavalt lepingule nr 12/2026')

    const after = within(section.getByRole('group', { name: 'Tekst pärast arveridu' }))
    fireEvent.click(after.getByRole('button', { name: 'Lisa tekstirida pärast arveridu' }))
    fireEvent.click(after.getByRole('button', { name: 'Lisa tekstirida pärast arveridu' }))
    fireEvent.change(after.getByRole('textbox', { name: 'Tekst pärast arveridu, rida 1' }), { target: { value: 'Täname koostöö eest!' } })
    fireEvent.click(after.getByRole('button', { name: 'Tekst pärast arveridu: eemalda rida 1' }))
    expect(after.getByRole('textbox', { name: 'Tekst pärast arveridu, rida 1' })).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'Salvesta' }))
    await waitFor(() => expect(repo.saveProfile).toHaveBeenCalledTimes(1))
    const saved = repo.saveProfile.mock.calls[0][0].defaults
    expect(saved.textBefore).toEqual(['Vastavalt lepingule nr 12/2026', 'Esimene'])
    expect(saved).not.toHaveProperty('textAfter')
  })
})

describe('company page: number series and other tabs', () => {
  it('keeps numbers issued in another tab when saving an older copy of the profile', async () => {
    const dbName = `company-page-${Math.random()}`
    const repo = createRepository({ dbName })
    const otherTab = createRepository({ dbName })
    await repo.saveProfile(makeProfile({ numbering: { prefix: 'ARVE-', nextNumber: 7, padding: 4 } }))
    window.location.hash = '#/company'
    render(<App repository={repo} />)
    fireEvent.change(await screen.findByLabelText('Veebileht'), { target: { value: 'https://example.ee' } })

    await otherTab.saveInvoice(makeInvoice('i1', { issueDate: '2026-10-15', dueDate: '2026-10-29' }))
    expect((await otherTab.issueInvoice('i1')).number).toBe('ARVE-0007')

    fireEvent.click(screen.getByRole('button', { name: 'Salvesta' }))
    await waitFor(async () => expect((await repo.getProfile())?.website).toBe('https://example.ee'))
    expect((await repo.getProfile())?.numbering.nextNumber).toBe(8)
  })

  it('lowers the next number only when it was set lower on purpose', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile({ numbering: { prefix: 'ARVE-', nextNumber: 20, padding: 4 } }) })
    window.location.hash = '#/company'
    render(<App repository={repo} />)
    const section = within((await screen.findByRole('heading', { name: 'Arvete numeratsioon' })).closest('section')!)
    fireEvent.change(section.getByLabelText('Järgmine number'), { target: { value: '5' } })
    fireEvent.blur(section.getByLabelText('Järgmine number'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvesta' }))
    await waitFor(() => expect(repo.saveProfile).toHaveBeenCalledTimes(1))
    expect(repo.saveProfile).toHaveBeenNthCalledWith(1, expect.objectContaining({ numbering: expect.objectContaining({ nextNumber: 5 }) }), {
      allowLowerNumbering: { invoice: true, quote: false },
    })

    fireEvent.change(section.getByLabelText('Järgmine number'), { target: { value: '30' } })
    fireEvent.blur(section.getByLabelText('Järgmine number'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvesta' }))
    await waitFor(() => expect(repo.saveProfile).toHaveBeenCalledTimes(2))
    expect(repo.saveProfile).toHaveBeenNthCalledWith(2, expect.objectContaining({ numbering: expect.objectContaining({ nextNumber: 30 }) }), {
      allowLowerNumbering: { invoice: false, quote: false },
    })
  })
})

describe('shell: automatic backup indicator', () => {
  it('says in the footer when automatic backup is waiting', async () => {
    // The status is shared module state: start from a known one whatever ran before in this worker.
    setAutoBackupStatus({ phase: 'idle' })
    const repo = createMemoryRepo({ profile: sampleProfile() })
    window.location.hash = '#/company'
    render(<App repository={repo} />)
    // Wait for the loaded company page (its form), so the shell does not re-render underneath the assertions.
    await screen.findByRole('heading', { name: 'Arve kujundus' })
    const footer = () => within(screen.getByRole('contentinfo'))
    expect(await footer().findByRole('link', { name: 'Tee varukoopia' })).toBeInTheDocument()
    act(() => setAutoBackupStatus({ phase: 'pending', reason: 'signin' }))
    expect(await footer().findByRole('link', { name: 'Automaatne varundus ootab' })).toHaveAttribute('href', '#/settings')
    act(() => setAutoBackupStatus({ phase: 'idle' }))
    expect(await footer().findByRole('link', { name: 'Tee varukoopia' })).toBeInTheDocument()
  })
})
