// The six visual templates. Each composes the shared blocks (blocks.ts) with its own layout and styling.
// Every template keeps the same reading order: title → number/dates → seller → buyer → lines → totals →
// payment → notes, and prints every legally required element (docs/legal-requirements.md).
import type { Content, ContextPageSize, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { TemplateId } from '../domain/types'
import {
  continuationHeader,
  defList,
  fact,
  footer,
  grandTotal,
  inlineLabel,
  linesTable,
  logo,
  metaRows,
  notesBlock,
  partyBlock,
  paymentQr,
  paymentRows,
  rule,
  tableLayout,
  totalsTable,
  vatBreakdownTable,
  withProps,
  type DefRow,
  type LabelStyle,
  type Margins,
  type PartyStyle,
  type TableStyle,
} from './blocks'
import { COLORS, mutedOn, readableOnWhite, shade, tint, type DocContext } from './context'
import { FONT } from './fonts'
import type { LabelKey } from './labels'

export interface TemplateInfo {
  id: TemplateId
  name: { et: string; en: string }
  description: { et: string; en: string }
}

/** Picker order; `standard` is the default for new profiles. */
export const TEMPLATES: TemplateInfo[] = [
  {
    id: 'standard',
    name: { et: 'Standard', en: 'Standard' },
    description: {
      et: 'Selge ja rahulik: pealkiri, summa ja tähtaeg ühel real, õhuke tabel, makseandmed jaluses. Sobib igale arvele.',
      en: 'Clear and calm: title, amount and due date in one line, light table, payment details at the bottom. Fits any invoice.',
    },
  },
  {
    id: 'classic',
    name: { et: 'Klassikaline', en: 'Classic' },
    description: {
      et: 'Traditsiooniline Eesti arve: raamitud päiseandmed, müüja ja ostja andmed kastides, ruudustikuga tabel.',
      en: 'Traditional Estonian invoice: boxed header details, seller and buyer boxes, fully gridded table.',
    },
  },
  {
    id: 'modern',
    name: { et: 'Moodne', en: 'Modern' },
    description: {
      et: 'Värviline päiseriba, kus tasumisele kuuluv summa on suurelt näha; palju õhku.',
      en: 'Accent colour header band with the amount due set large; generous whitespace.',
    },
  },
  {
    id: 'minimal',
    name: { et: 'Minimalistlik', en: 'Minimal' },
    description: {
      et: 'Šveitsi stiilis tüpograafiline ruudustik, mustvalge kujundus ja peened aktsendijooned.',
      en: 'Swiss-style typographic grid, monochrome with thin accent rules.',
    },
  },
  {
    id: 'bold',
    name: { et: 'Julge', en: 'Bold' },
    description: {
      et: 'Suur kiri ja värviline summaplokk. Sobib, kui tahad silma paista.',
      en: 'Big type and a strong accent block for the total — for brands that want presence.',
    },
  },
  {
    id: 'compact',
    name: { et: 'Kompaktne', en: 'Compact' },
    description: {
      et: 'Tihe paigutus pikkade arvete jaoks: esimesele lehele mahub umbes 35 rida.',
      en: 'Dense layout for long invoices: about 35 lines fit on the first page.',
    },
  },
]

export type TemplateDefinition = Pick<TDocumentDefinitions, 'content' | 'pageMargins' | 'background' | 'footer' | 'header' | 'defaultStyle'>

const PAGE_WIDTH = 595.28

const bilingual = (ctx: DocContext) => ctx.lang === 'et-en'

/** Long invoices get tighter table rows so ~40 lines fit on two pages in the airy templates. */
const isLong = (ctx: DocContext) => ctx.invoice.lines.length > 12

// Colour modes: every template maps `ctx.accent` (the primary colour; a neutral ink in 'mono') to its main
// coloured element and, in 'duo', gives its supporting elements (labels, rules, bars, zebra) `ctx.secondary`.

/** A supporting element's colour: `duo(ctx.secondary)` in duo mode, otherwise the template's own `otherwise`. */
function second(ctx: DocContext, otherwise: string, duo: (secondary: string) => string = (c) => c): string {
  return ctx.colorMode === 'duo' ? duo(ctx.secondary) : otherwise
}

/** Secondary colour for small label text (≥ 4.5:1 on white). */
const labelInk = (c: string) => readableOnWhite(c, 4.5)

/** Small uppercase section heading ("MÜÜJA", "MAKSEANDMED"). */
function heading(color: string, fontSize = 7.5, secondaryColor?: string): LabelStyle {
  return { fontSize, color, secondaryColor: secondaryColor ?? color, bold: true, uppercase: true, characterSpacing: 0.6 }
}

/** "2 083,20 € tasuda 28.10.2026" — one run for the amount, one for the due date. */
function amountDueLine(ctx: DocContext, amountColor: string): Content[] {
  const grand = grandTotal(ctx)
  if (ctx.isCreditNote || !ctx.invoice.dueDate) return [{ text: `${ctx.t(grand.key)} ` }, { text: grand.value, color: amountColor }]
  return [{ text: grand.value, color: amountColor }, { text: ` ${ctx.t('dueWord')} ${ctx.date(ctx.invoice.dueDate)}` }]
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Lines are followed by [VAT breakdown | totals], kept together on one page. */
function totalsRow(breakdown: Content | null, totals: Content | null, width: number, gap = 32, margin: Margins = [0, 0, 0, 0]): Content {
  return {
    columns: [
      { width: '*', stack: breakdown ? [breakdown] : [{ text: '' }] },
      { width, stack: totals ? [totals] : [{ text: '' }] },
    ],
    columnGap: gap,
    margin,
    unbreakable: true,
  }
}

// ---------- standard ----------

function standard(ctx: DocContext): TemplateDefinition {
  const mx = 52
  const margins: Margins = [mx, 44, mx, 62]
  const W = PAGE_WIDTH - 2 * mx
  const bi = bilingual(ctx)
  const accentText = readableOnWhite(ctx.accent)
  // Duo: headline amount in the primary colour, section labels and the table's header rule in the secondary.
  const head = heading(second(ctx, COLORS.muted, labelInk), 7.5, second(ctx, COLORS.faint, () => COLORS.muted))
  const party: PartyStyle = { heading: head, headingGap: 6, nameSize: 10, fontSize: 9, color: COLORS.text, labelColor: COLORS.muted }
  const brand = logo(ctx, [170, 52], 'right') ?? { text: ctx.invoice.seller.name, font: FONT.strong, fontSize: 12, color: COLORS.ink, alignment: 'right' }
  const table: TableStyle = {
    layout: tableLayout({ header: [0.8, second(ctx, COLORS.text)], rows: [0.5, COLORS.hairline], bottom: [0.5, COLORS.hairline], paddingX: 7, paddingY: isLong(ctx) ? 3.6 : 6.7, headerPaddingY: 5.5 }),
    headerColor: COLORS.muted,
    headerSecondaryColor: COLORS.faint,
    headerFontSize: 8,
    bodyFontSize: isLong(ctx) ? 8.5 : 9,
  }
  const def = { fontSize: 9, labelSize: 8.5, labelColor: COLORS.muted, labelSecondaryColor: COLORS.faint, valueColor: COLORS.ink, gap: 18, paddingY: 1.3 }
  const breakdown = vatBreakdownTable(ctx, { ...table, headerFontSize: 7.5, bodyFontSize: 8.5, layout: tableLayout({ header: [0.5, COLORS.rule], paddingX: 7, paddingY: 3.5 }) })
  const totals = totalsTable(ctx, {
    fontSize: 9,
    labelColor: COLORS.muted,
    labelSecondaryColor: COLORS.faint,
    valueColor: COLORS.text,
    grandLabelSize: 9.5,
    grandFontSize: 10.5,
    grandColor: COLORS.ink,
    grandRule: [0.8, COLORS.text],
    rowRule: [0.5, COLORS.hairline],
    paddingY: 3.6,
    grandPaddingY: 5.5,
  })
  const pay = paymentRows(ctx)
  const qr = paymentQr(ctx, 80, { fontSize: 7, color: COLORS.muted, secondaryColor: COLORS.faint, alignment: 'center' })
  const notes = notesBlock(ctx, { fontSize: 8, color: COLORS.text, mutedColor: COLORS.muted, heading: { ...head, fontSize: 7 }, gap: 4 })

  const content: Content[] = [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: ctx.title, bold: true, fontSize: bi ? 19 : 22, color: COLORS.ink, lineHeight: 1 },
            { ...defList(ctx, metaRows(ctx), { ...def, fontSize: 8.5 }), margin: [0, 12, 0, 0] },
          ],
        },
        { width: 180, stack: [brand] },
      ],
      columnGap: 24,
    },
    { text: amountDueLine(ctx, accentText), bold: true, fontSize: 15, color: COLORS.ink, margin: [0, 20, 0, 0] },
    {
      columns: [
        { width: '*', ...partyBlock(ctx, 'seller', party) },
        { width: '*', ...partyBlock(ctx, 'buyer', party) },
      ],
      columnGap: 32,
      margin: [0, 20, 0, 0],
    },
    { ...linesTable(ctx, table), margin: [0, 22, 0, 0] },
    totalsRow(breakdown ? { ...breakdown, margin: [0, 10, 0, 0] } : null, totals, bi ? 290 : 250, 40, [0, 4, 0, 0]),
  ]
  if (pay.length || qr) {
    content.push({
      stack: [
        rule(W, COLORS.hairline, 0.5, [0, 0, 0, 12]),
        {
          columns: [
            { width: '*', stack: [{ ...inlineLabel(ctx, 'bankDetails', head), margin: [0, 0, 0, 6] }, ...(pay.length ? [defList(ctx, pay, def)] : [])] },
            ...(qr ? [{ width: 'auto', stack: [qr] } as Content] : []),
          ],
          columnGap: 24,
        },
      ],
      margin: [0, 22, 0, 0],
      unbreakable: true,
    })
  }
  if (notes) content.push({ ...notes, margin: [0, pay.length || qr ? 14 : 22, 0, 0] })
  return {
    pageMargins: margins,
    defaultStyle: { font: FONT.sans, fontSize: 9, color: COLORS.text, lineHeight: 1.2 },
    header: continuationHeader(ctx, { marginX: mx, top: 24, fontSize: 7.5, color: COLORS.faint }),
    content,
    footer: footer(ctx, { marginX: mx, fontSize: 7.5, color: COLORS.faint, top: 24 }),
  }
}

