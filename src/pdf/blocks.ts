// Shared, template-agnostic building blocks. Templates decide placement and styling.
// Machine-readability rules applied here: every value is real text preceded by its label (same wording on every
// template), each number/amount is one text run ("2 083,20 €"), tables have a real header row, identifiers use
// Plex Mono.
import type { Content, ContentStack, ContentTable, ContentText, CustomTableLayout, DynamicContent, TableCell } from 'pdfmake/interfaces'
import { addressLines, COLORS, type DocContext } from './context'
import { FONT } from './fonts'
import { formatIban, formatMoney, formatQuantity } from './format'
import { creditNoteText, lateInterestText, type LabelKey } from './labels'
import { paymentQrPayload } from './machine'
import { vatSchemeAllowsRates } from '../domain/law'
import { vatInEur } from '../domain/calc'

export type Align = 'left' | 'right' | 'center'

const NBSP = '\u00a0'
export type Margins = [number, number, number, number]

// ---------- labels ----------

export interface LabelStyle {
  fontSize: number
  color: string
  /** Colour of the English half of bilingual labels. */
  secondaryColor?: string
  bold?: boolean
  font?: string
  uppercase?: boolean
  characterSpacing?: number
  alignment?: Align
  /** Keep each line on one row (e.g. "KM %" must not break into "KM" / "%"). */
  noWrap?: boolean
}

function caseOf(o: { uppercase?: boolean }, s: string): string {
  return o.uppercase ? s.toUpperCase() : s
}

/** One-line label: "Arve kuupäev", bilingual "Arve kuupäev / Date of issue" (English half in `secondaryColor`). */
export function inlineLabel(ctx: DocContext, key: LabelKey, o: LabelStyle, suffix = ''): ContentText {
  const [primary, secondary] = ctx.t.parts(key)
  const style = { fontSize: o.fontSize, bold: o.bold ?? false, font: o.font, characterSpacing: o.characterSpacing, alignment: o.alignment, ...(o.noWrap ? { noWrap: true } : {}) }
  if (!secondary) return { text: caseOf(o, primary) + suffix, color: o.color, ...style }
  return {
    text: [
      { text: caseOf(o, primary), color: o.color },
      { text: ` / ${caseOf(o, secondary)}${suffix}`, color: o.secondaryColor ?? o.color },
    ],
    ...style,
  }
}

/** Stacked label for table headers: bilingual documents get the English part on a second, smaller line. */
export function label(ctx: DocContext, key: LabelKey, o: LabelStyle): ContentText | ContentStack {
  const [primary, secondary] = ctx.t.parts(key)
  const base = { color: o.color, bold: o.bold ?? false, font: o.font, characterSpacing: o.characterSpacing, alignment: o.alignment, ...(o.noWrap ? { noWrap: true } : {}) }
  if (!secondary) return { text: caseOf(o, primary), fontSize: o.fontSize, ...base }
  return {
    stack: [
      { text: caseOf(o, primary), fontSize: o.fontSize, ...base },
      // No letter-spacing on the smaller line: extractors would read "D AT E" instead of "DATE".
      { text: caseOf(o, secondary), fontSize: Math.max(5.5, o.fontSize - 1), ...base, characterSpacing: undefined, bold: false, color: o.secondaryColor ?? COLORS.muted },
    ],
  }
}

/** Merge cell properties (fill, margin…) into a content node. */
export function withProps(c: Content, props: Record<string, unknown>): TableCell {
  return { ...(c as object), ...props } as TableCell
}

// ---------- definition lists (label → value) ----------

export interface DefRow {
  key: LabelKey
  value: string
  /** Identifier (number, code, IBAN): set in Plex Mono. */
  mono?: boolean
  strong?: boolean
}

