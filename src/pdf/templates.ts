// The four visual templates. Each composes the shared blocks with its own layout and styling.
import type { Content, ContextPageSize, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { TemplateId } from '../domain/types'
import {
  footer,
  gridLayout,
  label,
  linesTable,
  logo,
  metaRows,
  metaTable,
  notesBlock,
  partyLines,
  paymentBlock,
  plainLayout,
  rulesLayout,
  totalRows,
  totalsTable,
  vatBreakdownTable,
  withProps,
  type TableStyle,
  type TotalRow,
  type TextBlockOptions,
} from './blocks'
import { COLORS, contrastText, readableOnWhite, shade, tint, type DocContext } from './context'
import type { LabelKey } from './labels'

export interface TemplateInfo {
  id: TemplateId
  name: { et: string; en: string }
  description: { et: string; en: string }
}

export const TEMPLATES: TemplateInfo[] = [
  {
    id: 'classic',
    name: { et: 'Klassikaline', en: 'Classic' },
    description: {
      et: 'Traditsiooniline Eesti arve: raamitud päis, müüja ja ostja andmed kastides, ruudustikuga tabel.',
      en: 'Traditional Estonian invoice: boxed header, seller and buyer boxes, fully gridded table.',
    },
  },
  {
    id: 'modern',
    name: { et: 'Moodne', en: 'Modern' },
    description: {
      et: 'Värviline riba lehe ülaservas, puhas paigutus ja suurelt esile tõstetud tasumisele kuuluv summa.',
      en: 'Accent colour band at the top, clean layout and a large highlighted amount due.',
    },
  },
  {
    id: 'minimal',
    name: { et: 'Minimalistlik', en: 'Minimal' },
    description: {
      et: 'Palju õhku, peened jooned, mustvalge kujundus ühe aktsendivärviga.',
      en: 'Lots of whitespace, thin rules, monochrome with a single accent colour.',
    },
  },
  {
    id: 'bold',
    name: { et: 'Julge', en: 'Bold' },
    description: {
      et: 'Suur värviline päiseplokk, suured pealkirjad ja selgelt esile tõstetud põhiandmed.',
      en: 'Strong coloured header block, big typography and prominent key figures.',
    },
  },
]

export type TemplateDefinition = Pick<TDocumentDefinitions, 'content' | 'pageMargins' | 'background' | 'footer' | 'defaultStyle'>

type Margins = [number, number, number, number]

function sectionLabel(ctx: DocContext, key: LabelKey, color: string, o: { fontSize?: number; uppercase?: boolean; secondaryColor?: string } = {}): Content {
  return {
    ...(label(ctx, key, { fontSize: o.fontSize ?? 7.5, color, secondaryColor: o.secondaryColor, bold: true, uppercase: o.uppercase ?? true, characterSpacing: 0.6 }) as object),
    margin: [0, 0, 0, 4],
  } as Content
}

/** Lines → [VAT breakdown | totals] → notes → payment. Shared by all templates. */
function bodySections(
  ctx: DocContext,
  o: { table: TableStyle; breakdown: TableStyle; totals: Content; text: TextBlockOptions; gap?: number; totalsWidth?: number },
): Content[] {
  const breakdown = vatBreakdownTable(ctx, o.breakdown)
  const notes = notesBlock(ctx, o.text)
  const payment = paymentBlock(ctx, o.text)
  const gap = o.gap ?? 16
  return [
    { ...linesTable(ctx, o.table), margin: [0, gap, 0, 0] },
    {
      columns: [
        { width: '*', stack: breakdown ? [{ ...breakdown, margin: [0, 0, 24, 0] }] : [{ text: '' }] },
        { width: (o.totalsWidth ?? 230) + (ctx.lang === 'et-en' ? 40 : 0), stack: [o.totals] },
      ],
      columnGap: 12,
      margin: [0, gap * 0.75, 0, 0],
      unbreakable: true,
    },
    ...(notes ? [{ stack: [notes], margin: [0, gap, 0, 0] } as Content] : []),
    ...(payment ? [{ stack: [payment], margin: [0, gap, 0, 0] } as Content] : []),
  ]
}

function textOptions(headingColor: string, uppercase = false): TextBlockOptions {
  return { fontSize: 8.5, color: COLORS.text, mutedColor: COLORS.muted, headingColor, headingUppercase: uppercase }
}

// ---------- classic ----------

function classic(ctx: DocContext): TemplateDefinition {
  const accentText = readableOnWhite(ctx.accent)
  const margins: Margins = [40, 40, 40, 64]
  const party = { nameSize: 10, fontSize: 8.5, color: COLORS.text, mutedColor: COLORS.muted }
  const box = (key: LabelKey, role: 'seller' | 'buyer'): Content => ({
    table: {
      widths: ['*'],
      body: [
        [withProps(label(ctx, key, { fontSize: 8, color: accentText, bold: true, uppercase: true }), { fillColor: ctx.accentTint })],
        [{ stack: partyLines(ctx, role, party) }],
      ],
    },
    layout: gridLayout(COLORS.rule, 0.6, 6),
  })
  const logoContent = logo(ctx, [170, 64])
  const table: TableStyle = {
    layout: gridLayout(COLORS.rule, 0.6, 4),
    headerFill: ctx.accentTint,
    headerColor: COLORS.text,
    headerSecondaryColor: COLORS.muted,
    headerFontSize: 8,
    bodyFontSize: 8.5,
  }
  const content: Content[] = [
    {
      columns: [
        {
          width: '*',
          stack: logoContent ? [logoContent] : [{ text: ctx.invoice.seller.name, fontSize: 16, bold: true, color: accentText }],
        },
        {
          width: 230,
          table: {
            widths: ['*'],
            body: [
              [{ text: ctx.title.toUpperCase(), fontSize: 16, bold: true, color: accentText, alignment: 'center', fillColor: ctx.accentTint, margin: [0, 3, 0, 3] }],
              [metaTable(ctx, { labelColor: COLORS.muted, valueColor: COLORS.text, fontSize: 8.5, layout: plainLayout(4, 1.5) })],
            ],
          },
          layout: gridLayout(COLORS.rule, 0.6, 5),
        },
      ],
      columnGap: 20,
    },
    { columns: [box('seller', 'seller'), box('buyer', 'buyer')], columnGap: 12, margin: [0, 16, 0, 0] },
    ...bodySections(ctx, {
      table,
      breakdown: { ...table, headerFontSize: 7.5, bodyFontSize: 8 },
      totals: totalsTable(ctx, {
        fontSize: 8.5,
        grandFontSize: 11,
        color: COLORS.text,
        mutedColor: COLORS.text,
        grandColor: COLORS.text,
        grandFill: ctx.accentTint,
        layout: gridLayout(COLORS.rule, 0.6, 4),
      }),
      text: textOptions(accentText),
    }),
  ]
  return {
    pageMargins: margins,
    defaultStyle: { fontSize: 8.5, color: COLORS.text },
    content,
    footer: footer(ctx, { marginX: margins[0], fontSize: 7, color: COLORS.muted, ruleColor: COLORS.rule }),
  }
}

// ---------- modern ----------

function modern(ctx: DocContext): TemplateDefinition {
  const accentText = readableOnWhite(ctx.accent)
  const margins: Margins = [44, 52, 44, 64]
  const party = { nameSize: 10, fontSize: 8.5, color: COLORS.text, mutedColor: COLORS.muted }
  const logoContent = logo(ctx, [150, 56], 'right')
  const filledHeader = {
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 ? 0 : i === node.table.body.length ? 0.8 : 0.4),
    vLineWidth: () => 0,
    hLineColor: (i: number, node: { table: { body: unknown[] } }) => (i === node.table.body.length ? ctx.accent : COLORS.hairline),
    paddingLeft: () => 6,
    paddingRight: () => 6,
    paddingTop: () => 5,
    paddingBottom: () => 5,
  }
  const table: TableStyle = {
    layout: filledHeader,
    headerFill: ctx.accent,
    headerColor: ctx.onAccent,
    headerSecondaryColor: ctx.onAccent === COLORS.white ? tint(ctx.accent, 0.7) : shade(ctx.accent, 0.6),
    headerFontSize: 8,
    bodyFontSize: 8.5,
    zebra: tint(ctx.accent, 0.95),
  }
  const grand = totalRowsGrand(ctx)
  const totals: Content = {
    stack: [
      ...(ctx.totals.showVat
        ? [totalsTable(ctx, { fontSize: 8.5, grandFontSize: 8.5, color: COLORS.text, mutedColor: COLORS.muted, grandColor: COLORS.text, layout: plainLayout(6, 2), omitGrand: true })]
        : []),
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                stack: [
                  { text: grand.text, fontSize: 8.5, color: ctx.onAccent, bold: true },
                  { text: grand.value, fontSize: 20, bold: true, color: ctx.onAccent, alignment: 'right' },
                ],
                fillColor: ctx.accent,
              },
            ],
          ],
        },
        layout: { ...plainLayout(0, 6), paddingLeft: () => 10, paddingRight: () => 10 },
        margin: [0, 6, 0, 0],
      },
    ],
  }
  const content: Content[] = [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: ctx.title, fontSize: 26, bold: true, color: accentText },
            { text: ctx.invoice.number ? `${ctx.t('number')} ${ctx.invoice.number}` : '', fontSize: 11, color: COLORS.muted, margin: [0, 2, 0, 0] },
          ],
        },
        ...(logoContent ? [{ width: 'auto', stack: [logoContent] } as Content] : []),
      ],
      columnGap: 16,
    },
    {
      columns: [
        { width: '*', stack: [sectionLabel(ctx, 'seller', accentText), ...partyLines(ctx, 'seller', party)] },
        { width: '*', stack: [sectionLabel(ctx, 'buyer', accentText), ...partyLines(ctx, 'buyer', party)] },
        { width: 185, stack: [metaTable(ctx, { labelColor: COLORS.muted, valueColor: COLORS.text, fontSize: 8.5, layout: plainLayout(6, 1.5) })] },
      ],
      columnGap: 18,
      margin: [0, 22, 0, 0],
    },
    ...bodySections(ctx, {
      table,
      breakdown: { ...table, headerFontSize: 7.5, bodyFontSize: 8, zebra: undefined },
      totals,
      text: textOptions(accentText, true),
      gap: 18,
    }),
  ]
  return {
    pageMargins: margins,
    defaultStyle: { fontSize: 8.5, color: COLORS.text },
    background: (_page: number, size: ContextPageSize) => ({ canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: 12, color: ctx.accent }] }),
    content,
    footer: footer(ctx, { marginX: margins[0], fontSize: 7, color: COLORS.muted }),
  }
}