// ---------- classic ----------

function classic(ctx: DocContext): TemplateDefinition {
  const mx = 44
  const margins: Margins = [mx, 44, mx, 76]
  const bi = bilingual(ctx)
  const accentText = readableOnWhite(ctx.accent)
  const fill = ctx.accentTint
  // Duo: header fills stay a tint of the primary colour, the box rules take a softened secondary colour.
  const line: [number, string] = [0.6, second(ctx, COLORS.rule, (c) => tint(c, 0.35))]
  const grid = (pad: number, py = pad - 2) => tableLayout({ top: line, header: line, rows: line, bottom: line, vertical: line, paddingX: pad, paddingY: py, edge: pad })
  const headStyle: LabelStyle = { fontSize: 7.5, color: shade(accentText, 0.1), secondaryColor: COLORS.muted, bold: true, uppercase: true, characterSpacing: 0.4 }
  const headCell = (key: LabelKey, props: Record<string, unknown> = {}) => withProps(inlineLabel(ctx, key, headStyle), { fillColor: fill, ...props })
  const party: PartyStyle = { heading: null, nameSize: 10, fontSize: 8.5, color: COLORS.text, labelColor: COLORS.muted, lineGap: 0.5 }
  const brand = logo(ctx, [200, 56]) ?? { text: ctx.invoice.seller.name, font: FONT.strong, bold: true, fontSize: 15, color: accentText }
  const meta = metaRows(ctx, { reference: true })
  // At most five facts per row, rows balanced (7 → 4 + 3).
  const perRow = Math.ceil(meta.length / Math.ceil(meta.length / 5))
  const table: TableStyle = {
    layout: grid(5, isLong(ctx) ? 3 : 4.6),
    headerFill: fill,
    headerColor: COLORS.ink,
    headerSecondaryColor: COLORS.muted,
    headerFontSize: 7.5,
    bodyFontSize: 8.5,
    lineNumbers: true,
  }
  const breakdown = vatBreakdownTable(ctx, { ...table, bodyFontSize: 8 })
  const totals = totalsTable(ctx, {
    fontSize: 8.5,
    labelColor: COLORS.text,
    labelSecondaryColor: COLORS.muted,
    valueColor: COLORS.text,
    grandFontSize: 11,
    grandLabelSize: 9,
    grandColor: COLORS.ink,
    grandFill: fill,
    grid: line,
    paddingX: 6,
    paddingY: 3.5,
    grandPaddingY: 5,
  })
  const pay = paymentRows(ctx, { reference: false })
  const qr = paymentQr(ctx, 74, { fontSize: 6.5, color: COLORS.muted, alignment: 'center' })
  const notes = notesBlock(ctx, { fontSize: 8, color: COLORS.text, mutedColor: COLORS.muted, heading: { ...headStyle, color: accentText } })

  const content: Content[] = [
    {
      columns: [
        { width: '*', stack: [brand] },
        { width: 'auto', text: ctx.title.toUpperCase(), font: FONT.strong, bold: true, fontSize: bi ? 16 : 20, color: accentText, alignment: 'right', characterSpacing: 1 },
      ],
      columnGap: 20,
    },
    {
      table: {
        widths: chunk(meta, perRow)[0].map(() => '*'),
        // One cell per fact, label stacked above its value, so text extraction keeps each pair together.
        body: chunk(meta, perRow).map((rows) => [
          ...rows.map((r) => fact(ctx, r, { label: { fontSize: 7.5, color: COLORS.muted, secondaryColor: COLORS.faint }, value: { fontSize: 9, color: COLORS.ink }, gap: 2.5 })),
          ...Array.from({ length: perRow - rows.length }, () => ({ text: '' })),
        ]) as never,
      },
      layout: grid(7, 5),
      margin: [0, 16, 0, 0],
    },
    {
      table: {
        widths: ['*', '*'],
        body: [
          [headCell('seller'), headCell('buyer')],
          [partyBlock(ctx, 'seller', party), partyBlock(ctx, 'buyer', party)],
        ],
      },
      layout: grid(7, 5),
      margin: [0, 12, 0, 0],
    },
    { ...linesTable(ctx, table), margin: [0, 16, 0, 0] },
    totalsRow(breakdown, totals, bi ? 290 : 240, 24, [0, 10, 0, 0]),
  ]
  if (pay.length) {
    content.push({
      table: {
        widths: qr ? ['*', 'auto'] : ['*'],
        body: [
          qr ? [headCell('bankDetails', { colSpan: 2 }), {}] : [headCell('bankDetails')],
          [defList(ctx, pay, { fontSize: 8.5, labelColor: COLORS.muted, labelSecondaryColor: COLORS.faint, valueColor: COLORS.ink, gap: 16, paddingY: 1.2 }), ...(qr ? [qr] : [])],
        ],
      },
      layout: grid(7, 5),
      margin: [0, 16, 0, 0],
      unbreakable: true,
    })
  }
  if (notes) content.push({ ...notes, margin: [0, 14, 0, 0] })
  return {
    pageMargins: margins,
    defaultStyle: { font: FONT.sans, fontSize: 8.5, color: COLORS.text, lineHeight: 1.2 },
    header: continuationHeader(ctx, { marginX: mx, top: 22, fontSize: 7, color: COLORS.muted }),
    content,
    footer: footer(ctx, { marginX: mx, fontSize: 7, color: COLORS.muted, ruleColor: COLORS.rule, sellerSummary: true, top: 18 }),
  }
}