/** Document metadata in legal order. Optional rows are omitted when empty. */
export function metaRows(ctx: DocContext, o: { exclude?: LabelKey[]; reference?: boolean } = {}): DefRow[] {
  const inv = ctx.invoice
  const rows: DefRow[] = [{ key: ctx.numberKey, value: inv.number || '—', mono: true, strong: true }]
  rows.push({ key: 'issueDate', value: ctx.date(inv.issueDate) })
  if (inv.supplyDate) rows.push({ key: 'supplyDate', value: ctx.date(inv.supplyDate) })
  if (inv.periodStart || inv.periodEnd) rows.push({ key: 'period', value: `${ctx.date(inv.periodStart)} – ${ctx.date(inv.periodEnd)}`.trim() })
  if (!ctx.isCreditNote && inv.dueDate) rows.push({ key: 'dueDate', value: ctx.date(inv.dueDate), strong: true })
  if (o.reference && inv.referenceNumber) rows.push({ key: 'referenceNumber', value: inv.referenceNumber, mono: true })
  if (inv.orderReference) rows.push({ key: 'orderReference', value: inv.orderReference })
  if (ctx.isCreditNote && inv.creditedInvoiceNumber) rows.push({ key: 'creditedInvoice', value: inv.creditedInvoiceNumber, mono: true, strong: true })
  const exclude = new Set(o.exclude ?? [])
  return rows.filter((r) => !exclude.has(r.key))
}

/** Payment rows: recipient, bank / IBAN / BIC per printed account, reference number. */
export function paymentRows(ctx: DocContext, o: { reference?: boolean } = {}): DefRow[] {
  const inv = ctx.invoice
  const rows: DefRow[] = []
  if (ctx.bankAccounts.length) rows.push({ key: 'recipient', value: inv.seller.name })
  for (const a of ctx.bankAccounts) {
    if (a.bankName?.trim()) rows.push({ key: 'bank', value: a.bankName.trim() })
    rows.push({ key: 'iban', value: formatIban(a.iban), mono: true, strong: true })
    if (a.bic?.trim()) rows.push({ key: 'bic', value: a.bic.trim(), mono: true })
  }
  if ((o.reference ?? true) && inv.referenceNumber) rows.push({ key: 'referenceNumber', value: inv.referenceNumber, mono: true, strong: true })
  return rows
}

export interface ValueStyle {
  fontSize: number
  color: string
  /** Font for strong values (default: Plex Sans bold = SemiBold). */
  strongFont?: string
  /** Mono size relative to the text size (Plex Mono runs wider). */
  monoScale?: number
}

/** A value as one text run; identifiers in Plex Mono. */
export function valueText(value: string, row: Pick<DefRow, 'mono' | 'strong'>, s: ValueStyle): ContentText {
  // Identifiers never break across lines (an IBAN split in two is unreadable for people and parsers).
  if (row.mono) return { text: value, font: FONT.mono, fontSize: round(s.fontSize * (s.monoScale ?? 0.94)), color: s.color, noWrap: true }
  return { text: value, fontSize: s.fontSize, color: s.color, bold: !!row.strong && !s.strongFont, font: row.strong ? s.strongFont : undefined }
}

export interface DefListStyle {
  fontSize: number
  labelColor: string
  labelSecondaryColor?: string
  labelSize?: number
  labelBold?: boolean
  labelUppercase?: boolean
  /** Keep labels on one line ("Käibe tekkimise kuupäev"). Default true. */
  labelNoWrap?: boolean
  valueColor: string
  strongFont?: string
  labelWidth?: number | 'auto' | '*'
  valueWidth?: number | 'auto' | '*'
  valueAlign?: Align
  /** Space between label and value columns. */
  gap?: number
  paddingY?: number
  layout?: CustomTableLayout
}

