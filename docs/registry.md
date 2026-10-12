# e-Business Register (Äriregister) lookup

Users look up their own company and their clients by name or registry code. The app is a static
GitHub Pages site, so it cannot rely on RIK's contract-based APIs. Lookups use two sources:

1. **Bundled static index** (primary). Built in CI from RIK open data and served from `registry/`
   next to the app.
2. **Live autocomplete** (optional, `opts.live`, setting `registryLiveLookup`). This is the public
   JSON endpoint behind the ariregister.rik.ee search box. Any failure is ignored silently.

Public API: `src/registry/index.ts`, which exports `searchCompanies`, `getCompanyByCode`,
`getIndexInfo`, `REGISTRY_ATTRIBUTION` and `resetRegistryCache` (for tests). These functions never
throw. A missing index, a network or CORS error, or an abort makes them return `[]` or `null`.

## Data source and licence

| | |
|---|---|
| Dataset | e-äriregistri avaandmed, "lihtandmed" (basic data), `ettevotja_rekvisiidid__lihtandmed.csv.zip` |
| URL | `https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__lihtandmed.csv.zip` (the env var `REGISTRY_SOURCE_URL` overrides it) |
| Publisher | Registrite ja Infosüsteemide Keskus (RIK), the Centre of Registers and Information Systems |
| Updates | daily. CI rebuilds the index on every push to `main` and every Monday (see `.github/workflows/deploy.yml`) |
| Size | about 18.5 MB zipped and 90 MB of CSV. About 378k entities (2026-09: R 368k, L 8.7k, N 0.7k) |
| Licence | **CC BY 4.0**. Reuse is allowed, including commercial reuse, as long as the source is attributed |

**The UI must show the attribution** wherever register data is offered, for example under the search
results or in Settings → About:

> Andmed: e-äriregister, Registrite ja Infosüsteemide Keskus (RIK), avaandmed litsentsiga CC BY 4.0
> Data: Estonian e-Business Register, Centre of Registers and Information Systems (RIK), open data under CC BY 4.0

Use `REGISTRY_ATTRIBUTION.et` or `.en` for the text, and link to `REGISTRY_ATTRIBUTION.sourceUrl` and
`.licenceUrl`. `getIndexInfo()` also returns `builtAt`, `dataDate`, `count` and `attribution`, so the UI
can say how fresh the data is, for example "Äriregistri andmed seisuga 12.10.2026".

### CSV format

The file is UTF-8 with a BOM and uses `;` as the separator. Its columns, in order:

`nimi; ariregistri_kood; ettevotja_oiguslik_vorm; ettevotja_oigusliku_vormi_alaliik; kmkr_nr;
ettevotja_staatus; ettevotja_staatus_tekstina; ettevotja_esmakande_kpv; ettevotja_aadress;
asukoht_ettevotja_aadressis; asukoha_ehak_kood; asukoha_ehak_tekstina; indeks_ettevotja_aadressis;
ads_adr_id; ads_ads_oid; ads_normaliseeritud_taisaadress; teabesysteemi_link`

- The legal form is written in full (`Osaühing`, `Aktsiaselts`, `Füüsilisest isikust ettevõtja`, ...).
  It is mapped to OÜ / AS / FIE / MTÜ / SA / TÜ / UÜ / KÜ / SE / filiaal, and unknown forms are kept as
  they are.
- `kmkr_nr` is the VAT number, for example `EE101234567`. It is empty when the entity is not VAT registered.
- `ettevotja_staatus` is R (registrisse kantud), L (likvideerimisel), N (pankrotis) or K (kustutatud).
  The index keeps R, L and N and drops K. The current file seems to contain no K rows anyway.
- The address is `asukoht_ettevotja_aadressis` (street), `asukoha_ehak_tekstina`
  ("Kesklinna linnaosa, Tallinn, Harju maakond") and `indeks_ettevotja_aadressis` (postal code).
  `ads_normaliseeritud_taisaadress` is used only when the EHAK text is missing.
- The parser runs with `quote: false`, because names such as `"Kuldne Kala" OÜ` contain bare quotes
  and fields never contain `;`. Fields that are fully RFC-quoted are still unwrapped.
- Columns are matched by header name. If the names change, the parser falls back to column positions
  and prints a warning. If the downloaded file yields fewer than 1000 companies, the build fails.

### Address mapping (`src/registry/address.ts`)

| Register data | `Address` |
|---|---|
| street column | `street` ("Narva mnt 5-12") |
| EHAK text without county | `city`. Districts (linnaosa) are dropped, and a single "X linn" becomes "X": "Tallinn", "Tartu", "Keila". Rural places stay as they are: "Linaküla, Kihnu vald", "Abja-Paluoja linn, Mulgi vald" |
| "… maakond" | `county` |
| postal code | `postalCode` |
| always | `country: 'EE'` |

`addressText` follows the usual Estonian order, for example
"Peetri tn 5, Kesklinna linnaosa, Tallinn, 10111 Harju maakond". Some entities have neither EHAK nor ADS
data. These are usually foreign branches with foreign addresses. For them, `address` is left
**undefined** and only `addressText` is set, because the country cannot be known.

## Static index format (`public/registry/`, gitignored and copied to `dist/` by Vite)

```
meta.json            {version:1, builtAt, dataDate, count, source, sourceUrl, licence, licenceUrl,
                      attribution, recordShardDigits:5, stats, shards:{<key>: 0 leaf | 1 split}}
n/<key>.json         name shards: {t:{token:[posting…]}, x?:[truncated tokens], s?:[top postings]}
r/<5 digits>.json    record shards: {"<code>":[name, legalForm, vat, status, street, ehakText, postal, ads?]}
posting = [code:number, name, status?]   (status is omitted when 'R')
```

