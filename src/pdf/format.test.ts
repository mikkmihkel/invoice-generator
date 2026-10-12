import { describe, expect, it } from 'vitest'
import { fileNameSegment, formatAmount, formatDate, formatMoney, formatQuantity, formatUnitPrice, toAscii } from './format'
import { invoiceFileName } from './fileName'
import { sampleInvoice } from './testFixtures'

const NB = ' '

describe('number and date formatting', () => {
  it('formats money per language', () => {
    expect(formatMoney(1234.56, 'EUR', 'et')).toBe(`1${NB}234,56${NB}€`)
    expect(formatMoney(1234.56, 'EUR', 'et-en')).toBe(`1${NB}234,56${NB}€`)
    expect(formatMoney(1234.56, 'EUR', 'en')).toBe('€1,234.56')
    expect(formatMoney(-1234567.891, 'EUR', 'en')).toBe('-€1,234,567.89')
    expect(formatMoney(10, 'SEK', 'en')).toBe(`SEK${NB}10.00`)
    expect(formatMoney(10, 'SEK', 'et')).toBe(`10,00${NB}SEK`)
  })

  it('never prints negative zero', () => {
    expect(formatAmount(-0.001, 'et')).toBe('0,00')
  })

  it('formats quantities and unit prices', () => {
    expect(formatQuantity(12.5, 'et')).toBe('12,5')
    expect(formatQuantity(3, 'et')).toBe('3')
    expect(formatQuantity(1.23456, 'en')).toBe('1.235')
    expect(formatUnitPrice(65, 'et')).toBe('65,00')
    expect(formatUnitPrice(0.12345, 'en')).toBe('0.1235')
  })

  it('formats dates', () => {
    expect(formatDate('2026-03-05', 'et')).toBe('05.03.2026')
    expect(formatDate('2026-03-05', 'et-en')).toBe('05.03.2026')
    expect(formatDate('2026-03-05', 'en')).toBe('5 Mar 2026')
    expect(formatDate(undefined, 'et')).toBe('')
  })
})

describe('file names', () => {
  it('transliterates Estonian letters', () => {
    expect(toAscii('Õunapuu Šokolaad Žürii Äädikas Öö')).toBe('Ounapuu Sokolaad Zurii Aadikas Oo')
    expect(toAscii('Crème brûlée Łódź')).toBe('Creme brulee Lodz')
    expect(fileNameSegment('Klient OÜ / "Test"')).toBe('Klient-OU-Test')
  })

  it('builds ASCII-safe invoice file names', () => {
    const inv = sampleInvoice({ buyer: { ...sampleInvoice().buyer, name: 'Klient OÜ' } })
    expect(invoiceFileName(inv)).toBe('Arve_2026-0007_Klient-OU.pdf')
    expect(invoiceFileName(inv, 'xml')).toBe('Arve_2026-0007_Klient-OU.xml')
    expect(invoiceFileName({ ...inv, type: 'credit-note', number: '2026-0008' })).toBe('Kreeditarve_2026-0008_Klient-OU.pdf')
    expect(invoiceFileName({ ...inv, type: 'prepayment' })).toBe('Ettemaksuarve_2026-0007_Klient-OU.pdf')
    expect(invoiceFileName({ ...inv, number: '', status: 'draft' })).toBe('Arve_mustand_2026-10-12_Klient-OU.pdf')
    expect(invoiceFileName({ ...inv, language: 'en' })).toBe('Invoice_2026-0007_Klient-OU.pdf')
    expect(invoiceFileName({ ...inv, number: 'ARVE/2026/7' })).toBe('Arve_ARVE-2026-7_Klient-OU.pdf')
    expect(invoiceFileName({ ...inv, buyer: { ...inv.buyer, name: '' } })).toBe('Arve_2026-0007.pdf')
    expect(invoiceFileName(sampleInvoice())).toMatch(/^[\x20-\x7e]+$/)
  })
})