/** Two-column label → value table (label first in reading order). */
export function defList(ctx: DocContext, rows: DefRow[], s: DefListStyle): ContentTable {
  const labelStyle: LabelStyle = { fontSize: s.labelSize ?? s.fontSize - 0.5, color: s.labelColor, secondaryColor: s.labelSecondaryColor, bold: s.labelBold, uppercase: s.labelUppercase, noWrap: s.labelNoWrap ?? true }
  return {
    table: {
      widths: [s.labelWidth ?? 'auto', s.valueWidth ?? '*'],
      body: rows.map((r): TableCell[] => [
        withProps(inlineLabel(ctx, r.key, labelStyle), { margin: [0, r.mono ? 0.4 : 0, 0, 0] }),
        { ...valueText(r.value, r, { fontSize: s.fontSize, color: s.valueColor, strongFont: s.strongFont }), alignment: s.valueAlign ?? 'left' },
      ]),
    },
    layout: s.layout ?? plainLayout(s.gap ?? 12, s.paddingY ?? 1.5),
  }
}

/** Label and value on one line: "Arve nr 2026-0007". */
export function inlineDef(ctx: DocContext, row: DefRow, labelStyle: LabelStyle, value: ValueStyle): ContentText {
  const lbl = inlineLabel(ctx, row.key, labelStyle)
  const runs = Array.isArray(lbl.text) ? (lbl.text as ContentText[]) : [{ text: lbl.text as string, color: labelStyle.color }]
  return { text: [...runs, { text: NBSP }, valueText(row.value, row, value)], fontSize: labelStyle.fontSize }
}

/** Label stacked above its value (for horizontal fact rows). */
export function fact(ctx: DocContext, row: DefRow, s: { label: LabelStyle; value: ValueStyle; gap?: number }): ContentStack {
  // Bilingual: Estonian and English label on two lines so values in a row of facts stay aligned.
  const lbl = ctx.lang === 'et-en' ? label(ctx, row.key, { ...s.label, noWrap: true }) : inlineLabel(ctx, row.key, s.label)
  return { stack: [lbl, { ...valueText(row.value, row, s.value), margin: [0, s.gap ?? 2, 0, 0] }] }
}

// ---------- parties ----------

export interface PartyStyle {
  /** Section heading ("Müüja" / "Ostja"); null = no heading. */
  heading: LabelStyle | null
  headingGap?: number
  nameSize: number
  nameFont?: string
  fontSize: number
  color: string
  labelColor: string
  /** Extra space between lines. */
  lineGap?: number
}

/** Party details: name, address, codes, contacts. Labels are inline ("Registrikood 16234571"). */
export function partyBlock(ctx: DocContext, role: 'seller' | 'buyer', s: PartyStyle): ContentStack {
  const inv = ctx.invoice
  const p = role === 'seller' ? inv.seller : inv.buyer
  const gap = s.lineGap ?? 0
  const line = (c: ContentText): Content => ({ ...c, margin: [0, gap, 0, 0] })
  const kv = (key: LabelKey, value: string | undefined, mono = false): Content | null => {
    const v = value?.trim()
    if (!v) return null
    const lbl = inlineLabel(ctx, key, { fontSize: s.fontSize, color: s.labelColor })
    const runs = Array.isArray(lbl.text) ? lbl.text : [{ text: lbl.text as string, color: s.labelColor }]
    // NBSP between label and value: a line never ends with a label whose value went to the next line.
    return line({ text: [...(runs as ContentText[]), { text: NBSP }, mono ? { text: v, font: FONT.mono, fontSize: round(s.fontSize * 0.94), color: s.color } : { text: v, color: s.color }], fontSize: s.fontSize })
  }
  const out: (Content | null)[] = []
  if (s.heading) out.push({ ...inlineLabel(ctx, role, s.heading), margin: [0, 0, 0, s.headingGap ?? 5] })
  out.push({ text: p.name || '—', font: s.nameFont, bold: !s.nameFont, fontSize: s.nameSize, color: s.color, margin: [0, 0, 0, 1.5] })
  for (const l of addressLines(p.address, ctx)) out.push(line({ text: l, fontSize: s.fontSize, color: s.color }))
  out.push(kv('registryCode', p.registryCode, true), kv('personalCode', p.registryCode ? undefined : p.personalCode, true), kv('vatNumber', p.vatNumber, true))
  if (role === 'buyer') out.push(kv('contactPerson', inv.buyer.contactPerson))
  out.push(kv('email', p.email), kv('phone', p.phone))
  if (role === 'seller') out.push(kv('website', inv.seller.website))
  return { stack: out.filter((c): c is Content => c !== null) }
}

