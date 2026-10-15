import { parse } from 'csv-parse/sync'
import { describe, expect, it } from 'vitest'
import { CSV_BOM, csvText, formatCsvNumber, toCsv } from './csv'

describe('formatCsvNumber', () => {
  it('uses a decimal comma, two decimals and no grouping', () => {
    expect(formatCsvNumber(1234.5)).toBe('1234,50')
    expect(formatCsvNumber(-80)).toBe('-80,00')
    expect(formatCsvNumber(0.005)).toBe('0,01')
    expect(formatCsvNumber(1234567.891)).toBe('1234567,89')
  })

  it('never prints negative zero and leaves non-numbers empty', () => {
    expect(formatCsvNumber(-0)).toBe('0,00')
    expect(formatCsvNumber(-0.001)).toBe('0,00')
    expect(formatCsvNumber(Number.NaN)).toBe('')
  })
})

describe('csvText', () => {
  it('quotes separators, quotes and line breaks', () => {
    expect(csvText('Päike; Pilv')).toBe('"Päike; Pilv"')
    expect(csvText('Raamat "Šifrid"')).toBe('"Raamat ""Šifrid"""')
    expect(csvText('rida 1\nrida 2')).toBe('"rida 1\nrida 2"')
    expect(csvText('Tavaline OÜ')).toBe('Tavaline OÜ')
  })

  it('neutralises spreadsheet formulas in text', () => {
    expect(csvText('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvText('+372 555')).toBe("'+372 555")
    expect(csvText('-5')).toBe("'-5")
    expect(csvText('@SUM(A1)')).toBe("'@SUM(A1)")
  })
})

describe('toCsv', () => {
  it('writes a BOM, semicolons and CRLF, and reads back with a CSV parser', () => {
    const text = toCsv([
      ['Number', 'Ostja', 'Summa'],
      ['2026-0001', 'Õun; Pirn OÜ', 1234.5],
      ['2026-0002', null, -10],
    ])
    expect(text.startsWith(CSV_BOM)).toBe(true)
    expect(text).toContain('\r\n')
    expect(text.split('\r\n')[1]).toBe('2026-0001;"Õun; Pirn OÜ";1234,50')
    const rows = parse(text, { bom: true, delimiter: ';' }) as string[][]
    expect(rows).toEqual([
      ['Number', 'Ostja', 'Summa'],
      ['2026-0001', 'Õun; Pirn OÜ', '1234,50'],
      ['2026-0002', '', '-10,00'],
    ])
  })
})
