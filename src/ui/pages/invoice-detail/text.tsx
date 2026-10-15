import { Fragment, type ReactNode } from 'react'

/** Fill `{placeholders}` of an already translated sentence with React nodes (bold figures, links). */
export function interpolate(template: string, parts: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/g).map((piece, i) => {
    const m = /^\{(\w+)\}$/.exec(piece)
    return <Fragment key={i}>{m && m[1] in parts ? parts[m[1]] : piece}</Fragment>
  })
}

/** Amounts per currency joined with "+", e.g. "1 200,00 € + 50,00 $". */
export function joinSums(sums: Map<string, number>, format: (amount: number, currency: string) => string): string {
  if (sums.size === 0) return format(0, 'EUR')
  return [...sums.entries()].map(([cur, amt]) => format(amt, cur)).join(' + ')
}
