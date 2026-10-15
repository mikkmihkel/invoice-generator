import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkVatNumber, viesBlockedInSession } from '../../integrations/vies'
import { AppProvider } from '../AppContext'
import { createMemoryRepo } from '../testing/memoryRepo'
import { VatNumberCheck } from './VatNumberCheck'

vi.mock('../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../storage')>()),
  subscribe: () => () => undefined,
}))
vi.mock('../../integrations/vies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../integrations/vies')>()),
  checkVatNumber: vi.fn(),
  viesBlockedInSession: vi.fn(() => false),
}))

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.mocked(checkVatNumber).mockReset()
  vi.mocked(viesBlockedInSession).mockReset()
  vi.mocked(viesBlockedInSession).mockReturnValue(false)
})

const wrap = (ui: React.ReactNode) => render(<AppProvider repository={createMemoryRepo()}>{ui}</AppProvider>)
const PAGE = 'https://ec.europa.eu/taxation_customs/vies/#/vat-validation?memberStateCode=EE&number=101234567&locale=et'

async function check() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Kontrolli VIES-is' }))
  })
}

describe('VatNumberCheck', () => {
  it('shows the registered name and address of a valid number', async () => {
    vi.mocked(checkVatNumber).mockResolvedValue({ status: 'valid', countryCode: 'EE', vatNumber: '101234567', name: 'NÄIDIS OÜ', address: 'Narva mnt 5, Tallinn' })
    const onResult = vi.fn()
    wrap(<VatNumberCheck vatNumber="EE 101 234 567" onResult={onResult} />)
    await check()
    expect(checkVatNumber).toHaveBeenCalledWith('EE', 'EE101234567')
    expect(screen.getByRole('status')).toHaveTextContent('Kehtiv: NÄIDIS OÜ · Narva mnt 5, Tallinn')
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'valid' }))
  })

  it('says a number is invalid', async () => {
    vi.mocked(checkVatNumber).mockResolvedValue({ status: 'invalid', countryCode: 'EE', vatNumber: '100000000' })
    wrap(<VatNumberCheck vatNumber="EE100000000" />)
    await check()
    expect(screen.getByRole('status')).toHaveTextContent('VIES-i andmetel ei ole see käibemaksukohustuslase number kehtiv.')
  })

  it('separates an unavailable service from an invalid number and links to the VIES page', async () => {
    vi.mocked(checkVatNumber).mockResolvedValue({ status: 'unavailable', countryCode: 'EE', vatNumber: '101234567', reason: 'MS_UNAVAILABLE' })
    wrap(<VatNumberCheck vatNumber="EE101234567" />)
    await check()
    expect(screen.getByRole('status')).toHaveTextContent('VIES või liikmesriigi andmebaas ei vasta praegu. Proovi hiljem uuesti.')
    expect(screen.getByRole('link', { name: 'Ava VIES-i leht' })).toHaveAttribute('href', PAGE)
    expect(screen.getByRole('button', { name: 'Kontrolli VIES-is' })).toBeEnabled()
  })

  it('says when there is no internet connection', async () => {
    vi.mocked(checkVatNumber).mockResolvedValue({ status: 'offline', countryCode: 'EE', vatNumber: '101234567' })
    wrap(<VatNumberCheck vatNumber="EE101234567" />)
    await check()
    expect(screen.getByRole('status')).toHaveTextContent('Internetiühendus puudub.')
  })

  it('explains a blocked check and copies the number when opening the official page', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.mocked(checkVatNumber).mockResolvedValue({ status: 'blocked', countryCode: 'EL', vatNumber: '094014201', reason: 'Failed to fetch' })
    wrap(<VatNumberCheck vatNumber="GR094014201" />)
    await check()
    expect(screen.getByRole('status')).toHaveTextContent('VIES ei võimalda seda numbrit siit automaatselt kontrollida. Kontrolli numbrit EL094014201 ametlikul VIES-i lehel.')
    expect(screen.queryByRole('button', { name: 'Kontrolli VIES-is' })).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Kopeeri number ja ava VIES' })
    expect(link).toHaveAttribute('href', 'https://ec.europa.eu/taxation_customs/vies/#/vat-validation?memberStateCode=EL&number=094014201&locale=et')
    expect(link).toHaveAttribute('target', '_blank')
    await act(async () => {
      fireEvent.click(link)
    })
    expect(writeText).toHaveBeenCalledWith('EL094014201')
    expect(screen.getByRole('status')).toHaveTextContent('Number EL094014201 on kopeeritud.')
  })

  it('offers the official page straight away once VIES was blocked in this session', () => {
    vi.mocked(viesBlockedInSession).mockReturnValue(true)
    wrap(<VatNumberCheck vatNumber="EE101234567" />)
    expect(screen.queryByRole('button', { name: 'Kontrolli VIES-is' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Kopeeri number ja ava VIES' })).toHaveAttribute('href', PAGE)
    expect(checkVatNumber).not.toHaveBeenCalled()
  })

  it('keeps a retry next to the official page and shows its answer', async () => {
    vi.mocked(viesBlockedInSession).mockReturnValue(true)
    vi.mocked(checkVatNumber).mockResolvedValue({ status: 'valid', countryCode: 'EE', vatNumber: '101234567', name: 'NÄIDIS OÜ' })
    wrap(<VatNumberCheck vatNumber="EE101234567" />)
    expect(screen.getByRole('link', { name: 'Kopeeri number ja ava VIES' })).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Proovi uuesti' }))
    })
    expect(checkVatNumber).toHaveBeenCalledWith('EE', 'EE101234567')
    expect(screen.getByRole('status')).toHaveTextContent('Kehtiv: NÄIDIS OÜ')
  })

  it('passes a national part that starts with the country letters on unchanged', async () => {
    vi.mocked(checkVatNumber).mockResolvedValue({ status: 'valid', countryCode: 'FR', vatNumber: 'FR123456789' })
    wrap(<VatNumberCheck vatNumber="FRFR123456789" />)
    await check()
    expect(checkVatNumber).toHaveBeenCalledWith('FR', 'FRFR123456789')
  })

  it('ignores an answer about a number that was changed meanwhile', async () => {
    let answer: (r: Awaited<ReturnType<typeof checkVatNumber>>) => void = () => undefined
    vi.mocked(checkVatNumber).mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    const onResult = vi.fn()
    const repo = createMemoryRepo()
    const { rerender } = render(
      <AppProvider repository={repo}>
        <VatNumberCheck vatNumber="EE100000000" onResult={onResult} />
      </AppProvider>,
    )
    await check()
    rerender(
      <AppProvider repository={repo}>
        <VatNumberCheck vatNumber="EE101234567" onResult={onResult} />
      </AppProvider>,
    )
    await act(async () => answer({ status: 'invalid', countryCode: 'EE', vatNumber: '100000000' }))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(onResult).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Kontrolli VIES-is' })).toBeEnabled()
  })

  it('clears the result when the number changes and ignores non-EU numbers', async () => {
    vi.mocked(checkVatNumber).mockResolvedValue({ status: 'invalid', countryCode: 'EE', vatNumber: '100000000' })
    const repo = createMemoryRepo()
    const { rerender } = render(
      <AppProvider repository={repo}>
        <VatNumberCheck vatNumber="EE100000000" />
      </AppProvider>,
    )
    await check()
    expect(screen.getByRole('status')).not.toBeEmptyDOMElement()
    rerender(
      <AppProvider repository={repo}>
        <VatNumberCheck vatNumber="EE101234567" />
      </AppProvider>,
    )
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    rerender(
      <AppProvider repository={repo}>
        <VatNumberCheck vatNumber="NO123456789" />
      </AppProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Kontrolli VIES-is' })).not.toBeInTheDocument()
  })
})
