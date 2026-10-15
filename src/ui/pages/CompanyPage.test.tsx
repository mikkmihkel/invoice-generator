import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
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
