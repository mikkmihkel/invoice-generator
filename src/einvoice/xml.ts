// Minimal XML builder. Elements without text and without children are dropped (Peppol R008: no empty elements).

export interface XmlElement {
  name: string
  attrs?: Record<string, string | undefined>
  children: XmlElement[]
  text?: string
}

export type XmlChild = XmlElement | null | undefined | false | '' | XmlChild[]

/** Characters not allowed in XML 1.0 (C0 controls except tab/LF/CR, lone surrogates, U+FFFE/FFFF). */
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function flatten(children: XmlChild[], out: XmlElement[] = []): XmlElement[] {
  for (const c of children) {
    if (Array.isArray(c)) flatten(c, out)
    else if (c) out.push(c)
  }
  return out
}

/** Element with child elements. */
export function el(name: string, attrs: Record<string, string | undefined> | null, ...children: XmlChild[]): XmlElement {
  return { name, attrs: attrs ?? undefined, children: flatten(children) }
}

/** Leaf element with text content. Returns null for empty/undefined values so it is omitted. */
export function leaf(name: string, value: string | number | undefined | null, attrs?: Record<string, string | undefined>): XmlElement | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (!text) return null
  return { name, attrs, children: [], text }
}

function isEmpty(e: XmlElement): boolean {
  return !e.text && e.children.every(isEmpty)
}

function attrString(attrs: Record<string, string | undefined> | undefined): string {
  if (!attrs) return ''
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${escapeXml(v!)}"`)
    .join('')
}

function write(e: XmlElement, depth: number, lines: string[]): void {
  const pad = '  '.repeat(depth)
  const open = `${e.name}${attrString(e.attrs)}`
  const children = e.children.filter((c) => !isEmpty(c))
  if (e.text !== undefined && e.text !== '') {
    lines.push(`${pad}<${open}>${escapeXml(e.text)}</${e.name}>`)
  } else {
    lines.push(`${pad}<${open}>`)
    for (const c of children) write(c, depth + 1, lines)
    lines.push(`${pad}</${e.name}>`)
  }
}

export function serialize(root: XmlElement): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>']
  write(root, 0, lines)
  return `${lines.join('\n')}\n`
}