// ---------- modern ----------

function modern(ctx: DocContext): TemplateDefinition {
  const mx = 48
  const top = 42
  const margins: Margins = [mx, top, mx, 64]
  const bi = bilingual(ctx)
  const on = ctx.onAccent
  const onMuted = on === COLORS.white ? tint(ctx.accent, 0.68) : shade(ctx.accent, 0.6)
  const accentText = readableOnWhite(ctx.accent)
  // Duo: the band in the primary colour; rules, labels and the payment box in the secondary.
  const secondText = second(ctx, accentText, labelInk)
  const secondRule = second(ctx, ctx.accent)
  const grand = grandTotal(ctx)
  const head = heading(secondText, 7.5, COLORS.muted)
  const party: PartyStyle = { heading: head, headingGap: 7, nameSize: 10.5, fontSize: 9, color: COLORS.text, labelColor: COLORS.muted }
  // All document facts live in the band; its height follows the number of rows (Plex line = 1.3 em).
  const bandRows = metaRows(ctx)
  const brand = logo(ctx, [120, 34], 'right')
  const titleSize = bi ? 21 : 26
  const leftHeight = titleSize * 1.3 + 12 + bandRows.length * (9 * 1.3 * 1.2 + 3)
  const rightHeight = (brand ? 64 : 6) + 8 * 1.3 * 1.2 + 3 + (brand ? 24 : 28) * 1.3
  const bandContent = Math.ceil(Math.max(leftHeight, rightHeight, 104))
  const bandHeight = top + bandContent + 28
  const table: TableStyle = {
    layout: tableLayout({ header: [1.2, secondRule], rows: [0.5, COLORS.hairline], bottom: [0.5, COLORS.hairline], paddingX: 8, paddingY: isLong(ctx) ? 3.1 : 6.7, headerPaddingY: 6 }),
    headerColor: secondText,
    headerSecondaryColor: COLORS.muted,
    headerFontSize: 7.5,
    headerUppercase: true,
    headerCharacterSpacing: 0.5,
    bodyFontSize: isLong(ctx) ? 8.5 : 9,
  }
  const breakdown = vatBreakdownTable(ctx, { ...table, bodyFontSize: 8.5, layout: tableLayout({ header: [0.8, secondRule], rows: [0.5, COLORS.hairline], paddingX: 8, paddingY: 4 }) })
  const totals = totalsTable(ctx, {
    fontSize: 9,
    labelColor: COLORS.muted,
    labelSecondaryColor: COLORS.faint,
    valueColor: COLORS.text,
    grandLabelSize: 9.5,
    grandFontSize: 13,
    grandColor: COLORS.ink,
    grandLabelColor: secondText,
    grandRule: [1.2, secondRule],
    paddingY: 3.5,
    grandPaddingY: 6,
  })
  const pay = paymentRows(ctx)
  const qr = paymentQr(ctx, 80, { fontSize: 7, color: COLORS.muted, secondaryColor: COLORS.faint, alignment: 'center' })
  const notes = notesBlock(ctx, { fontSize: 8, color: COLORS.text, mutedColor: COLORS.muted, heading: heading(secondText, 7, COLORS.muted), gap: 4 })
  const boxFill = second(ctx, ctx.accentTint, () => ctx.secondaryTint)

  const band: Content = {
    table: {
      widths: ['*'],
      heights: [bandContent + 28],
      body: [
        [
          {
            columns: [
              {
                width: '*',
                stack: [
                  { text: ctx.title, font: FONT.strong, bold: true, fontSize: bi ? 21 : 26, color: on, lineHeight: 1 },
                  {
                    ...defList(ctx, bandRows, { fontSize: 9, labelSize: 8.5, labelColor: onMuted, valueColor: on, gap: 16, paddingY: 1.5 }),
                    margin: [0, 12, 0, 0],
                  },
                ],
              },
              {
                width: 'auto',
                stack: [
                  // The logo sits on a white tile so any logo colour stays visible on the accent band.
                  ...(brand ? [{ table: { body: [[{ stack: [brand], fillColor: COLORS.white }]] }, layout: tableLayout({ paddingX: 0, paddingY: 7, edge: 9 }), alignment: 'right', margin: [0, 0, 0, 16] } as Content] : []),
                  inlineLabel(ctx, grand.key, { fontSize: 8, color: onMuted, bold: true, uppercase: true, characterSpacing: 0.6, alignment: 'right' }),
                  { text: grand.value, font: FONT.strong, bold: true, fontSize: brand ? 24 : 28, color: on, alignment: 'right', margin: [0, 3, 0, 0], lineHeight: 1 },
                ],
                margin: [0, brand ? 0 : 6, 0, 0],
              },
            ],
            columnGap: 24,
          },
        ],
      ],
    },
    layout: tableLayout({ paddingX: 0, paddingY: 0 }),
  }

  const content: Content[] = [
    band,
    {
      columns: [
        { width: '*', ...partyBlock(ctx, 'seller', party) },
        { width: '*', ...partyBlock(ctx, 'buyer', party) },
      ],
      columnGap: 28,
      margin: [0, 26, 0, 0],
    },
    { ...linesTable(ctx, table), margin: [0, 24, 0, 0] },
    totalsRow(breakdown ? { ...breakdown, margin: [0, 10, 0, 0] } : null, totals, bi ? 290 : 250, 40, [0, 4, 0, 0]),
  ]
  if (pay.length || qr) {
    content.push({
      table: {
        widths: qr ? ['*', 'auto'] : ['*'],
        body: [
          [
            { stack: [{ ...inlineLabel(ctx, 'bankDetails', head), margin: [0, 0, 0, 7] }, ...(pay.length ? [defList(ctx, pay, { fontSize: 9, labelSize: 8.5, labelColor: COLORS.muted, labelSecondaryColor: COLORS.faint, valueColor: COLORS.ink, gap: 18, paddingY: 1.2 })] : [])], fillColor: boxFill },
            ...(qr ? [{ stack: [qr], fillColor: boxFill }] : []),
          ],
        ],
      },
      layout: tableLayout({ paddingX: 12, paddingY: 11, edge: 16 }),
      margin: [0, 22, 0, 0],
      unbreakable: true,
    })
  }
  if (notes) content.push({ ...notes, margin: [0, 14, 0, 0] })
  return {
    pageMargins: margins,
    defaultStyle: { font: FONT.sans, fontSize: 9, color: COLORS.text, lineHeight: 1.2 },
    background: (page: number, size: ContextPageSize) => ({ canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: page === 1 ? bandHeight : 8, color: ctx.accent }] }),
    content,
    footer: footer(ctx, { marginX: mx, fontSize: 7.5, color: COLORS.faint, top: 24 }),
  }
}