/** Seller logo, if any. pdfmake supports PNG/JPEG data URLs. */
export function logo(ctx: DocContext, fit: [number, number], alignment: Align = 'left'): Content | null {
  const url = ctx.invoice.seller.logoDataUrl
  if (!url || !/^data:image\/(png|jpe?g);base64,/i.test(url)) return null
  return { image: url, fit, alignment }
}

// ---------- line items ----------

export interface TableStyle {
  layout: CustomTableLayout
  headerFill?: string
  headerColor: string
  /** Colour of the English part of bilingual header labels. */
  headerSecondaryColor: string
  headerFontSize: number
  headerBold?: boolean
  headerFont?: string
  headerUppercase?: boolean
  headerCharacterSpacing?: number
  bodyFontSize: number
  bodyColor?: string
  /** Alternate row fill. */
  zebra?: string
  /** Line height inside cells (default 1 — Plex already has tall line metrics). */
  lineHeight?: number
  /** Leading "Nr" column. */
  lineNumbers?: boolean
}

/** Short numeric-column headers that would otherwise break mid-label when the description column takes the space. */
const NO_WRAP_HEADERS = new Set<LabelKey>(['lineNo', 'quantity', 'unit', 'vatRate', 'lineTotal', 'unitPrice'])

function headerCell(ctx: DocContext, key: LabelKey, align: Align, s: TableStyle): TableCell {
  const noWrap = NO_WRAP_HEADERS.has(key)
  return withProps(
    label(ctx, key, {
      fontSize: s.headerFontSize,
      color: s.headerColor,
      secondaryColor: s.headerSecondaryColor,
      bold: s.headerBold ?? true,
      font: s.headerFont,
      uppercase: s.headerUppercase,
      characterSpacing: s.headerCharacterSpacing,
      alignment: align,
      noWrap,
    }),
    { fillColor: s.headerFill, lineHeight: s.lineHeight ?? 1 },
  )
}

/** Invoice lines table. VAT column only when VAT is shown; discount column only when used. */
export function linesTable(ctx: DocContext, s: TableStyle): ContentTable {
  const { totals, invoice } = ctx
  const netById = new Map(totals.lines.map((l) => [l.lineId, l.net]))
  type Col = { key: LabelKey; width: number | string; align: Align }
  const cols: Col[] = []
  if (s.lineNumbers) cols.push({ key: 'lineNo', width: 'auto', align: 'left' })
  cols.push(
    { key: 'description', width: '*', align: 'left' },
    { key: 'quantity', width: 'auto', align: 'right' },
    { key: 'unit', width: 'auto', align: 'left' },
    { key: 'unitPrice', width: 'auto', align: 'right' },
  )
  if (ctx.showDiscount) cols.push({ key: 'discount', width: 'auto', align: 'right' })
  // Per-line rates only mean something for domestic VAT; other schemes are explained by the scheme note.
  if (totals.showVat && vatSchemeAllowsRates(invoice.vatScheme)) cols.push({ key: 'vatRate', width: 'auto', align: 'right' })
  cols.push({ key: 'lineTotal', width: 'auto', align: 'right' })

  const header = cols.map((c) => headerCell(ctx, c.key, c.align, s))
  const body: TableCell[][] = invoice.lines.map((line, i) => {
    const cells: Partial<Record<LabelKey, string>> = {
      lineNo: String(i + 1),
      description: line.description,
      quantity: formatQuantity(line.quantity, ctx.lang),
      unit: line.unit,
      unitPrice: ctx.unitMoney(line.unitPrice),
      discount: line.discountPercent ? ctx.percent(line.discountPercent) : '',
      vatRate: ctx.percent(line.vatRate),
      lineTotal: ctx.money(netById.get(line.id) ?? 0),
    }
    const fill = s.zebra && i % 2 === 1 ? s.zebra : undefined
    return cols.map((c) => ({
      text: cells[c.key] ?? '',
      alignment: c.align,
      fontSize: s.bodyFontSize,
      color: c.key === 'lineNo' ? COLORS.faint : (s.bodyColor ?? COLORS.text),
      fillColor: fill,
      lineHeight: s.lineHeight ?? 1,
      noWrap: c.key !== 'description' && c.key !== 'unit',
    }))
  })

  return {
    table: { headerRows: 1, dontBreakRows: true, widths: cols.map((c) => c.width) as never, body: [header, ...body] },
    layout: s.layout,
  }
}

