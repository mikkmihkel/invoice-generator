// Shared, template-agnostic building blocks. Templates decide placement and styling.
import type { Content, ContentStack, ContentTable, ContentText, CustomTableLayout, DynamicContent, TableCell } from 'pdfmake/interfaces'
import { addressLines, COLORS, type DocContext } from './context'
import { formatIban, formatMoney, formatQuantity, formatUnitPrice } from './format'
import { creditNoteText, lateInterestText, referenceHint, type LabelKey } from './labels'
import { vatSchemeAllowsRates } from '../domain/law'
import { vatInEur } from '../domain/calc'

export interface TableStyle {
  layout: CustomTableLayout
  headerFill?: string
  headerColor: string
  /** Colour of the English part of bilingual header labels. */
  headerSecondaryColor: string
  headerFontSize: number
  bodyFontSize: number
  /** Alternate row fill. */
  zebra?: string
  /** Uppercase header labels. */
  headerUppercase?: boolean
}

export interface LabelOptions {
  fontSize: number
  color: string
  secondaryColor?: string
  bold?: boolean
  uppercase?: boolean
  characterSpacing?: number
  alignment?: 'left' | 'right' | 'center'
}

/** A label; bilingual documents get the English part on a second, smaller line. */
export function label(ctx: DocContext, key: LabelKey, o: LabelOptions): ContentText | ContentStack {
  const [primary, secondary] = ctx.t.parts(key)
  const up = (s: string) => (o.uppercase ? s.toUpperCase() : s)
  const base = { color: o.color, bold: o.bold ?? false, characterSpacing: o.characterSpacing, alignment: o.alignment }
  if (!secondary) return { text: up(primary), fontSize: o.fontSize, ...base }
  return {
    stack: [
      { text: up(primary), fontSize: o.fontSize, ...base },
      { text: up(secondary), fontSize: Math.max(5.5, o.fontSize - 1.5), ...base, bold: false, color: o.secondaryColor ?? COLORS.muted },
    ],
  }
}

export interface MetaRow {
  key: LabelKey
  value: string
  /** Visually emphasise (e.g. invoice number, due date). */
  strong?: boolean
}

/** Document metadata rows in legal order. Optional rows are omitted when empty. */
export function metaRows(ctx: DocContext): MetaRow[] {
  const inv = ctx.invoice
  const rows: MetaRow[] = [{ key: 'number', value: inv.number || '—', strong: true }]
  rows.push({ key: 'issueDate', value: ctx.date(inv.issueDate) })
  if (inv.supplyDate) rows.push({ key: 'supplyDate', value: ctx.date(inv.supplyDate) })
  if (inv.periodStart || inv.periodEnd) {
    rows.push({ key: 'period', value: `${ctx.date(inv.periodStart)} – ${ctx.date(inv.periodEnd)}`.trim() })
  }
  rows.push({ key: 'dueDate', value: ctx.date(inv.dueDate), strong: true })
  if (inv.referenceNumber) rows.push({ key: 'referenceNumber', value: inv.referenceNumber })
  if (inv.orderReference) rows.push({ key: 'orderReference', value: inv.orderReference })
  if (inv.type === 'credit-note' && inv.creditedInvoiceNumber) {
    rows.push({ key: 'creditedInvoice', value: inv.creditedInvoiceNumber, strong: true })
  }
  return rows
}

export interface MetaTableOptions {
  labelColor: string
  valueColor: string
  fontSize: number
  layout?: CustomTableLayout | 'noBorders'
  labelFill?: string
  labelWidth?: number | '*' | 'auto'
}

/** Two-column label/value table. */
export function metaTable(ctx: DocContext, o: MetaTableOptions, rows = metaRows(ctx)): ContentTable {
  return {
    table: {
      widths: [o.labelWidth ?? 'auto', '*'],
      body: rows.map((r): TableCell[] => [
        withProps(label(ctx, r.key, { fontSize: o.fontSize - 0.5, color: o.labelColor }), { fillColor: o.labelFill }),
        { text: r.value, fontSize: o.fontSize, bold: !!r.strong, color: o.valueColor, alignment: 'right' },
      ]),
    },
    layout: o.layout ?? 'noBorders',
  }
}

/** Merge cell properties (fill, margin…) into a content node. */
export function withProps(c: ContentText | ContentStack, props: Record<string, unknown>): TableCell {
  return { ...c, ...props } as TableCell
}

export interface PartyOptions {
  nameSize: number
  fontSize: number
  color: string
  mutedColor: string
}