// ---------- minimal ----------

function minimal(ctx: DocContext): TemplateDefinition {
  const mx = 56
  const margins: Margins = [mx, 46, mx, 62]
  const W = PAGE_WIDTH - 2 * mx
  const GAP = 16
  const COL = (W - 3 * GAP) / 4
  const span = (n: number) => n * COL + (n - 1) * GAP
  const grand = grandTotal(ctx)
  // Rules in the primary colour; in duo the small labels take the secondary colour.
  const lbl: LabelStyle = { fontSize: 7, color: second(ctx, COLORS.muted, labelInk), secondaryColor: second(ctx, COLORS.faint, () => COLORS.muted), uppercase: true, characterSpacing: 0.7 }
  const party: PartyStyle = { heading: lbl, headingGap: 7, nameSize: 9.5, fontSize: 8.5, color: COLORS.ink, labelColor: COLORS.muted, lineGap: 1 }
  const brand = logo(ctx, [150, 40], 'right') ?? { text: ctx.invoice.seller.name, fontSize: 9.5, bold: true, color: COLORS.ink, alignment: 'right' }
  const facts: DefRow[] = [...metaRows(ctx), { key: grand.key, value: grand.value, strong: true }]
  const factRow = (rows: DefRow[]): Content => ({
    columns: rows.map((r) => ({ width: COL, ...fact(ctx, r, { label: lbl, value: { fontSize: 9.5, color: COLORS.ink }, gap: 3 }) }) as Content),
    columnGap: GAP,
  })
  const table: TableStyle = {
    layout: tableLayout({ header: [0.6, COLORS.ink], rows: [0.4, COLORS.hairline], bottom: [0.6, COLORS.ink], paddingX: 6, paddingY: isLong(ctx) ? 3.6 : 6.2, headerPaddingY: 5.5 }),
    headerColor: COLORS.muted,
    headerSecondaryColor: COLORS.faint,
    headerFontSize: 7,
    headerBold: false,
    headerUppercase: true,
    headerCharacterSpacing: 0.6,
    bodyFontSize: 8.5,
    bodyColor: COLORS.ink,
  }
  const breakdown = vatBreakdownTable(ctx, { ...table, layout: tableLayout({ header: [0.4, COLORS.ink], rows: [0.4, COLORS.hairline], paddingX: 6, paddingY: 3.5 }) })
  const totals = totalsTable(ctx, {
    fontSize: 8.5,
    labelColor: COLORS.muted,
    labelSecondaryColor: COLORS.faint,
    valueColor: COLORS.ink,
    grandFontSize: 12,
    grandLabelSize: 8.5,
    grandColor: COLORS.ink,
    grandRule: [0.8, ctx.accent],
    paddingY: 3,
    grandPaddingY: 7,
  })
  const pay = paymentRows(ctx)
  const qr = paymentQr(ctx, 76, { ...lbl, fontSize: 6.5 })
  const notes = notesBlock(ctx, { fontSize: 7.5, color: COLORS.ink, mutedColor: COLORS.muted, heading: lbl, gap: 4 })
  const hair = (m: Margins) => rule(W, COLORS.hairline, 0.5, m)

  const content: Content[] = [
    rule(W, ctx.accent, 1.2, [0, 0, 0, 16]),
    {
      columns: [
        { width: span(2), text: ctx.title, fontSize: bilingual(ctx) ? 22 : 28, color: COLORS.ink, characterSpacing: -0.3, lineHeight: 1 },
        { width: span(2), stack: [brand] },
      ],
      columnGap: GAP,
    },
    hair([0, 18, 0, 12]),
    ...chunk(facts, 4).map((rows, i) => ({ ...(factRow(rows) as object), margin: [0, i ? 12 : 0, 0, 0] }) as Content),
    hair([0, 12, 0, 12]),
    {
      columns: [
        { width: span(2), ...partyBlock(ctx, 'seller', party) },
        { width: span(2), ...partyBlock(ctx, 'buyer', party) },
      ],
      columnGap: GAP,
    },
    { ...linesTable(ctx, table), margin: [0, 22, 0, 0] },
    totalsRow(breakdown ? { ...breakdown, margin: [0, 8, 0, 0] } : null, totals, span(2), GAP, [0, 6, 0, 0]),
  ]
  if (pay.length || qr) {
    content.push({
      stack: [
        hair([0, 0, 0, 12]),
        {
          columns: [
            { width: span(2), stack: [{ ...inlineLabel(ctx, 'bankDetails', lbl), margin: [0, 0, 0, 7] }, ...(pay.length ? [defList(ctx, pay, { fontSize: 8.5, labelSize: 8, labelColor: COLORS.muted, labelSecondaryColor: COLORS.faint, valueColor: COLORS.ink, gap: 16, paddingY: 1.2 })] : [])] },
            { width: span(2), stack: qr ? [qr] : [{ text: '' }] },
          ],
          columnGap: GAP,
        },
      ],
      margin: [0, 22, 0, 0],
      unbreakable: true,
    })
  }
  if (notes) content.push({ columns: [{ width: span(3) + GAP / 2, ...notes }, { width: '*', text: '' }], margin: [0, 14, 0, 0] })
  return {
    pageMargins: margins,
    defaultStyle: { font: FONT.sans, fontSize: 8.5, color: COLORS.ink, lineHeight: 1.2 },
    header: continuationHeader(ctx, { marginX: mx, top: 24, fontSize: 7, color: COLORS.faint }),
    content,
    footer: footer(ctx, { marginX: mx, fontSize: 7, color: COLORS.faint, top: 24 }),
    background: (page: number, size: ContextPageSize) => (page === 1 ? null : { canvas: [{ type: 'line', x1: mx, y1: 40, x2: size.width - mx, y2: 40, lineWidth: 0.6, lineColor: ctx.accent }] }),
  }
}