/**
 * VAT breakdown per rate (taxable amount + VAT). Only needed with several rates — with a single rate the totals
 * block ("Summa käibemaksuta" + "Käibemaks 24%") already is the breakdown. Null when VAT is not shown.
 */
export function vatBreakdownTable(ctx: DocContext, s: TableStyle): ContentTable | null {
  if (!ctx.totals.showVat || ctx.totals.vatBreakdown.length < 2) return null
  const cell = (text: string, alignment: Align): TableCell => ({ text, fontSize: s.bodyFontSize, color: s.bodyColor ?? COLORS.text, alignment, noWrap: true, lineHeight: s.lineHeight ?? 1 })
  return {
    table: {
      headerRows: 1,
      widths: ['auto', '*', '*'],
      body: [
        [headerCell(ctx, 'vatRate', 'left', s), headerCell(ctx, 'taxableAmount', 'right', s), headerCell(ctx, 'vatAmount', 'right', s)],
        ...ctx.totals.vatBreakdown.map((r): TableCell[] => [cell(ctx.percent(r.rate), 'left'), cell(ctx.money(r.taxable), 'right'), cell(ctx.money(r.vat), 'right')]),
      ],
    },
    layout: s.layout,
  }
}

// ---------- totals ----------

export interface TotalRow {
  key: LabelKey
  /** Appended to the label, e.g. " 24%". */
  suffix?: string
  value: string
  grand?: boolean
}

/** Totals: net, VAT (per rate when single), VAT in EUR, grand total (only the grand total when VAT is not shown). */
export function totalRows(ctx: DocContext): TotalRow[] {
  const { totals } = ctx
  const rows: TotalRow[] = []
  if (totals.showVat) {
    rows.push({ key: 'netTotal', value: ctx.money(totals.net) })
    // Single rate: "Käibemaks 24%" here is the whole breakdown. Several rates: total here, per-rate table beside.
    const single = totals.vatBreakdown.length === 1 ? totals.vatBreakdown[0] : null
    if (single) rows.push({ key: 'vatAmount', suffix: ` ${ctx.percent(single.rate)}`, value: ctx.money(single.vat) })
    else rows.push({ key: 'vatTotal', value: ctx.money(totals.vat) })
    const eur = vatInEur(ctx.invoice, totals)
    if (eur !== null) {
      const rate = ctx.invoice.eurExchangeRate!.toLocaleString(ctx.lang === 'en' ? 'en-GB' : 'et-EE', { maximumFractionDigits: 6 })
      rows.push({ key: 'vatInEur', suffix: ` (1 EUR = ${rate} ${ctx.invoice.currency.toUpperCase()})`, value: formatMoney(eur, 'EUR', ctx.lang) })
    }
  }
  rows.push({ key: ctx.isCreditNote ? 'amountCredited' : 'amountDue', value: ctx.money(totals.gross), grand: true })
  return rows
}

