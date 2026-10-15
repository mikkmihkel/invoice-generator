import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EcbRateError, fetchEcbRate } from '../../integrations/ecb'
import { checkVatNumber } from '../../integrations/vies'
import { AppProvider } from '../AppContext'
import { createMemoryRepo } from '../testing/memoryRepo'
import { ExchangeRateButton } from './ExchangeRateButton'
import { VatNumberCheck } from './VatNumberCheck'

vi.mock('../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../storage')>()),
  subscribe: () => () => undefined,
}))
vi.mock('../../integrations/ecb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../integrations/ecb')>()),
  fetchEcbRate: vi.fn(),
}))
vi.mock('../../integrations/vies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../integrations/vies')>()),
  checkVatNumber: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.mocked(fetchEcbRate).mockReset()
  vi.mocked(checkVatNumber).mockReset()
})

const wrap = (ui: React.ReactNode) => render(<AppProvider repository={createMemoryRepo()}>{ui}</AppProvider>)

describe('ExchangeRateButton', () => {
  it('fills the rate and shows the date it was published for', async () => {
    vi.mocked(fetchEcbRate).mockResolvedValue({ currency: 'USD', rate: 1.0832, date: '2026-10-09' })
    const onRate = vi.fn()
    wrap(<ExchangeRateButton currency="usd" date="2026-10-11" onRate={onRate} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Too EKP kurss' }))
    })
    expect(fetchEcbRate).toHaveBeenCalledWith('USD', '2026-10-11')
    expect(onRate).toHaveBeenCalledWith(1.0832, '2026-10-09')
    expect(screen.getByRole('status')).toHaveTextContent('EKP kurss 09.10.2026 (viimane enne 11.10.2026): 1 EUR = 1,0832 USD')
  })

  it('explains a missing rate and is hidden for euro invoices', async () => {
    vi.mocked(fetchEcbRate).mockRejectedValue(new EcbRateError('not-found'))
    const { rerender } = wrap(<ExchangeRateButton currency="XYZ" date="2026-10-11" onRate={vi.fn()} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Too EKP kurss' }))
    })
    expect(screen.getByRole('status')).toHaveTextContent('valuuta XYZ kurssi avaldanud')
    rerender(
      <AppProvider repository={createMemoryRepo()}>
        <ExchangeRateButton currency="EUR" date="2026-10-11" onRate={vi.fn()} />
      </AppProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Too EKP kurss' })).not.toBeInTheDocument()
  })
})

describe('VatNumberCheck', () => {
  it('shows the registered name of a valid number', async () => {
    vi.mocked(checkVatNumber).mockResolvedValue({ status: 'valid', countryCode: 'EE', vatNumber: '101234567', name: 'NÄIDIS OÜ' })
    wrap(<VatNumberCheck vatNumber="EE101234567" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Kontrolli VIES-is' }))
    })
    expect(checkVatNumber).toHaveBeenCalledWith('EE', '101234567')
    expect(screen.getByText('Kehtiv: NÄIDIS OÜ')).toBeInTheDocument()
  })

  it('says plainly when VIES cannot be reached and links to the official page', async () => {
    vi.mocked(checkVatNumber).mockResolvedValue({ status: 'blocked', countryCode: 'EL', vatNumber: '123456789' })
    wrap(<VatNumberCheck vatNumber="GR123456789" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Kontrolli VIES-is' }))
    })
    expect(screen.getByText(/Brauser ei saanud VIES-iga otse ühendust. Kontrolli numbrit EL123456789/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ava VIES-i leht' })).toHaveAttribute('href', 'https://ec.europa.eu/taxation_customs/vies/#/vat-validation')
  })

  it('separates invalid numbers from an unavailable service, and ignores non-EU numbers', async () => {
    vi.mocked(checkVatNumber).mockResolvedValueOnce({ status: 'invalid', countryCode: 'EE', vatNumber: '100000000' })
    vi.mocked(checkVatNumber).mockResolvedValueOnce({ status: 'unavailable', countryCode: 'EE', vatNumber: '100000000' })
    const { rerender } = wrap(<VatNumberCheck vatNumber="EE100000000" />)
    const button = screen.getByRole('button', { name: 'Kontrolli VIES-is' })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(screen.getByText('VIES-i andmetel see käibemaksukohustuslase number ei kehti.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(button)
    })
    expect(screen.getByText('Liikmesriigi andmebaas ei vasta praegu. Proovi hiljem uuesti.')).toBeInTheDocument()
    rerender(
      <AppProvider repository={createMemoryRepo()}>
        <VatNumberCheck vatNumber="NO123456789" />
      </AppProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Kontrolli VIES-is' })).not.toBeInTheDocument()
  })
})
