import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EcbRateError, fetchEcbRate } from '../../integrations/ecb'
import { AppProvider } from '../AppContext'
import { createMemoryRepo } from '../testing/memoryRepo'
import { ExchangeRateButton } from './ExchangeRateButton'

vi.mock('../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../storage')>()),
  subscribe: () => () => undefined,
}))
vi.mock('../../integrations/ecb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../integrations/ecb')>()),
  fetchEcbRate: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.mocked(fetchEcbRate).mockReset()
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

  it('ignores a rate that arrives after the currency or date changed', async () => {
    let resolve: (v: Awaited<ReturnType<typeof fetchEcbRate>>) => void = () => undefined
    vi.mocked(fetchEcbRate).mockImplementation(() => new Promise((r) => (resolve = r)))
    const onRate = vi.fn()
    const repo = createMemoryRepo()
    const { rerender } = render(
      <AppProvider repository={repo}>
        <ExchangeRateButton currency="USD" date="2026-10-11" onRate={onRate} />
      </AppProvider>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Too EKP kurss' }))
    })
    rerender(
      <AppProvider repository={repo}>
        <ExchangeRateButton currency="USD" date="2026-10-12" onRate={onRate} />
      </AppProvider>,
    )
    await act(async () => {
      resolve({ currency: 'USD', rate: 1.0832, date: '2026-10-09' })
    })
    expect(onRate).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.getByRole('button', { name: 'Too EKP kurss' })).toBeEnabled()
  })
})
