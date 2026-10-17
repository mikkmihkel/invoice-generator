import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createDefaultSettings, type BackupFile } from '../domain'
import { notifyChange } from '../storage'
import { AppProvider, useApp } from './AppContext'
import { createMemoryRepo, sampleProfile } from './testing/memoryRepo'

vi.mock('../registry', async () => (await import('./testing/mocks')).registryMock())
vi.mock('../pdf', async () => (await import('./testing/mocks')).pdfMock())
vi.mock('../integrations', async () => (await import('./testing/mocks')).integrationsMock())
vi.mock('../einvoice', async () => (await import('./testing/mocks')).einvoiceMock())
vi.mock('./pages/ClientsPage', () => ({
  default: () => {
    throw new Error('ClientsPage exploded')
  },
}))

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
  vi.restoreAllMocks()
})

function renderAt(hash: string, repo: ReturnType<typeof createMemoryRepo>) {
  window.location.hash = hash
  return render(<App repository={repo} />)
}

describe('route error boundary', () => {
  it('keeps the navigation usable when a page crashes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderAt('#/clients', createMemoryRepo({ profile: sampleProfile() }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Seda vaadet ei õnnestunud kuvada')
    expect(within(alert).getByText('ClientsPage exploded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Seaded' }))
    expect(await screen.findByRole('heading', { name: 'Seaded', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

const backupFile = (data: unknown) => new File([JSON.stringify(data)], 'backup.json', { type: 'application/json' })

describe('backup import', () => {
  it('names the broken record and field instead of a generic error', async () => {
    renderAt('#/settings', createMemoryRepo({ profile: sampleProfile() }))
    const input = (await screen.findByText('Impordi varukoopia…')).querySelector('input')!
    const bad = { app: 'invoice-generator', version: 1, exportedAt: '2026-10-01T00:00:00Z', profile: null, settings: null, clients: [{ id: 'c1', name: 'X' }], invoices: [] }
    await act(async () => {
      fireEvent.change(input, { target: { files: [backupFile(bad)] } })
    })
    expect(await screen.findByText(/^Varukoopiat ei saa importida\. Varukoopias on vigane klientide 1\. kirje: /)).toBeInTheDocument()
  })

  it('asks to confirm changed IBANs and keeps the current Google client ID by default', async () => {
    const profile = sampleProfile()
    const settings = { ...createDefaultSettings(), googleClientId: '1-own.apps.googleusercontent.com' }
    const repo = createMemoryRepo({ profile, settings })
    renderAt('#/settings', repo)
    const input = (await screen.findByText('Impordi varukoopia…')).querySelector('input')!
    const backup: BackupFile = {
      app: 'invoice-generator',
      version: 1,
      exportedAt: '2026-10-01T00:00:00Z',
      profile: { ...profile, bankAccounts: [{ id: 'x', iban: 'EE471000001020145685' }] },
      settings: { ...settings, googleClientId: '2-other.apps.googleusercontent.com' },
      clients: [],
      invoices: [],
    }
    await act(async () => {
      fireEvent.change(input, { target: { files: [backupFile(backup)] } })
    })
    const dialog = await screen.findByRole('dialog', { name: 'Impordi varukoopia' })
    expect(within(dialog).getByText('Varukoopia muudab makseandmeid')).toBeInTheDocument()
    expect(within(dialog).getByText('EE38 2200 2210 2014 5685')).toBeInTheDocument()
    expect(within(dialog).getByText('EE47 1000 0010 2014 5685')).toBeInTheDocument()
    const merge = within(dialog).getByRole('button', { name: 'Ühenda' })
    expect(merge).toBeDisabled()
    expect(within(dialog).getByLabelText('Impordi ka Google’i kliendi ID')).not.toBeChecked()
    fireEvent.click(within(dialog).getByLabelText('Olen muudatused üle vaadanud ja kinnitan need'))
    expect(merge).toBeEnabled()
    await act(async () => {
      fireEvent.click(merge)
    })
    expect(repo.importBackup).toHaveBeenCalledTimes(1)
    const [imported] = repo.importBackup.mock.calls[0] as unknown as [BackupFile]
    expect(imported.settings?.googleClientId).toBe('1-own.apps.googleusercontent.com')
    expect(imported.profile?.bankAccounts[0].iban).toBe('EE471000001020145685')
  })
})

describe('settings', () => {
  it('rejects a malformed Google client ID', async () => {
    const repo = createMemoryRepo({ profile: sampleProfile() })
    renderAt('#/settings', repo)
    const field = await screen.findByLabelText(/^OAuth-kliendi ID/)
    fireEvent.change(field, { target: { value: 'https://evil.example' } })
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/Kliendi ID peab olema kujul/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvesta' })[0])
    await act(async () => {})
    expect(repo.saveSettings).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '123456789-abc123.apps.googleusercontent.com' } })
    expect(field).not.toHaveAttribute('aria-invalid')
  })
})

describe('onboarding', () => {
  it('discloses that live register search sends queries to RIK', async () => {
    renderAt('#/', createMemoryRepo())
    expect(await screen.findByText(/saadetakse sisestatud tekst ka RIKi serverisse/)).toBeInTheDocument()
  })
})

describe('AppProvider change events', () => {
  function Probe() {
    const { invoices } = useApp()
    return <p>count {invoices.length}</p>
  }

  it('ignores its own single-area writes and reloads after bulk changes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const repo = createMemoryRepo({ profile: sampleProfile() })
      render(
        <AppProvider repository={repo}>
          <Probe />
        </AppProvider>,
      )
      await screen.findByText('count 0')
      expect(repo.listInvoices).toHaveBeenCalledTimes(1)
      act(() => notifyChange('invoices', 'x'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      expect(repo.listInvoices).toHaveBeenCalledTimes(1)
      act(() => notifyChange('all'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      await waitFor(() => expect(repo.listInvoices).toHaveBeenCalledTimes(2))
    } finally {
      vi.useRealTimers()
    }
  })
})
