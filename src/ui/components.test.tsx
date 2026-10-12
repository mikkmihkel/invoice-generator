import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ValidationIssue } from '../domain'
import { AppProvider } from './AppContext'
import { fieldId } from './components/fields'
import { formatDate, formatMoney, parseDecimal } from './format'
import { translate } from './i18n'
import { en } from './i18n/en'
import { et } from './i18n/et'
import { vatNumberError } from './components/PartyFields'
import { ValidationPanel } from './pages/editor/ValidationPanel'
import { profileProblems } from './pages/ProfileForm'
import { sampleProfile } from './testing/memoryRepo'
import { createMemoryRepo } from './testing/memoryRepo'
import { displayStatus, errorMessage, fillTemplate } from './util'

vi.mock('../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage')>()),
  subscribe: () => () => undefined,
}))

afterEach(cleanup)

const ISSUES: ValidationIssue[] = [
  { field: 'buyer.vatNumber', severity: 'error', message: { et: 'Ostja KMKR number puudub.', en: 'Buyer VAT number is missing.' }, legalBasis: 'KMS § 37 lg 7 p 4' },
  { field: 'dueDate', severity: 'warning', message: { et: 'Maksetähtaeg on minevikus.', en: 'Due date is in the past.' } },
]

describe('ValidationPanel', () => {
  it('lists errors and warnings with legal basis and focuses the field on click', async () => {
    render(
      <AppProvider repository={createMemoryRepo()}>
        <label htmlFor={fieldId('buyer.vatNumber')}>VAT</label>
        <input id={fieldId('buyer.vatNumber')} />
        <ValidationPanel issues={ISSUES} />
      </AppProvider>,
    )
    expect(screen.getByText(/Vigu: 1 · Hoiatusi: 1/)).toBeInTheDocument()
    expect(screen.getByText('KMS § 37 lg 7 p 4')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ostja KMKR number puudub.' }))
    expect(screen.getByLabelText('VAT')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Maksetähtaeg on minevikus.' })).toBeInTheDocument()
  })

  it('links seller issues to the company profile instead of a missing editor field', () => {
    render(
      <AppProvider repository={createMemoryRepo()}>
        <ValidationPanel issues={[{ field: 'seller.vatNumber', severity: 'error', message: { et: 'Müüja KMKR number on vigane.', en: 'Seller VAT number is invalid.' } }]} />
      </AppProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Müüja KMKR number on vigane.' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Paranda ettevõtte andmetes/ })).toHaveAttribute('href', '#/company?focus=vatNumber')
  })

  it('confirms when there are no issues', () => {
    render(
      <AppProvider repository={createMemoryRepo()}>
        <ValidationPanel issues={[]} />
      </AppProvider>,
    )
    expect(screen.getByText('Kõik kohustuslikud andmed on olemas.')).toBeInTheDocument()
  })
})

describe('profile checks', () => {
  const t = (k: string) => k
  it('blocks an invalid registry code, an invalid VAT number and VAT registration without a number', () => {
    expect(profileProblems(sampleProfile(), t)).toEqual([])
    expect(profileProblems(sampleProfile({ registryCode: '12345679' }), t)).toEqual(['profile.registryCodeInvalid'])
    expect(profileProblems(sampleProfile({ vatNumber: 'EE101234567' }), t)).toEqual(['profile.vatNumberInvalid'])
    expect(profileProblems(sampleProfile({ vatNumber: '' }), t)).toEqual(['profile.vatNumberRequired'])
    expect(profileProblems(sampleProfile({ vatNumber: '', vatRegistered: false }), t)).toEqual([])
  })
  it('does not block a missing registry code (only warned about in the form)', () => {
    expect(profileProblems(sampleProfile({ registryCode: '' }), t)).toEqual([])
  })
  it('tells a wrong check digit apart from a wrong format', () => {
    expect(vatNumberError('EE101234567', 'format', 'checksum')).toBe('checksum')
    expect(vatNumberError('101234568', 'format', 'checksum')).toBe('format')
    expect(vatNumberError('EE1012', 'format', 'checksum')).toBe('format')
    expect(vatNumberError('EE101234568', 'format', 'checksum')).toBeUndefined()
  })
})

describe('formatting and helpers', () => {
  it('formats amounts and dates Estonian style', () => {
    expect(formatMoney(1234.5).replace(/\s/g, ' ')).toBe('1 234,50 €')
    expect(formatMoney(7470.93)).toBe('7\u00a0470,93\u00a0€')
    expect(formatMoney(7470.93, 'EUR', 'en')).toBe('€7,470.93')
    expect(formatMoney(-1234.5, 'USD', 'en')).toBe('-$1,234.50')
    expect(formatMoney(12345.5).replace(/\s/g, ' ')).toBe('12 345,50 €')
    expect(formatDate('2026-10-12')).toBe('12.10.2026')
  })

  it('parses decimals with comma or dot', () => {
    expect(parseDecimal('1,5')).toBe(1.5)
    expect(parseDecimal(' 1 234.25 ')).toBe(1234.25)
    expect(parseDecimal('-2')).toBe(-2)
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal('')).toBeNull()
  })

  it('derives overdue status', () => {
    expect(displayStatus({ status: 'issued', dueDate: '2026-01-01' }, '2026-01-02')).toBe('overdue')
    expect(displayStatus({ status: 'issued', dueDate: '2026-01-02' }, '2026-01-02')).toBe('issued')
    expect(displayStatus({ status: 'paid', dueDate: '2020-01-01' }, '2026-01-02')).toBe('paid')
    expect(displayStatus({ status: 'issued', type: 'credit-note', dueDate: '2026-01-01' }, '2026-01-02')).toBe('issued')
  })

  it('fills email placeholders and keeps unknown ones', () => {
    expect(fillTemplate('Arve {number} – {total} {x}', { number: '2026-0001', total: '10,00 €' })).toBe('Arve 2026-0001 – 10,00 € {x}')
  })

  it('shows bilingual errors from other modules', () => {
    const err = Object.assign(new Error('x'), { messages: { et: 'Eesti tekst', en: 'English text' } })
    expect(errorMessage(err)).toBe('Eesti tekst')
  })

  it('has every UI string in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(et).sort())
    for (const v of Object.values(en)) expect(v.trim()).not.toBe('')
    expect(translate('en', 'lines.lineN', { n: 3 })).toBe('Line 3')
  })
})