export function grandTotal(ctx: DocContext): TotalRow {
  return totalRows(ctx).find((r) => r.grand)!
}

export interface TotalsStyle {
  fontSize: number
  labelColor: string
  labelSecondaryColor?: string
  valueColor: string
  grandLabelSize?: number
  grandFontSize: number
  grandColor: string
  grandLabelColor?: string
  grandFont?: string
  grandFill?: string
  /** Rule above the grand total row. */
  grandRule?: [number, string]
  /** Hairlines between the other rows. */
  rowRule?: [number, string]
  paddingY?: number
  grandPaddingY?: number
  /** Horizontal cell padding (needed with fills). */
  paddingX?: number
  /** Leave out the grand total row (template renders it separately). */
  omitGrand?: boolean
  /** Boxed grid (all lines) instead of rules. */
  grid?: [number, string]
}

export function totalsTable(ctx: DocContext, s: TotalsStyle): ContentTable | null {
  const rows = totalRows(ctx).filter((r) => !(s.omitGrand && r.grand))
  // pdfmake cannot lay out a table with an empty body.
  if (!rows.length) return null
  const grandIndex = rows.findIndex((r) => r.grand)
  const py = s.paddingY ?? 3
  const gpy = s.grandPaddingY ?? py + 2
  const px = s.paddingX ?? 0
  return {
    table: {
      widths: ['*', 'auto'],
      body: rows.map((r): TableCell[] => {
        const fill = r.grand ? s.grandFill : undefined
        const lbl = inlineLabel(ctx, r.key, {
          fontSize: r.grand ? (s.grandLabelSize ?? s.fontSize) : s.fontSize,
          color: r.grand ? (s.grandLabelColor ?? s.grandColor) : s.labelColor,
          secondaryColor: r.grand ? (s.grandLabelColor ?? s.grandColor) : (s.labelSecondaryColor ?? s.labelColor),
          bold: !!r.grand && !s.grandFont,
          font: r.grand ? s.grandFont : undefined,
        }, r.suffix ?? '')
        return [
          withProps(lbl, { fillColor: fill }),
          {
            text: r.value,
            fontSize: r.grand ? s.grandFontSize : s.fontSize,
            bold: !!r.grand && !s.grandFont,
            font: r.grand ? s.grandFont : undefined,
            color: r.grand ? s.grandColor : s.valueColor,
            alignment: 'right',
            noWrap: true,
            fillColor: fill,
          },
        ]
      }),
    },
    layout: {
      hLineWidth: (i) => (s.grid ? s.grid[0] : i === grandIndex && i > 0 && s.grandRule ? s.grandRule[0] : i > 0 && i < rows.length && s.rowRule ? s.rowRule[0] : 0),
      hLineColor: (i) => (s.grid ? s.grid[1] : i === grandIndex && s.grandRule ? s.grandRule[1] : (s.rowRule?.[1] ?? COLORS.hairline)),
      vLineWidth: () => s.grid?.[0] ?? 0,
      vLineColor: () => s.grid?.[1] ?? COLORS.rule,
      paddingLeft: (i) => (i === 0 ? px : 12),
      paddingRight: (i, node) => (i === (node.table.widths?.length ?? 1) - 1 ? px : 0),
      paddingTop: (i) => (i === grandIndex ? gpy : py),
      paddingBottom: (i) => (i === grandIndex ? gpy : py),
    },
  }
}

// ---------- payment, notes ----------

/** EPC "scan to pay" QR code with caption, or null when the invoice has no (sensible) payment QR. */
export function paymentQr(ctx: DocContext, size: number, caption: LabelStyle, color: string = COLORS.ink): Content | null {
  const payload = paymentQrPayload(ctx.invoice)
  if (!payload) return null
  return {
    stack: [
      { qr: payload, fit: size, eccLevel: 'M', foreground: color, alignment: caption.alignment ?? 'left' } as Content,
      { ...inlineLabel(ctx, 'scanToPay', caption), margin: [0, 4, 0, 0] },
    ],
    unbreakable: true,
  } as Content
}