function totalRowsGrand(ctx: DocContext): TotalRow {
  return totalRows(ctx).find((r) => r.grand)!
}

// ---------- minimal ----------

function minimal(ctx: DocContext): TemplateDefinition {
  const accentText = readableOnWhite(ctx.accent)
  const margins: Margins = [60, 60, 60, 70]
  const party = { nameSize: 9.5, fontSize: 8.5, color: COLORS.text, mutedColor: COLORS.muted }
  const logoContent = logo(ctx, [120, 44], 'right')
  const table: TableStyle = {
    layout: rulesLayout({ header: COLORS.text, rows: COLORS.hairline, width: 0.4, paddingY: 6 }),
    headerColor: COLORS.muted,
    headerSecondaryColor: COLORS.muted,
    headerFontSize: 7,
    bodyFontSize: 8.5,
    headerUppercase: true,
  }
  const totalsLayout = {
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === node.table.body.length - 1 ? 0.8 : 0),
    vLineWidth: () => 0,
    hLineColor: () => ctx.accent,
    paddingLeft: () => 0,
    paddingRight: () => 0,
    paddingTop: (i: number, node: { table: { body: unknown[] } }) => (i === node.table.body.length - 1 ? 6 : 2),
    paddingBottom: () => 2,
  }
  const content: Content[] = [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: ctx.title.toUpperCase(), fontSize: 9, characterSpacing: 2.5, color: accentText, bold: true },
            { text: ctx.invoice.number || '—', fontSize: 22, color: COLORS.text, margin: [0, 4, 0, 0] },
          ],
        },
        ...(logoContent ? [{ width: 'auto', stack: [logoContent] } as Content] : []),
      ],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 475, y2: 0, lineWidth: 0.4, lineColor: COLORS.rule }], margin: [0, 18, 0, 18] },
    {
      columns: [
        { width: '*', stack: [sectionLabel(ctx, 'seller', COLORS.muted, { fontSize: 7 }), ...partyLines(ctx, 'seller', party)] },
        { width: '*', stack: [sectionLabel(ctx, 'buyer', COLORS.muted, { fontSize: 7 }), ...partyLines(ctx, 'buyer', party)] },
        {
          width: 190,
          stack: [metaTable(ctx, { labelColor: COLORS.muted, valueColor: COLORS.text, fontSize: 8.5, layout: plainLayout(6, 1.5) }, metaRows(ctx).filter((r) => r.key !== 'number'))],
        },
      ],
      columnGap: 24,
    },
    ...bodySections(ctx, {
      table,
      breakdown: { ...table },
      totals: totalsTable(ctx, { fontSize: 8.5, grandFontSize: 13, color: COLORS.text, mutedColor: COLORS.muted, grandColor: accentText, layout: totalsLayout }),
      text: textOptions(COLORS.muted, true),
      gap: 26,
      totalsWidth: 210,
    }),
  ]
  return {
    pageMargins: margins,
    defaultStyle: { fontSize: 8.5, color: COLORS.text, lineHeight: 1.15 },
    content,
    footer: footer(ctx, { marginX: margins[0], fontSize: 6.5, color: COLORS.muted }),
  }
}

