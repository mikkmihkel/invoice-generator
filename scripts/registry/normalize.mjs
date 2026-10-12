// Name normalisation shared by the index builder. MUST stay identical to src/registry/normalize.ts
// (a parity test in scripts/registry/build-index.test.mjs guards this).

/** Legal-form words that carry no search value ("OÜ", "Aktsiaselts", ...) — after normalisation. */
export const STOP_WORDS = new Set([
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
export function normalizeText(s) {
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

export function splitTokens(s) {
  const n = normalizeText(s)
  return n ? n.split(' ') : []
}

/** Searchable tokens of a company name: legal-form words removed (unless nothing else is left). */
export function nameTokens(name) {
  const all = splitTokens(name)
  const kept = all.filter((t) => !STOP_WORDS.has(t))
  return kept.length ? kept : all
}