export interface NotesStyle {
  fontSize: number
  color: string
  mutedColor: string
  /** The mandatory VAT note is set in this font weight (default bold = SemiBold). */
  strongFont?: string
  heading: LabelStyle
  gap?: number
}

/** Mandatory notes (VAT scheme, credit note reference), late interest and free-text notes. */
export function notesBlock(ctx: DocContext, s: NotesStyle): ContentStack | null {
  const inv = ctx.invoice
  const items: Content[] = []
  const strong = (text: string): Content => ({ text, fontSize: s.fontSize, color: s.color, bold: !s.strongFont, font: s.strongFont })
  if (ctx.vatNote) items.push(strong(ctx.vatNote))
  if (ctx.notRegisteredNote) items.push(strong(ctx.notRegisteredNote))
  if (ctx.isCreditNote && inv.creditedInvoiceNumber) items.push({ text: creditNoteText(inv.creditedInvoiceNumber, ctx.lang), fontSize: s.fontSize, color: s.color })
  if (inv.lateInterestPercentPerDay && inv.lateInterestPercentPerDay > 0 && !ctx.isCreditNote) {
    items.push({ text: lateInterestText(inv.lateInterestPercentPerDay, ctx.lang), fontSize: s.fontSize, color: s.mutedColor })
  }
  if (inv.notes?.trim()) {
    items.push({ stack: [{ ...inlineLabel(ctx, 'notes', s.heading), margin: [0, 0, 0, 2] }, { text: inv.notes.trim(), fontSize: s.fontSize, color: s.color }], margin: [0, 3, 0, 0] })
  }
  if (!items.length) return null
  const gap = s.gap ?? 3
  // Small enough to keep together: never leave a lone heading or half a VAT note at the bottom of a page.
  return { stack: items.map((c, i) => (i === 0 ? c : { stack: [c], margin: [0, gap, 0, 0] })), unbreakable: true }
}

// ---------- page furniture ----------

export interface FooterStyle {
  marginX: number
  fontSize: number
  color: string
  /** Hairline above the footer. */
  ruleColor?: string
  /** Also print a one-line seller summary (name, address, codes, contacts) — letterhead style. */
  sellerSummary?: boolean
  top?: number
}

/** Two letterhead lines: "Lumi Arendus OÜ · Tartu mnt 18-4, 10115 Tallinn · Registrikood 16234571 · KMKR nr …" and contacts. */
export function sellerSummary(ctx: DocContext): string[] {
  const s = ctx.invoice.seller
  // Lines may break between parts, never inside one ("KMKR nr EE102345678").
  const join = (parts: (string | undefined)[]) => parts.filter(Boolean).map((p) => p!.replace(/ /g, NBSP)).join('  ·  ')
  return [
    join([
      s.name,
      addressLines(s.address, ctx).join(', '),
      s.registryCode ? `${ctx.t('registryCode')} ${s.registryCode}` : '',
      s.vatNumber ? `${ctx.t('vatNumber')} ${s.vatNumber}` : '',
    ]),
    join([s.email, s.phone, s.website]),
  ].filter(Boolean)
}

