// Name normalisation for registry search. MUST stay identical to scripts/registry/normalize.mjs
// (the index is built with that one; a parity test guards both).

/** Legal-form words that carry no search value ("OÜ", "Aktsiaselts", ...) — after normalisation. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'ou', 'osauhing',
  'as', 'aktsiaselts',
  'mtu', 'mittetulundusuhing',
  'sa', 'sihtasutus',
  'tu', 'taisuhing',
  'uu', 'usaldusuhing',
  'fie',
  'tulundusuhistu',
  'ku', 'korteriuhistu',
])

/** Lowercase, fold diacritics (õ→o, š→s, ...), drop apostrophes, everything else non-alphanumeric → space. */
export function normalizeText(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function splitTokens(s: string | null | undefined): string[] {
  const n = normalizeText(s)
  return n ? n.split(' ') : []
}

/** Searchable tokens of a company name: legal-form words removed (unless nothing else is left). */
export function nameTokens(name: string): string[] {
  const all = splitTokens(name)
  const kept = all.filter((t) => !STOP_WORDS.has(t))
  return kept.length ? kept : all
}

/**
 * Tokens of a user query. Legal-form words are dropped ("telia as" → ["telia"]) unless the query
 * consists only of such words — then the last one is kept as a prefix ("as" may be the start of "Asko").
 */
export function queryTokens(q: string): string[] {
  const all = splitTokens(q)
  if (!all.length) return []
  const kept = all.filter((t) => !STOP_WORDS.has(t))
  const tokens = kept.length ? kept : [all[all.length - 1]]
  return [...new Set(tokens)]
}