**Normalisation.** The code is in `scripts/registry/normalize.mjs`, and `src/registry/normalize.ts` is a
copy of it. A test checks that the two stay identical. Text is lowercased, diacritics are folded (õ→o,
ä→a, š→s, ...), apostrophes are dropped, and every other non-alphanumeric character becomes a space.
Legal-form words are removed from names: oü, osaühing, as, aktsiaselts, mtü, sa, tü, uü, fie,
korteriühistu and similar. Each remaining name token gets one posting.

**Name shards form a prefix tree.** A token belongs to the longest shard key that is its prefix. The
root keys are single characters. A shard with more than `shardMax` (4000) postings is split by the next
character. Tokens equal to the key stay in the parent shard. The parent also keeps a `s` list with the
200 best postings for that whole prefix, which answers short queries such as "k". Postings for one
token are sorted with first-word matches first, then active entities, then shorter names. A token with
more than `maxPostings` (2500) postings, such as "kinnisvara", "eesti" or "holding", is truncated to its
best postings and listed in `x`. **Every query word therefore needs exactly one name shard.**

**Records** are split into shards by the first 5 digits of the registry code. Each shard holds about
50 companies and is about 2 KB gzipped. One shard answers `getCompanyByCode`, and the same shard also
serves code-prefix queries of 5 to 7 digits.

### Search algorithm (`src/registry/staticIndex.ts` and `index.ts`)

1. An 8-digit query (spaces allowed) is an exact code lookup in one record shard.
2. Otherwise the query is split into tokens, and legal-form words are dropped ("telia as" → `telia`).
   The client loads the shard for each token in parallel and collects the postings whose token starts
   with that query token.
3. **AND matching** starts from the smallest *complete* posting list. Every other query word must
   prefix-match some word of the posting's name. This works even when another word's list was
   truncated.
4. Ranking: exact normalised name first, then names that start with the query (or, for 5 to 7 digit
   queries, a code prefix match), then names whose first word matches. Within each group, R comes
   before L and N, then shorter names, then `localeCompare('et')`.
5. Full records are fetched only for the top `limit` results, at most 10 small record shards.
6. Meta and shards are cached in memory, with an LRU of 400 files. Shard URLs carry `?v=<builtAt>` so
   that a rebuild busts browser caches, and `meta.json` is fetched with `cache: 'no-cache'`. Aborting a
   search does not cancel shared shard downloads. They still fill the cache for the next keystroke.

Searching by VAT number is not supported, because the index has no VAT-number index.

### Sizes

Measured on a synthetic set of 378k rows with realistic name and address lengths. The real data has
a wider vocabulary, so expect more and smaller name shards.

| | files | raw | gzip |
|---|---|---|---|
| name shards | ~600–2000 | ~16 MB | ~4.6 MB (median 8 KB, max ~31 KB per file) |
| record shards | ~7000 | ~44 MB | ~13 MB (~2 KB per file) |
| total | ~8–9k | **~60 MB** | ~17 MB |

A typical first query fetches `meta.json` (about 2 KB gzipped), 1 to 3 name shards (8–31 KB) and up to
10 record shards (about 2 KB each), so **roughly 20–80 KB in total, with a worst case of about 120 KB**.
After that, the in-memory cache serves most of the repeated keystrokes. The build takes about 10 s.

## Live layer (`src/registry/live.ts`)

`GET https://ariregister.rik.ee/est/api/autocomplete?q=<text>&results=<n>` returns
`{status:"OK", data:[{company_id, reg_code, name, historical_names, status, legal_address, zip_code, legal_form, url}]}`.
`legal_address` is an ADS full address ("Harju maakond, Tallinn, Kristiine linnaosa, Mustamäe tee 3").
`legal_form` is a numeric code, and only `1`=AS and `5`=OÜ are known, so the form is guessed from the
name first. The response has **no VAT number**.

- The request is a simple GET with no custom headers and no credentials, which avoids a CORS preflight.
  It times out after 3 s, and the caller's `AbortSignal` is honoured. Errors, non-2xx responses and
  malformed JSON all give `[]`. Status K results are dropped.
- Live hits are merged with index results by registry code and ranked together. When the index also
  has the company, the index record is kept (it carries the VAT number and a structured address), and
  the fresher name and status from the live hit are applied to it. Companies registered after the last
  index build come only from the live API.
- `getCompanyByCode(code, {live: true})` asks the live API only when the index does not have the code.
- **Will it work from a browser?** Probably, but this is unverified: the sandbox cannot reach rik.ee.
  The endpoint is undocumented, but several public browser apps call it directly from client-side code
  (for example Tuleva's onboarding client), which suggests it sends permissive CORS headers. It is not
  a contractual API and may change or rate-limit without notice. This is why it is opt-in and silent on
  failure.

## Commands

```bash
npm run registry:build                         # download from RIK → public/registry (used in CI)
REGISTRY_SOURCE_URL=https://… npm run registry:build
node scripts/registry/build-index.mjs --input path/to/lihtandmed.csv[.zip]   # offline
node scripts/registry/build-index.mjs --input scripts/registry/fixtures/lihtandmed.csv   # 15-company demo index for e2e
node scripts/registry/build-index.mjs --help
npx vitest run scripts/registry src/registry
```

The fixture `scripts/registry/fixtures/lihtandmed.csv` is synthetic, although its registry codes have
valid check digits. It covers diacritics, every status, several legal forms, a quoted name, a foreign
address and a row with only an ADS address. Remove the demo index with
`rm -rf public/registry/{n,r,meta.json}`.