/** Page footer: footer note (+ seller summary) left; "Arve nr 2026-0007 · Lk 1/2" right. */
export function footer(ctx: DocContext, o: FooterStyle): DynamicContent {
  const note = ctx.invoice.footerNote?.trim()
  const summary = o.sellerSummary ? sellerSummary(ctx) : []
  const number = ctx.invoice.number?.trim()
  return (currentPage, pageCount, pageSize) => ({
    margin: [o.marginX, o.top ?? 16, o.marginX, 0],
    stack: [
      ...(o.ruleColor
        ? [{ canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: pageSize.width - 2 * o.marginX, y2: 0, lineWidth: 0.5, lineColor: o.ruleColor }], margin: [0, 0, 0, 5] as Margins }]
        : []),
      {
        columns: [
          {
            width: '*',
            stack: [
              ...(note ? [{ text: note, fontSize: o.fontSize, color: o.color }] : []),
              ...summary.map((text, i) => ({ text, fontSize: o.fontSize - 0.5, color: o.color, margin: [0, i === 0 && note ? 1.5 : 0, 0, 0] as Margins })),
            ],
          },
          {
            width: 'auto',
            text: [...(number ? [`${ctx.t(ctx.numberKey)} ${number}  ·  `] : []), `${ctx.t('page')} ${currentPage}/${pageCount}`],
            fontSize: o.fontSize,
            color: o.color,
            alignment: 'right',
            noWrap: true,
          },
        ],
        columnGap: 16,
      },
    ],
  })
}

/** Running header on continuation pages: "Lumi Arendus OÜ" left, "Arve nr 2026-0007" right. Nothing on page 1. */
export function continuationHeader(ctx: DocContext, o: { marginX: number; top: number; fontSize: number; color: string }): DynamicContent {
  return (currentPage) => {
    if (currentPage === 1) return null
    const number = ctx.invoice.number?.trim()
    return {
      margin: [o.marginX, o.top, o.marginX, 0],
      columns: [
        { width: '*', text: ctx.invoice.seller.name, fontSize: o.fontSize, color: o.color },
        { width: 'auto', text: number ? `${ctx.t(ctx.numberKey)} ${number}` : ctx.title, fontSize: o.fontSize, color: o.color, alignment: 'right' },
      ],
    }
  }
}

/** Full-width horizontal rule. */
export function rule(width: number, color: string, lineWidth = 0.5, margin: Margins = [0, 0, 0, 0]): Content {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth, lineColor: color }], margin }
}

// ---------- table layouts ----------

export interface LayoutSpec {
  /** [width, colour] of the line above the first row. */
  top?: [number, string]
  /** Line below the header row. */
  header?: [number, string]
  /** Lines between body rows. */
  rows?: [number, string]
  /** Line below the last row. */
  bottom?: [number, string]
  /** All vertical lines (grid). */
  vertical?: [number, string]
  paddingX?: number
  paddingY?: number
  headerPaddingY?: number
  /** Padding at the table's left/right edges (default 0, so text aligns with the content edge). */
  edge?: number
}

export function tableLayout(o: LayoutSpec): CustomTableLayout {
  const pick = (i: number, node: { table: { body: unknown[]; headerRows?: number } }): [number, string] | undefined => {
    const n = node.table.body.length
    const h = node.table.headerRows ?? 0
    if (i === 0) return o.top
    if (i === n) return o.bottom
    if (h && i === h) return o.header
    return o.rows
  }
  const px = o.paddingX ?? 6
  const py = o.paddingY ?? 4
  return {
    hLineWidth: (i, node) => pick(i, node)?.[0] ?? 0,
    hLineColor: (i, node) => pick(i, node)?.[1] ?? COLORS.rule,
    vLineWidth: () => o.vertical?.[0] ?? 0,
    vLineColor: () => o.vertical?.[1] ?? COLORS.rule,
    paddingLeft: (i) => (i === 0 ? (o.edge ?? 0) : px),
    paddingRight: (i, node) => (i === (node.table.widths?.length ?? 1) - 1 ? (o.edge ?? 0) : px),
    paddingTop: (i, node) => (i < (node.table.headerRows ?? 0) ? (o.headerPaddingY ?? py) : py),
    paddingBottom: (i, node) => (i < (node.table.headerRows ?? 0) ? (o.headerPaddingY ?? py) : py),
  }
}

/** No lines, custom padding. */
export function plainLayout(paddingX = 0, paddingY = 2): CustomTableLayout {
  return tableLayout({ paddingX: paddingX / 2, paddingY })
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
