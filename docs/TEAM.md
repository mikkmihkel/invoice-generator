# Team brief — Estonian invoice generator

## Product
A static web app (GitHub Pages, no backend) for a micro-company owner who issues invoices occasionally.
- Look up **own company** and **clients** from the Estonian e-Business Register (Äriregister / RIK).
- Create invoices that contain **everything Estonian law requires** (KMS § 37, RPS § 7, ÄS business-document rules).
- Several visual **styles** (templates), invoice language ET / EN / bilingual.
- Export: **PDF download**, **email** (Gmail API with attachment; Web Share; mailto fallback), **save to Google Drive**, e-invoice XML (EN 16931 / Peppol BIS 3 UBL).
- All data stored **in the browser** (IndexedDB), with JSON backup/restore (file + Google Drive).

## Stack
Vite 8 + React 19 + TypeScript (strict-ish), `idb` for IndexedDB, `pdfmake` 0.3 for PDFs, Vitest + jsdom + fake-indexeddb for tests.
HashRouter (Pages has no rewrites). `base: './'` — fetch static files via `import.meta.env.BASE_URL`.

## Module ownership (edit ONLY your area)
| Area | Owner | Paths |
|---|---|---|
| Domain model, calculations, Estonian law rules, validation, numbering, factories | domain agent | `src/domain/**` (except `types.ts` — see below), `docs/legal-requirements.md` |
| Storage (IndexedDB repo, backup) + Google/Share/email integrations | platform agent | `src/storage/**`, `src/integrations/**`, `docs/google-setup.md` |
| Business register index build + client search | registry agent | `scripts/registry/**`, `src/registry/**`, `docs/registry.md` |
| PDF templates + e-invoice XML | documents agent | `src/pdf/**`, `src/einvoice/**` |
| UI (all screens, styles, i18n of UI) | UI agent | `src/ui/**`, `src/App.tsx`, `src/main.tsx`, `src/index.css`, `index.html`, `public/favicon.svg` |
| Integration, workflows, README, package.json | lead | everything else |

## Contracts
- `src/domain/types.ts` is the shared model. Do not make breaking changes. If you truly need something,
  make the smallest **additive, optional** change and call it out in your final report.
- Each module's `index.ts` already declares its public API as stubs. Implement those signatures.
  You may add exports / optional params; don't rename or remove.
- Other modules are being implemented **concurrently**. If you depend on one that still throws
  `not implemented`, code against its signature and use `vi.mock` in your tests.

## Rules
- Do **not** run `npm install` / change `package.json` (concurrent installs corrupt the lockfile). If you need a
  package, say so in your report and work around it. Already installed: react, react-dom, react-router-dom, idb, pdfmake,
  @types/pdfmake, vitest, jsdom, fake-indexeddb, @testing-library/react, @testing-library/jest-dom, csv-parse.
- Do **not** `git commit`, `git push`, `git stash`, `git checkout` or reset — the lead commits.
- Tests: colocated `*.test.ts(x)`; run `npx vitest run <your paths>`. Typecheck with `npx tsc -b` (ignore errors in other owners' files).
- Network: this sandbox **cannot reach rik.ee** (proxy policy) — use WebSearch/WebFetch for research; npm registry works.
- Code style: TypeScript, 2-space indent, no semicolons, single quotes (match existing files). Keep comments sparse and useful.
- Final report: what you built, public API notes, anything the lead/other agents must know, any contract changes, open issues.
