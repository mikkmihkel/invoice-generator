// Spreadsheet-friendly CSV for Estonian Excel / LibreOffice and accounting imports:
// `;` separator, decimal comma, CRLF line ends, UTF-8 with BOM.

export const CSV_SEPARATOR = ';'
export const CSV_BOM = '﻿'

/** A number cell; `null`/`undefined` stays empty. */
export type CsvCell = string | number | null | undefined

/** Amount with a decimal comma and no thousands separator, e.g. -1234.5 → "-1234,50". */
export function formatCsvNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return ''
  const fixed = value.toFixed(decimals)
  const normalized = /^-0(\.0*)?$/.test(fixed) ? fixed.slice(1) : fixed
  return normalized.replace('.', ',')
}

// Text starting with these is run as a formula by spreadsheet programs (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/

/** Text cell: neutralises formula triggers and quotes the value when needed. */
export function csvText(value: string): string {
  let s = value
  if (FORMULA_START.test(s)) s = `'${s}`
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function cell(value: CsvCell): string {
  if (value == null) return ''
  if (typeof value === 'number') return formatCsvNumber(value)
  return csvText(value)
}

/** Rows to CSV text with BOM. Strings are text, numbers are amounts with two decimals. */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return CSV_BOM + rows.map((r) => r.map(cell).join(CSV_SEPARATOR)).join('\r\n') + '\r\n'
}