/** Party details: name, address, codes, contacts. Labels are inline ("Registrikood: 12345678"). */
export function partyLines(ctx: DocContext, role: 'seller' | 'buyer', o: PartyOptions): Content[] {
  const inv = ctx.invoice
  const p = role === 'seller' ? inv.seller : inv.buyer
  const kv = (key: LabelKey, value: string | undefined): Content | null =>
    value?.trim() ? { text: [{ text: `${ctx.t(key)}: `, color: o.mutedColor }, { text: value.trim(), color: o.color }], fontSize: o.fontSize } : null
  const out: (Content | null)[] = [
    { text: p.name || '—', bold: true, fontSize: o.nameSize, color: o.color, margin: [0, 0, 0, 2] },
    ...addressLines(p.address, ctx).map((line): Content => ({ text: line, fontSize: o.fontSize, color: o.color })),
    kv('registryCode', p.registryCode),
    kv('personalCode', p.registryCode ? undefined : p.personalCode),
    kv('vatNumber', p.vatNumber),
  ]
  if (role === 'buyer') out.push(kv('contactPerson', inv.buyer.contactPerson))
  out.push(kv('phone', p.phone), kv('email', p.email))
  if (role === 'seller') out.push(kv('website', inv.seller.website))
  return out.filter((c): c is Content => c !== null)
}

/** Seller logo, if any. pdfmake supports PNG/JPEG data URLs. */
export function logo(ctx: DocContext, fit: [number, number], alignment: 'left' | 'right' = 'left'): Content | null {
  const url = ctx.invoice.seller.logoDataUrl
  if (!url || !/^data:image\/(png|jpe?g);base64,/i.test(url)) return null
  return { image: url, fit, alignment }
}

