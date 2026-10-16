import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createEmptyInvoice, isValidVatNumber, type Invoice, type VatScheme } from '../domain'
import { createMemoryRepo, sampleProfile } from './testing/memoryRepo'
import { newClient } from './util'

vi.mock('../registry', async () => (await import('./testing/mocks')).registryMock())
vi.mock('../pdf', async () => (await import('./testing/mocks')).pdfMock())
vi.mock('../integrations', async () => (await import('./testing/mocks')).integrationsMock())
vi.mock('../einvoice', async () => (await import('./testing/mocks')).einvoiceMock())
vi.mock('../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage')>()),
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

const profile = sampleProfile()
// Well-formed Estonian VAT number whose check digit is wrong.
const BAD_CHECK_DIGIT = Array.from({ length: 10 }, (_, d) => `EE10123456${d}`).find((v) => !isValidVatNumber(v))!
const CHECKSUM_MSG = 'KMKR numbri kontrollnumber ei klapi – kontrolli numbrit.'

function draft(vatScheme: VatScheme): Invoice {
  const client = newClient({ name: 'Ostja AS', registryCode: '10000001', vatNumber: BAD_CHECK_DIGIT, address: { street: 'Rüütli 1', city: 'Pärnu', postalCode: '80010', country: 'EE' } })
  const inv = createEmptyInvoice(profile, client)
  return { ...inv, vatScheme, lines: [{ ...inv.lines[0], description: 'Arendus', unitPrice: 100 }] }
}

async function open(inv: Invoice) {
  window.location.hash = `#/invoices/${inv.id}`
  render(<App repository={createMemoryRepo({ profile, invoices: [inv] })} />)
  return screen.findByLabelText('KMKR number')
}

describe('buyer VAT number with a wrong check digit', () => {
  it('is a warning in the field when the checklist only warns about it (domestic sale)', async () => {
    const vat = await open(draft('domestic'))
    expect(vat).not.toHaveAttribute('aria-invalid')
    const msg = screen.getByText(CHECKSUM_MSG)
    expect(msg).toHaveClass('tone-warn')
    expect(msg.closest('.field-error')).toBeNull()
    const check = (await screen.findByRole('heading', { name: 'Nõuete kontroll' })).closest('section')!
    expect(within(check).getByText('Ostja KMKR number on tõenäoliselt vigane.').closest('.issue')).toHaveClass('issue-warning')
  })

  it('stays an error where the VAT number is mandatory and blocks issuing', async () => {
    const vat = await open(draft('domestic-reverse-charge'))
    expect(vat).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(CHECKSUM_MSG).closest('.field-error')).not.toBeNull()
  })
})
