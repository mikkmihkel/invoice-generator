# Arvegeneraator · Estonian invoice generator

A simple, private invoicing tool for Estonian micro-companies. It runs entirely in the browser and is hosted for free on GitHub Pages, with no server and no account.

- **Find companies in the e-Business Register (Äriregister).** Search by name or registry code to fill in your own company and your clients: name, registry code, VAT number (KMKR) and address.
- **Legally complete invoices.** Every invoice is checked against the Estonian VAT Act (KMS § 37), the Accounting Act (RPS § 7) and the Commercial Code (ÄS § 15) before it can be issued. Each problem is shown with its legal reference. See [docs/legal-requirements.md](docs/legal-requirements.md).
- **VAT schemes:**
  - domestic VAT (24 / 13 / 9 / 0 %)
  - not VAT-registered
  - EU services (reverse charge)
  - intra-Community supply of goods
  - export of goods
  - services to non-EU customers
  - exempt supplies (KMS § 16)
  - domestic reverse charge (KMS § 41¹)
- **Invoice types:** invoice, credit note (kreeditarve) and prepayment invoice.
- **Numbering and payment details:** sequential numbering (`{YYYY}-0001`), automatic reference numbers (viitenumber, 7-3-1 check digit) and late interest (viivis).
- **4 PDF styles:** Classic, Modern, Minimal and Bold. Each takes your logo and accent colour, and can be printed in Estonian, English or both (bilingual).
- **Export:**
  - PDF download / print
  - email: Gmail with the PDF attached, the device share sheet, or your email app
  - save to Google Drive
  - e-invoice XML (EN 16931 / Peppol BIS Billing 3.0) to upload to your e-invoice operator
- **Your data stays in your browser** (IndexedDB). Back it up to a JSON file or Google Drive, and restore it on another computer.
- Estonian and English interface, light and dark mode, works on mobile.

> This tool helps you produce correct invoices but is not legal or tax advice. Invoices must be kept for 7 years (RPS § 12), so back up regularly.

## Using it

Open the published site, e.g. `https://<github-user>.github.io/invoice-generator/`.

1. **First run:** search for your company in the register (or enter it manually), then add your IBAN, logo and invoice defaults.
2. **Invoices → New invoice:** pick or search a client, add lines and choose a VAT scheme and style. The live preview and the legal checklist update as you type.
3. **Issue:** this assigns the next number and locks the invoice. Corrections are made with a credit note.
4. **Send:** download the PDF, email it, save it to Drive, or download the e-invoice XML.

Google Drive and Gmail need a free Google OAuth client ID that you create once. See [docs/google-setup.md](docs/google-setup.md). Everything else works without it.

## Business register data

The search index is built from the **RIK open data** file (`ettevotja_rekvisiidid__lihtandmed.csv.zip`, CC BY 4.0) by `scripts/registry/build-index.mjs`. The build runs in GitHub Actions on every deploy and weekly on Mondays. The index is published as small static JSON shards, so a search downloads only a few dozen KB. The app can also query RIK's public autocomplete endpoint live (Settings → Register). Details: [docs/registry.md](docs/registry.md).

Data: Estonian e-Business Register, Centre of Registers and Information Systems (RIK), open data under CC BY 4.0.

## Deploying to GitHub Pages

1. In the repository, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main`. The `Build & deploy to GitHub Pages` workflow (`.github/workflows/deploy.yml`) runs lint and tests, builds the register index, builds the site and deploys it.
3. The workflow also re-runs weekly to refresh register data. You can start it manually from the Actions tab.

If the register download fails, the site still deploys. Search then uses live lookup, and you can always enter companies by hand.

## Development

Requires Node 22+.

```bash
npm install
npm run dev                # http://localhost:5173
npm test                   # Vitest unit + component tests
npm run lint
npm run build              # type-check + production build into dist/

# Optional: local demo register index from the bundled fixture (15 fake companies)
node scripts/registry/build-index.mjs --input scripts/registry/fixtures/lihtandmed.csv
# or the real data (downloads ~19 MB from RIK)
npm run registry:build
```

### Project layout

| Path | What |
|---|---|
| `src/domain/` | Data model (`types.ts`), VAT calculation in integer cents, Estonian law rules, validation, numbering |
| `src/storage/` | IndexedDB repository, atomic invoice issuing, JSON backup and restore, cross-tab change events |
| `src/registry/` | Register search over the static index, plus the optional live API |
| `src/pdf/` | pdfmake document definitions and the 4 templates (lazy-loaded) |
| `src/einvoice/` | UBL 2.1 / Peppol BIS 3 XML |
| `src/integrations/` | Google Identity Services, Drive, Gmail (MIME builder), Web Share, mailto |
| `src/ui/` | React screens, Estonian/English UI strings |
| `scripts/registry/` | Builds the open-data search index |
| `docs/` | Legal checklist, register index format, Google setup, team brief |

## Privacy

There is no backend. Company, client and invoice data never leave your browser unless you export them: download, email, Drive or an e-invoice operator. Google access tokens are kept only in memory. The app can request the `drive.file` scope (it sees only files it created) and the `gmail.send` scope (send only, it cannot read your mail).