/** Invoice lines table. VAT column only when VAT is shown; discount column only when used. */
export function linesTable(ctx: DocContext, s: TableStyle): ContentTable {
  const { totals, invoice } = ctx
  const netById = new Map(totals.lines.map((l) => [l.lineId, l.net]))
  type Col = { key: LabelKey; width: number | string; align: 'left' | 'right' | 'center' }
  const cols: Col[] = [
    { key: 'lineNo', width: 'auto', align: 'left' },
    { key: 'description', width: '*', align: 'left' },
    { key: 'quantity', width: 'auto', align: 'right' },
    { key: 'unit', width: 'auto', align: 'left' },
    { key: 'unitPrice', width: 'auto', align: 'right' },
  ]
  if (ctx.showDiscount) cols.push({ key: 'discount', width: 'auto', align: 'right' })
  // Per-line rates only mean something for domestic VAT; other schemes are explained by the scheme note.
  if (totals.showVat && vatSchemeAllowsRates(invoice.vatScheme)) cols.push({ key: 'vatRate', width: 'auto', align: 'right' })
  cols.push({ key: 'lineTotal', width: 'auto', align: 'right' })

  const header: TableCell[] = cols.map((c) =>
    withProps(
      label(ctx, c.key, {
        fontSize: s.headerFontSize,
        color: s.headerColor,
        secondaryColor: s.headerSecondaryColor,
        bold: true,
        uppercase: s.headerUppercase,
        alignment: c.align,
      }),
      { fillColor: s.headerFill },
    ),
  )

  const body: TableCell[][] = invoice.lines.map((line, i) => {
    const cells: Record<LabelKey, string> = {} as Record<LabelKey, string>
    cells.lineNo = String(i + 1)
    cells.description = line.description
    cells.quantity = formatQuantity(line.quantity, ctx.lang)
    cells.unit = line.unit
    cells.unitPrice = formatUnitPrice(line.unitPrice, ctx.lang)
    cells.discount = line.discountPercent ? ctx.percent(line.discountPercent) : ''
    cells.vatRate = ctx.percent(line.vatRate)
    cells.lineTotal = ctx.amount(netById.get(line.id) ?? 0)
    const fill = s.zebra && i % 2 === 1 ? s.zebra : undefined
    return cols.map((c) => ({
      text: cells[c.key] ?? '',
      alignment: c.align,
      fontSize: s.bodyFontSize,
      color: c.key === 'lineNo' ? COLORS.muted : COLORS.text,
      fillColor: fill,
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
  const head = (key: LabelKey, alignment: 'left' | 'right'): TableCell =>
    withProps(label(ctx, key, { fontSize: s.headerFontSize, color: s.headerColor, secondaryColor: s.headerSecondaryColor, bold: true, uppercase: s.headerUppercase, alignment }), {
      fillColor: s.headerFill,
    })
  return {
    table: {
      headerRows: 1,
      widths: ['auto', '*', '*'],
      body: [
        [head('vatRate', 'left'), head('taxableAmount', 'right'), head('vatAmount', 'right')],
        ...ctx.totals.vatBreakdown.map((r): TableCell[] => [
          { text: ctx.percent(r.rate), fontSize: s.bodyFontSize },
          { text: ctx.amount(r.taxable), fontSize: s.bodyFontSize, alignment: 'right' },
          { text: ctx.amount(r.vat), fontSize: s.bodyFontSize, alignment: 'right' },
        ]),
      ],
    },
    layout: s.layout,
  }
}

export interface TotalRow {
  text: string
  value: string
  grand?: boolean
}

/** Totals: net, VAT per rate, grand total (only the grand total when VAT is not shown). */
export function totalRows(ctx: DocContext): TotalRow[] {
  const { totals, t } = ctx
  const rows: TotalRow[] = []
  if (totals.showVat) {
    rows.push({ text: t('netTotal'), value: ctx.money(totals.net) })
    // Single rate: "Käibemaks 24%" here is the whole breakdown. Several rates: total here, per-rate table beside.
    const single = totals.vatBreakdown.length === 1 ? totals.vatBreakdown[0] : null
    if (single) rows.push({ text: `${t('vatAmount')} ${ctx.percent(single.rate)}`, value: ctx.money(single.vat) })
    else rows.push({ text: t('vatTotal'), value: ctx.money(totals.vat) })
    const eur = vatInEur(ctx.invoice, totals)
    if (eur !== null) {
      const rate = ctx.invoice.eurExchangeRate!.toLocaleString(ctx.lang === 'en' ? 'en-GB' : 'et-EE', { maximumFractionDigits: 6 })
      rows.push({ text: `${t('vatInEur')} (1 EUR = ${rate} ${ctx.invoice.currency.toUpperCase()})`, value: formatMoney(eur, 'EUR', ctx.lang) })
    }
  }
  const grandKey: LabelKey = ctx.invoice.type === 'credit-note' ? 'amountCredited' : 'amountDue'
  rows.push({ text: t(grandKey), value: ctx.money(totals.gross), grand: true })
  return rows
}

export interface TotalsTableOptions {
  fontSize: number
  grandFontSize: number
  color: string
  mutedColor: string
  grandColor: string
  grandFill?: string
  layout: CustomTableLayout | 'noBorders'
  /** Leave out the grand total row (template renders it separately). */
  omitGrand?: boolean
}

export function totalsTable(ctx: DocContext, o: TotalsTableOptions): ContentTable {
  // Note: pdfmake cannot lay out a table with an empty body — callers using omitGrand must check showVat.
  return {
    table: {
      widths: ['*', 'auto'],
      body: totalRows(ctx)
        .filter((r) => !(o.omitGrand && r.grand))
        .map((r): TableCell[] => [
        { text: r.text, fontSize: r.grand ? o.fontSize + 0.5 : o.fontSize, bold: !!r.grand, color: r.grand ? o.grandColor : o.mutedColor, fillColor: r.grand ? o.grandFill : undefined, margin: r.grand ? [0, 3, 0, 3] : undefined },
        { text: r.value, fontSize: r.grand ? o.grandFontSize : o.fontSize, bold: !!r.grand, color: r.grand ? o.grandColor : o.color, alignment: 'right', noWrap: true, fillColor: r.grand ? o.grandFill : undefined, margin: r.grand ? [0, 2, 0, 2] : undefined },
      ]),
    },
    layout: o.layout,
  }
}

export interface TextBlockOptions {
  fontSize: number
  color: string
  mutedColor: string
  headingColor: string
  headingUppercase?: boolean
}

function heading(ctx: DocContext, key: LabelKey, o: TextBlockOptions): Content {
  return { text: o.headingUppercase ? ctx.t(key).toUpperCase() : ctx.t(key), bold: true, fontSize: o.fontSize, color: o.headingColor, margin: [0, 0, 0, 3], characterSpacing: o.headingUppercase ? 0.6 : undefined }
}

/** Payment instructions: bank accounts, reference number. */
export function paymentBlock(ctx: DocContext, o: TextBlockOptions): Content | null {
  const inv = ctx.invoice
  if (!ctx.bankAccounts.length && !inv.referenceNumber) return null
  const accounts: Content[] = ctx.bankAccounts.map((a) => ({
    text: [
      ...(a.bankName ? [{ text: `${a.bankName}  `, color: o.mutedColor }] : []),
      { text: formatIban(a.iban), bold: true, color: o.color },
      ...(a.bic ? [{ text: `  BIC ${a.bic}`, color: o.mutedColor }] : []),
    ],
    fontSize: o.fontSize,
  }))
  const extra: Content[] = []
  if (inv.referenceNumber && inv.type !== 'credit-note') {
    extra.push({ text: referenceHint(inv.referenceNumber, ctx.lang), fontSize: o.fontSize - 0.5, color: o.mutedColor, margin: [0, 2, 0, 0] })
  }
  return { stack: [heading(ctx, 'bankDetails', o), { text: inv.seller.name, fontSize: o.fontSize, color: o.color }, ...accounts, ...extra], unbreakable: true }
}

/** Mandatory notes (VAT scheme, credit note reference), free-text notes, late interest. */
export function notesBlock(ctx: DocContext, o: TextBlockOptions): Content | null {
  const inv = ctx.invoice
  const items: Content[] = []
  if (ctx.vatNote) items.push({ text: ctx.vatNote, fontSize: o.fontSize, bold: true, color: o.color })
  if (ctx.notRegisteredNote) items.push({ text: ctx.notRegisteredNote, fontSize: o.fontSize, color: o.color })
  if (inv.type === 'credit-note' && inv.creditedInvoiceNumber) {
    items.push({ text: creditNoteText(inv.creditedInvoiceNumber, ctx.lang), fontSize: o.fontSize, color: o.color })
  }
  if (inv.lateInterestPercentPerDay && inv.lateInterestPercentPerDay > 0 && inv.type !== 'credit-note') {
    items.push({ text: lateInterestText(ctx.percent(inv.lateInterestPercentPerDay), ctx.lang), fontSize: o.fontSize, color: o.mutedColor })
  }
  if (inv.notes?.trim()) {
    items.push({ stack: [heading(ctx, 'notes', o), { text: inv.notes.trim(), fontSize: o.fontSize, color: o.color }], margin: [0, 4, 0, 0] })
  }
  if (!items.length) return null
  return { stack: items.map((c, i) => (i === 0 ? c : { stack: [c], margin: [0, 3, 0, 0] })) }
}

export interface FooterOptions {
  marginX: number
  fontSize: number
  color: string
  ruleColor?: string
}

/** Page footer: footer note + seller summary on the left, "Lk 1/2" on the right. */
export function footer(ctx: DocContext, o: FooterOptions): DynamicContent {
  const s = ctx.invoice.seller
  const summary = [
    s.name,
    s.registryCode ? `${ctx.t('registryCode')} ${s.registryCode}` : '',
    s.vatNumber ? `${ctx.t('vatNumber')} ${s.vatNumber}` : '',
    s.email ?? '',
    s.phone ?? '',
    s.website ?? '',
  ]
    .filter(Boolean)
    .join('  ·  ')
  const note = ctx.invoice.footerNote?.trim()
  return (currentPage, pageCount, pageSize) => ({
    margin: [o.marginX, 14, o.marginX, 0],
    stack: [
      ...(o.ruleColor
        ? [{ canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: pageSize.width - 2 * o.marginX, y2: 0, lineWidth: 0.5, lineColor: o.ruleColor }], margin: [0, 0, 0, 4] as [number, number, number, number] }]
        : []),
      {
        columns: [
          { width: '*', stack: [...(note ? [{ text: note, fontSize: o.fontSize, color: o.color }] : []), { text: summary, fontSize: o.fontSize - 0.5, color: o.color }] },
          { width: 'auto', text: `${ctx.t('page')} ${currentPage}/${pageCount}`, fontSize: o.fontSize, color: o.color, alignment: 'right', noWrap: true },
        ],
        columnGap: 12,
      },
    ],
  })
}

/** Horizontal-rules-only table layout. */
export function rulesLayout(o: { header: string; rows: string; outer?: string; width?: number; paddingY?: number; paddingX?: number }): CustomTableLayout {
  const w = o.width ?? 0.5
  return {
    hLineWidth: (i) => (i === 0 ? (o.outer ? w : 0) : i === 1 ? w * 1.5 : w),
    vLineWidth: () => 0,
    hLineColor: (i) => (i === 0 ? (o.outer ?? o.header) : i === 1 ? o.header : o.rows),
    paddingLeft: (i) => (i === 0 ? 0 : (o.paddingX ?? 6)),
    paddingRight: (i, node) => (i === (node.table.widths?.length ?? 1) - 1 ? 0 : (o.paddingX ?? 6)),
    paddingTop: () => o.paddingY ?? 5,
    paddingBottom: () => o.paddingY ?? 5,
  }
}

/** Full grid layout. */
export function gridLayout(color: string, width = 0.5, padding = 4): CustomTableLayout {
  return {
    hLineWidth: () => width,
    vLineWidth: () => width,
    hLineColor: () => color,
    vLineColor: () => color,
    paddingLeft: () => padding,
    paddingRight: () => padding,
    paddingTop: () => padding - 1,
    paddingBottom: () => padding - 1,
  }
}

/** No lines, custom padding. */
export function plainLayout(paddingX = 0, paddingY = 2): CustomTableLayout {
  return {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    paddingLeft: (i) => (i === 0 ? 0 : paddingX),
    paddingRight: (i, node) => (i === (node.table.widths?.length ?? 1) - 1 ? 0 : paddingX),
    paddingTop: () => paddingY,
    paddingBottom: () => paddingY,
  }
}