// ---------- bold ----------

function bold(ctx: DocContext): TemplateDefinition {
  const mx = 48
  const margins: Margins = [mx, 42, mx, 62]
  const W = PAGE_WIDTH - 2 * mx
  const bi = bilingual(ctx)
  const accentText = readableOnWhite(ctx.accent)
  const on = ctx.onAccent
  const onMuted = on === COLORS.white ? tint(ctx.accent, 0.72) : shade(ctx.accent, 0.6)
  const grand = grandTotal(ctx)
  const head = heading(COLORS.muted, 7.5, COLORS.faint)
  const party: PartyStyle = { heading: head, headingGap: 6, nameSize: 12, nameFont: FONT.strong, fontSize: 9, color: COLORS.text, labelColor: COLORS.muted }
  const brand = logo(ctx, [150, 56], 'right') ?? { text: ctx.invoice.seller.name, font: FONT.strong, bold: true, fontSize: 14, color: COLORS.ink, alignment: 'right' }
  const facts = metaRows(ctx)
  const table: TableStyle = {
    layout: tableLayout({ header: [1.6, COLORS.ink], rows: [0.5, COLORS.hairline], bottom: [0.5, COLORS.rule], paddingX: 8, paddingY: isLong(ctx) ? 3.6 : 6.7, headerPaddingY: 6 }),
    headerColor: COLORS.ink,
    headerSecondaryColor: COLORS.muted,
    headerFontSize: 7.5,
    headerUppercase: true,
    headerCharacterSpacing: 0.6,
    bodyFontSize: isLong(ctx) ? 8.5 : 9,
  }
  const breakdown = vatBreakdownTable(ctx, { ...table, bodyFontSize: 8.5, layout: tableLayout({ header: [0.8, COLORS.ink], rows: [0.5, COLORS.hairline], paddingX: 8, paddingY: 4 }) })
  const subtotals = ctx.totals.showVat
    ? totalsTable(ctx, { fontSize: 9, labelColor: COLORS.muted, labelSecondaryColor: COLORS.faint, valueColor: COLORS.ink, grandFontSize: 9, grandColor: COLORS.ink, rowRule: [0.5, COLORS.hairline], paddingY: 3.5, omitGrand: true })
    : null
  const dueRow = !ctx.isCreditNote && ctx.invoice.dueDate ? { key: 'dueDate' as LabelKey, value: ctx.date(ctx.invoice.dueDate) } : null
  const block: Content = {
    table: {
      widths: ['*', 'auto'],
      // Reading order: label → amount → due date (the amount must directly follow its label).
      body: [
        [
          { ...inlineLabel(ctx, grand.key, { fontSize: 9, color: on, bold: true, uppercase: true, characterSpacing: 0.8 }), fillColor: ctx.accent, margin: [0, 5, 0, 0] },
          { text: grand.value, font: FONT.strong, bold: true, fontSize: 30, color: on, alignment: 'right', fillColor: ctx.accent, lineHeight: 1, rowSpan: dueRow ? 2 : 1, margin: [0, 4, 0, 0] },
        ],
        ...(dueRow
          ? [[{ text: [{ text: `${ctx.t('dueDate')} `, color: onMuted }, { text: dueRow.value, color: on }], fontSize: 9, fillColor: ctx.accent, margin: [0, 0, 0, 2] }, {}]]
          : []),
      ] as never,
    },
    layout: { ...tableLayout({ paddingX: 12, paddingY: 0, edge: 18 }), paddingTop: (i: number) => (i === 0 ? 12 : 3), paddingBottom: (i: number, node: { table: { body: unknown[] } }) => (i === node.table.body.length - 1 ? 12 : 0) },
  }
  const pay = paymentRows(ctx)
  const qr = paymentQr(ctx, 80, { fontSize: 7, color: COLORS.muted, secondaryColor: COLORS.faint, alignment: 'center' })
  const notes = notesBlock(ctx, { fontSize: 8, color: COLORS.text, mutedColor: COLORS.muted, heading: heading(COLORS.muted, 7, COLORS.faint), gap: 4 })

  const content: Content[] = [
    {
      columns: [
        {
          width: '*',
          stack: [{ text: ctx.title, font: FONT.strong, bold: true, fontSize: bi ? 30 : 42, color: accentText, lineHeight: 1, characterSpacing: -0.5 }],
        },
        { width: 180, stack: [brand] },
      ],
      columnGap: 24,
    },
    // Facts on a strict three-column grid so rows line up.
    ...chunk(facts, 3).map(
      (rows, i) =>
        ({
          columns: [
            ...rows.map((r) => ({ width: '*', ...fact(ctx, r, { label: { ...head, noWrap: true }, value: { fontSize: 11.5, color: COLORS.ink, strongFont: FONT.strong, monoScale: 1 }, gap: 3 }) }) as Content),
            ...Array.from({ length: 3 - rows.length }, () => ({ width: '*', text: '' }) as Content),
          ],
          columnGap: 30,
          margin: [0, i ? 10 : 16, 0, 0],
        }) as Content,
    ),
    rule(W, COLORS.ink, 1.6, [0, 14, 0, 14]),
    {
      columns: [
        { width: '*', ...partyBlock(ctx, 'seller', party) },
        { width: '*', ...partyBlock(ctx, 'buyer', party) },
      ],
      columnGap: 32,
    },
    { ...linesTable(ctx, table), margin: [0, 22, 0, 0] },
    {
      stack: [
        ...(subtotals || breakdown ? [totalsRow(breakdown ? { ...breakdown, margin: [0, 8, 0, 0] } : null, subtotals, bi ? 290 : 260, 40)] : []),
        { ...block, margin: [0, 10, 0, 0] },
      ],
      margin: [0, 2, 0, 0],
      unbreakable: true,
    },
  ]
  // Payment details, notes and QR side by side keep the big-type layout on one page.
  if (pay.length || qr || notes) {
    content.push({
      columns: [
        ...(pay.length ? [{ width: 'auto', stack: [{ ...inlineLabel(ctx, 'bankDetails', head), margin: [0, 0, 0, 6] }, defList(ctx, pay, { fontSize: 9, labelSize: 8.5, labelColor: COLORS.muted, labelSecondaryColor: COLORS.faint, valueColor: COLORS.ink, gap: 18, paddingY: 1.2 })] } as Content] : []),
        { width: '*', stack: notes ? [{ ...notes, margin: [0, pay.length ? 17 : 0, 0, 0] }] : [{ text: '' }] },
        ...(qr ? [{ width: 'auto', stack: [qr] } as Content] : []),
      ],
      columnGap: 28,
      margin: [0, 20, 0, 0],
      unbreakable: true,
    })
  }
  return {
    pageMargins: margins,
    defaultStyle: { font: FONT.sans, fontSize: 9, color: COLORS.text, lineHeight: 1.18 },
    header: continuationHeader(ctx, { marginX: mx, top: 22, fontSize: 7.5, color: COLORS.faint }),
    // Duo: the amount block keeps the primary colour, the bar along the left edge takes the secondary.
    background: (_page: number, size: ContextPageSize) => ({ canvas: [{ type: 'rect', x: 0, y: 0, w: 10, h: size.height, color: second(ctx, ctx.accent) }] }),
    content,
    footer: footer(ctx, { marginX: mx, fontSize: 7.5, color: COLORS.faint, top: 24 }),
  }
}

