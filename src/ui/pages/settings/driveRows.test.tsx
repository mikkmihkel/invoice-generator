import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../../App'
import { createDefaultSettings } from '../../../domain'
import { createMemoryRepo, sampleProfile } from '../../testing/memoryRepo'

vi.mock('../../../registry', async () => (await import('../../testing/mocks')).registryMock())
vi.mock('../../../pdf', async () => (await import('../../testing/mocks')).pdfMock())
vi.mock('../../../integrations', async () => (await import('../../testing/mocks')).integrationsMock())
vi.mock('../../../einvoice', async () => (await import('../../testing/mocks')).einvoiceMock())
vi.mock('../../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../storage')>()),
  getRepository: () => {
    throw new Error('tests pass a repository explicitly')
  },
  subscribe: () => () => undefined,
}))

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function renderSettings(googleClientId?: string) {
  window.location.hash = '#/settings'
  render(<App repository={createMemoryRepo({ profile: sampleProfile(), settings: { ...createDefaultSettings(), googleClientId } })} />)
}

describe('settings: Drive backup without a Google client', () => {
  it('leaves out the Drive backup rows instead of showing them greyed out', async () => {
    renderSettings()
    expect(await screen.findByRole('button', { name: 'Ekspordi varukoopia' })).toBeInTheDocument()
    expect(screen.queryByText('Varukoopia Google Drive’is')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Automaatne varundus Google Drive’i' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salvesta Drive’i' })).not.toBeInTheDocument()
  })

  it('shows them once a client ID is set', async () => {
    renderSettings('123456789-abc123.apps.googleusercontent.com')
    expect(await screen.findByText('Varukoopia Google Drive’is')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Automaatne varundus Google Drive’i' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvesta Drive’i' })).toBeEnabled()
  })
})