// ---------- bold ----------

const BOLD_HEADER_HEIGHT = 178

function bold(ctx: DocContext): TemplateDefinition {
  const accentText = readableOnWhite(ctx.accent)
  const margins: Margins = [44, 36, 44, 64]
  const on = ctx.onAccent
  const onMuted = on === COLORS.white ? tint(ctx.accent, 0.72) : shade(ctx.accent, 0.55)
  const party = { nameSize: 11, fontSize: 8.5, color: COLORS.text, mutedColor: COLORS.muted }
  const logoContent = logo(ctx, [130, 52], 'right')
  const grand = totalRowsGrand(ctx)
  const keyFigure = (key: LabelKey, value: string, size = 12): Content => ({
    stack: [
      { ...(label(ctx, key, { fontSize: 7.5, color: onMuted, secondaryColor: onMuted, bold: true, uppercase: true, characterSpacing: 0.6 }) as object) },
      { text: value, fontSize: size, bold: true, color: on, margin: [0, 2, 0, 0] },
    ],
  } as Content)
  const header: Content = {
    table: {
      widths: ['*'],
      heights: [BOLD_HEADER_HEIGHT - margins[1] - 18],
      body: [
        [
          {
            stack: [
              {
                columns: [
                  {
                    width: '*',
                    stack: [
                      { text: ctx.title.toUpperCase(), fontSize: ctx.titleParts[1] ? 24 : 32, bold: true, color: on, characterSpacing: 0.5 },
                      { text: ctx.invoice.number ? `${ctx.t('number')} ${ctx.invoice.number}` : '—', fontSize: 13, color: on, margin: [0, 2, 0, 0] },
                    ],
                  },
                  ...(logoContent
                    ? [{ width: 'auto', table: { body: [[{ stack: [logoContent], fillColor: COLORS.white }]] }, layout: plainLayout(6, 6) } as Content]
                    : []),
                ],
                columnGap: 16,
              },
              {
                columns: [
                  keyFigure('issueDate', ctx.date(ctx.invoice.issueDate)),
                  keyFigure('dueDate', ctx.date(ctx.invoice.dueDate)),
                  { ...(keyFigure(ctx.invoice.type === 'credit-note' ? 'amountCredited' : 'amountDue', grand.value, 16) as object), width: 'auto' } as unknown as Content,
                ],
                columnGap: 18,
                margin: [0, 18, 0, 0],
              },
            ],
          },
        ],
      ],
    },
    layout: plainLayout(0, 0),
  }
  const table: TableStyle = {
    layout: rulesLayout({ header: ctx.accent, rows: COLORS.hairline, width: 0.5, paddingY: 5, paddingX: 6 }),
    headerFill: shade(ctx.accent, 0.15),
    headerColor: contrastText(shade(ctx.accent, 0.15)),
    headerSecondaryColor: onMuted,
    headerFontSize: 8,
    bodyFontSize: 8.5,
    zebra: tint(ctx.accent, 0.93),
  }
  // Filled header cells need padding on the outer edges too.
  table.layout = { ...table.layout, paddingLeft: () => 6, paddingRight: () => 6 }
  const otherMeta = metaRows(ctx).filter((r) => !['number', 'issueDate', 'dueDate'].includes(r.key))
  const content: Content[] = [
    header,
    {
      columns: [
        { width: '*', stack: [sectionLabel(ctx, 'seller', accentText, { fontSize: 8 }), ...partyLines(ctx, 'seller', party)] },
        { width: '*', stack: [sectionLabel(ctx, 'buyer', accentText, { fontSize: 8 }), ...partyLines(ctx, 'buyer', party)] },
        ...(otherMeta.length
          ? [{ width: 185, stack: [metaTable(ctx, { labelColor: COLORS.muted, valueColor: COLORS.text, fontSize: 8.5, layout: plainLayout(6, 1.5) }, otherMeta)] } as Content]
          : []),
      ],
      columnGap: 18,
      margin: [0, 28, 0, 0],
    },
    ...bodySections(ctx, {
      table,
      breakdown: { ...table, zebra: undefined, headerFontSize: 7.5, bodyFontSize: 8 },
      totals: totalsTable(ctx, {
        fontSize: 9,
        grandFontSize: 16,
        color: COLORS.text,
        mutedColor: COLORS.muted,
        grandColor: on,
        grandFill: ctx.accent,
        layout: { ...plainLayout(8, 3), paddingLeft: () => 8, paddingRight: () => 8 },
      }),
      text: textOptions(accentText, true),
      gap: 20,
    }),
  ]
  return {
    pageMargins: margins,
    defaultStyle: { fontSize: 8.5, color: COLORS.text },
    background: (page: number, size: ContextPageSize) => ({
      canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: page === 1 ? BOLD_HEADER_HEIGHT : 8, color: ctx.accent }],
    }),
    content,
    footer: footer(ctx, { marginX: margins[0], fontSize: 7, color: COLORS.muted }),
  }
}

export const TEMPLATE_BUILDERS: Record<TemplateId, (ctx: DocContext) => TemplateDefinition> = { classic, modern, minimal, bold }
