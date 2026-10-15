import { describe, expect, it } from 'vitest'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import type { ColorMode, TemplateId } from '../domain/types'
import { MONO } from './context'
import { buildDocDefinition } from './docDefinition'
import { sampleInvoice } from './testFixtures'

const PAGE = { width: 595.28, height: 841.89, orientation: 'portrait' as const }
const templates: TemplateId[] = ['standard', 'classic', 'modern', 'minimal', 'bold', 'compact']
const PRIMARY = '#0b5d7a'
const SECONDARY = '#e07a10'

type Node = Record<string, unknown>
type Layout = { hLineColor?: (i: number, node: unknown) => string; vLineColor?: (i: number, node: unknown) => string }

/** Every colour pdfmake will paint: text/fill/line/QR colours, table rule colours and backgrounds. */
function paintedColors(def: TDocumentDefinitions): string[] {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const o = node as Node
    for (const key of ['color', 'fillColor', 'lineColor', 'foreground']) if (typeof o[key] === 'string') out.push((o[key] as string).toLowerCase())
    const layout = o.layout as Layout | undefined
    const table = o.table as { body?: unknown[] } | undefined
    if (layout && typeof layout === 'object' && table?.body) {
      for (let i = 0; i <= table.body.length; i++) {
        if (layout.hLineColor) out.push(layout.hLineColor(i, o).toLowerCase())
        if (layout.vLineColor) out.push(layout.vLineColor(i, o).toLowerCase())
      }
    }
    for (const v of Object.values(o)) if (typeof v === 'object') walk(v)
  }
  walk(def.content)
  for (const page of [1, 2]) {
    if (typeof def.background === 'function') walk(def.background(page, PAGE))
    if (typeof def.header === 'function') walk(def.header(page, 2, PAGE))
    if (typeof def.footer === 'function') walk(def.footer(page, 2, PAGE))
  }
  return out
}

function backgroundColors(def: TDocumentDefinitions): string[] {
  if (typeof def.background !== 'function') return []
  return paintedColors({ content: [def.background(1, PAGE)] } as TDocumentDefinitions)
}

/** Visible text in reading order, without styling: colour modes must never change it. */
function textOnly(def: TDocumentDefinitions): string {
  return JSON.stringify(def.content, (k, v) => (['color', 'fillColor', 'lineColor', 'foreground', 'layout', 'canvas'].includes(k) ? undefined : v))
}

function hexChannels(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** Neutral = grey-ish: channel spread stays small (the shared greys have a slight cool cast). */
const isNeutral = (hex: string) => {
  const c = hexChannels(hex)
  return Math.max(...c) - Math.min(...c) <= 24
}

const build = (templateId: TemplateId, colorMode?: ColorMode, extra: Partial<Parameters<typeof sampleInvoice>[0]> = {}) =>
  buildDocDefinition(sampleInvoice({ templateId, accentColor: PRIMARY, secondaryColor: SECONDARY, ...(colorMode ? { colorMode } : {}), ...extra }))

describe('colour modes', () => {
  for (const templateId of templates) {
    describe(templateId, () => {
      it('accent (default) uses the primary colour and ignores the secondary', () => {
        const colors = paintedColors(build(templateId))
        expect(colors).toContain(PRIMARY)
        expect(colors).not.toContain(SECONDARY)
        expect(textOnly(build(templateId, 'accent'))).toBe(textOnly(build(templateId)))
        expect(paintedColors(build(templateId, 'accent'))).toEqual(colors)
      })

      it('mono paints only neutral inks and greys', () => {
        const colors = paintedColors(build(templateId, 'mono'))
        expect(colors.filter((c) => !isNeutral(c))).toEqual([])
        expect(colors).not.toContain(PRIMARY)
      })

      it('duo uses both brand colours', () => {
        const colors = paintedColors(build(templateId, 'duo'))
        const accent = new Set(paintedColors(build(templateId)))
        expect(colors).toContain(PRIMARY)
        // The primary is a cool blue, so warm colours can only come from the (orange) secondary or its tints.
        const warm = colors.filter((c) => !accent.has(c) && hexChannels(c)[0] > hexChannels(c)[2] + 8)
        expect(warm.length).toBeGreaterThan(0)
      })

      it('never changes the text in any mode', () => {
        const base = textOnly(build(templateId))
        expect(textOnly(build(templateId, 'mono'))).toBe(base)
        expect(textOnly(build(templateId, 'duo'))).toBe(base)
      })

      it('sanitises colours: hex only, invalid secondary falls back to the primary', () => {
        const hostile = 'url(https://evil.example/x.png)'
        const def = build(templateId, 'duo', { secondaryColor: hostile })
        const json = JSON.stringify(def)
        expect(json).not.toContain('evil.example')
        expect(paintedColors(def).every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
        expect(paintedColors(def)).toEqual(paintedColors(build(templateId, 'accent')))
        expect(paintedColors(build(templateId, 'rainbow' as ColorMode))).toEqual(paintedColors(build(templateId)))
      })
    })
  }

  it('modern: band in the primary colour, labels and rules in the secondary', () => {
    expect(backgroundColors(build('modern', 'duo'))).toEqual([PRIMARY])
    expect(backgroundColors(build('modern', 'mono'))).toEqual([MONO.ink])
  })

  it('bold: amount block in the primary colour, left bar in the secondary', () => {
    const def = build('bold', 'duo')
    expect(backgroundColors(def)).toEqual([SECONDARY])
    expect(paintedColors({ content: def.content } as TDocumentDefinitions)).toContain(PRIMARY)
  })

  it('compact: header row filled with the primary colour in duo', () => {
    const fills: string[] = []
    JSON.stringify(build('compact', 'duo').content, (k, v) => {
      if (k === 'fillColor' && typeof v === 'string') fills.push(v)
      return v
    })
    expect(fills).toContain(PRIMARY)
  })
})