// ---------- compact ----------

function compact(ctx: DocContext): TemplateDefinition {
  const mx = 34
  const margins: Margins = [mx, 36, mx, 46]
  const bi = bilingual(ctx)
  const accentText = readableOnWhite(ctx.accent)
  const duo = ctx.colorMode === 'duo'
  const head = heading(COLORS.muted, 6.5, COLORS.faint)
  const party: PartyStyle = { heading: head, headingGap: 3, nameSize: 8.5, fontSize: 7.6, color: COLORS.text, labelColor: COLORS.muted }
  const brand = logo(ctx, [130, 34], 'right') ?? { text: ctx.invoice.seller.name, bold: true, fontSize: 9.5, color: COLORS.ink, alignment: 'right' }
  const def = { fontSize: 7.6, labelSize: 7.3, labelColor: COLORS.muted, labelSecondaryColor: COLORS.faint, valueColor: COLORS.ink, gap: 10, paddingY: 0.8 }
  // Duo: the table header row filled with the primary colour, zebra rows in a tint of the secondary.
  const table: TableStyle = {
    layout: tableLayout({ header: [0.6, duo ? ctx.accent : COLORS.rule], bottom: [0.6, COLORS.rule], paddingX: 5, paddingY: 2.7, headerPaddingY: 4, edge: 4 }),
    headerFill: duo ? ctx.accent : COLORS.fill,
    headerColor: duo ? ctx.onAccent : COLORS.muted,
    headerSecondaryColor: duo ? mutedOn(ctx.accent, ctx.onAccent) : COLORS.faint,
    headerFontSize: 6.8,
    headerUppercase: true,
    headerCharacterSpacing: 0.3,
    bodyFontSize: 7.6,
    zebra: duo ? tint(ctx.secondary, 0.92) : '#f8f9fa',
    lineNumbers: true,
  }
  const breakdown = vatBreakdownTable(ctx, { ...table, headerFill: COLORS.fill, headerColor: COLORS.muted, headerSecondaryColor: COLORS.faint, zebra: undefined, layout: tableLayout({ header: [0.5, COLORS.rule], bottom: [0.5, COLORS.rule], paddingX: 5, paddingY: 2, headerPaddingY: 3, edge: 4 }) })
  const totals = totalsTable(ctx, {
    fontSize: 7.8,
    labelColor: COLORS.muted,
    labelSecondaryColor: COLORS.faint,
    valueColor: COLORS.text,
    grandFontSize: 10,
    grandLabelSize: 8.2,
    grandColor: COLORS.ink,
    grandRule: [0.8, accentText],
    rowRule: [0.4, COLORS.hairline],
    paddingY: 2.2,
    grandPaddingY: 4,
    paddingX: 4,
  })
  const pay = paymentRows(ctx)
  const qr = paymentQr(ctx, 62, { fontSize: 6, color: COLORS.muted, secondaryColor: COLORS.faint, alignment: 'center' })
  const notes = notesBlock(ctx, { fontSize: 7.2, color: COLORS.text, mutedColor: COLORS.muted, heading: head, gap: 2.5 })

  const content: Content[] = [
    {
      columns: [
        { width: '*', text: [{ text: ctx.title, font: FONT.strong, bold: true, fontSize: 15, color: COLORS.ink }], lineHeight: 1 },
        { width: 200, stack: [brand] },
      ],
      columnGap: 16,
    },
    {
      columns: [
        { width: bi ? 210 : 'auto', stack: [defList(ctx, metaRows(ctx), { ...def, labelNoWrap: !bi, valueWidth: 'auto' })], margin: [0, 11, 0, 0] },
        { width: '*', ...partyBlock(ctx, 'seller', party) },
        { width: '*', ...partyBlock(ctx, 'buyer', party) },
      ],
      columnGap: 18,
      margin: [0, 10, 0, 0],
    },
    { ...linesTable(ctx, table), margin: [0, 12, 0, 0] },
    totalsRow(breakdown ? { ...breakdown, margin: [0, 4, 0, 0] } : null, totals, bi ? 270 : 220, 28, [0, 4, 0, 0]),
  ]
  if (pay.length || qr || notes) {
    content.push({
      columns: [
        ...(pay.length ? [{ width: 'auto', stack: [{ ...inlineLabel(ctx, 'bankDetails', head), margin: [0, 0, 0, 3] }, defList(ctx, pay, def)] } as Content] : []),
        ...(qr ? [{ width: 'auto', stack: [qr] } as Content] : []),
        { width: '*', stack: notes ? [notes] : [{ text: '' }] },
      ],
      columnGap: 22,
      margin: [0, 12, 0, 0],
      unbreakable: true,
    })
  }
  return {
    pageMargins: margins,
    defaultStyle: { font: FONT.sans, fontSize: 7.6, color: COLORS.text, lineHeight: 1.18 },
    header: continuationHeader(ctx, { marginX: mx, top: 18, fontSize: 6.8, color: COLORS.faint }),
    content,
    footer: footer(ctx, { marginX: mx, fontSize: 6.8, color: COLORS.faint, top: 18 }),
  }
}

export const TEMPLATE_BUILDERS: Record<TemplateId, (ctx: DocContext) => TemplateDefinition> = { standard, classic, modern, minimal, bold, compact }
