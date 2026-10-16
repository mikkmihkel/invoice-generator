import { describe, expect, it } from 'vitest'
import { makeClient, makeInvoice, makeProfile } from '../../../storage/testFixtures'
import { clientEmailCc, copyLines, creditNoteFor, duplicateInvoice, linesAreBlank, monthLabel, savedClientOf } from './builders'

describe('copies of a reopened document', () => {
  const reopened = makeInvoice('src', { number: 'A-001', status: 'draft', reopenedAt: '2026-03-11T10:00:00.000Z', reopenedIssueDate: '2026-03-10' })

  it('do not carry its reopening over', () => {
    for (const copy of [duplicateInvoice(reopened, makeProfile()), creditNoteFor({ ...reopened, status: 'issued' }, makeProfile())]) {
      expect(copy.number).toBe('')
      expect(copy).not.toHaveProperty('reopenedAt')
      expect(copy).not.toHaveProperty('reopenedIssueDate')
    }
  })
})

describe('copying lines from an earlier invoice', () => {
  const profile = makeProfile()
  const src = makeInvoice('src', {
    number: '2026-0012',
    status: 'issued',
    lines: [
      { id: 'a', description: 'Raamatupidamine', quantity: 1, unit: 'kuu', unitPrice: 300, vatRate: 24 },
      { id: 'b', description: 'Lisatöö', quantity: 2, unit: 'h', unitPrice: 40, vatRate: 13, discountPercent: 10 },
      { id: 'c', description: ' ', quantity: 1, unit: 'tk', unitPrice: 0, vatRate: 24 },
    ],
  })

  it('copies descriptions, quantities, prices and discounts with new ids, leaving out empty lines', () => {
    const lines = copyLines(src, { vatScheme: 'domestic' }, profile)
    expect(lines.map((l) => [l.description, l.quantity, l.unit, l.unitPrice, l.vatRate, l.discountPercent])).toEqual([
      ['Raamatupidamine', 1, 'kuu', 300, 24, undefined],
      ['Lisatöö', 2, 'h', 40, 13, 10],
    ])
    expect(lines.map((l) => l.id)).not.toContain('a')
    expect(new Set(lines.map((l) => l.id)).size).toBe(2)
  })

  it('follows the VAT scheme of the new draft', () => {
    expect(copyLines(src, { vatScheme: 'eu-reverse-charge' }, profile).map((l) => l.vatRate)).toEqual([0, 0])
    const fromExport = { ...src, vatScheme: 'export' as const, lines: src.lines.map((l) => ({ ...l, vatRate: 0 })) }
    expect(copyLines(fromExport, { vatScheme: 'domestic' }, profile).map((l) => l.vatRate)).toEqual([24, 24])
  })

  it('treats a draft as blank until a description, price or discount is entered', () => {
    const empty = { id: 'x', description: '', quantity: 1, unit: 'tk', unitPrice: 0, vatRate: 24 }
    expect(linesAreBlank([empty])).toBe(true)
    expect(linesAreBlank([])).toBe(true)
    expect(linesAreBlank([{ ...empty, description: 'Töö' }])).toBe(false)
    expect(linesAreBlank([empty, { ...empty, unitPrice: 5 }])).toBe(false)
  })

  it('names the month in the UI language, with the year only when it differs', () => {
    expect(monthLabel('2026-09-30', 'et', '2026-10-16')).toBe('september')
    expect(monthLabel('2025-12-01', 'et', '2026-01-05')).toBe('detsember 2025')
    expect(monthLabel('2026-09-30', 'en', '2026-10-16')).toBe('September')
    expect(monthLabel('', 'en', '2026-10-16')).toBe('')
  })
})

describe('savedClientOf', () => {
  const clients = [makeClient('c1'), makeClient('c2', { registryCode: '12345678' })]
  it('finds the client by id, else by registry code', () => {
    expect(savedClientOf(makeInvoice('i'), clients)?.id).toBe('c1')
    const byCode = makeInvoice('i', { buyer: { kind: 'company', name: 'X', registryCode: '12345678', address: { street: '', city: '', postalCode: '', country: 'EE' } } })
    expect(savedClientOf(byCode, clients)?.id).toBe('c2')
    const manual = makeInvoice('i', { buyer: { kind: 'person', name: 'Mari Maasikas', address: { street: '', city: '', postalCode: '', country: 'EE' } } })
    expect(savedClientOf(manual, clients)).toBeUndefined()
  })

  it('gives the client card CC addresses for e-mailing', () => {
    const withCc = [makeClient('c1', { emailCc: ' raamatupidaja@ostja.ee ' })]
    expect(clientEmailCc(makeInvoice('i'), withCc)).toBe('raamatupidaja@ostja.ee')
    expect(clientEmailCc(makeInvoice('i'), clients)).toBe('')
  })
})
