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
- **Invoice types:** invoice, credit note (kreeditarve), prepayment invoice and quote (hinnapakkumine). An accepted quote becomes an invoice in one click.
- **Numbering:** sequential numbers with date placeholders (`{YYYY}`, `{YY}`, `{MM}`, `{DD}`, `{YYYYMMDD}`) that restart yearly, monthly or daily, e.g. `2026-0001` or `20261015001`. Quotes have their own series. Reference numbers (viitenumber, 7-3-1 check digit) are generated automatically.
- **Recurring invoices:** monthly, quarterly or yearly. The next draft is prepared when you open the app; nothing is issued without you.
- **Products and services catalogue:** saved items and each client's last prices are suggested while you type an invoice line.
- **Payments:** mark an invoice paid in one click (with undo), cancel it with a credit note in one step, and send reminders that show the late interest (viivis) to date. Each invoice keeps a log of when it was sent and reminded.
- **Exchange rates and VAT numbers:** fetch the ECB reference rate for foreign-currency invoices and check EU VAT numbers in VIES.
- **6 PDF styles:** Standard, Classic, Modern, Minimal, Bold and Compact, with your logo and brand colours, in Estonian, English or both (bilingual). Issued PDFs carry the e-invoice XML inside and can show a payment QR code.
- **Export:**
  - PDF download / print
  - email: Gmail with the PDF attached, the device share sheet, or your email app
  - save to Google Drive
  - e-invoice XML (EN 16931 / Peppol BIS Billing 3.0) to upload to your e-invoice operator
- **Export for the accountant:** a period's invoices as CSV, or a ZIP with the CSV, every PDF and every e-invoice XML.
- **Your data stays in your browser** (IndexedDB). Back it up to a JSON file, or turn on automatic versioned backups to Google Drive, optionally encrypted with a passphrase, and restore them on another computer.
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
| `src/pdf/` | pdfmake document definitions and the 6 templates (lazy-loaded), PDF metadata and payment QR |
| `src/einvoice/` | UBL 2.1 / Peppol BIS 3 XML |
| `src/integrations/` | Google Identity Services, Drive (incl. automatic encrypted backup), Gmail (MIME builder), Web Share, mailto, ECB rates, VIES |
| `src/export/` | Accountant export: CSV and ZIP writer |
| `src/ui/` | React screens, Estonian/English UI strings |
| `scripts/registry/` | Builds the open-data search index |
| `docs/` | Legal checklist, register index format, Google setup, machine-readable invoice layer |

## Privacy and security

- **No backend.** Company, client and invoice data stay in your browser unless you export them: download, email, Google Drive or an e-invoice operator.
- **Register live lookup** (on by default, Settings → Register): your search text is sent to the Estonian e-Business Register (`ariregister.rik.ee`). Turn it off to search only the bundled index.
- **Exchange rates and VAT number checks** are sent only when you press the button: the currency and date go to the ECB (`data-api.ecb.europa.eu`), the buyer's VAT number to the European Commission's VIES service (`ec.europa.eu`).
- **Encrypted backups** use AES-GCM with a key derived from your passphrase (PBKDF2-SHA-256). The passphrase is kept in memory only; without it an encrypted backup cannot be restored.
- **Google:** access tokens are kept in memory only. The app requests `drive.file` (it sees only files it created) and `gmail.send` (send only, it cannot read your mail).
- **Content Security Policy:** the production build only allows scripts from the site itself and Google Identity Services, and only allows connections to RIK, Google APIs, the ECB and VIES.
- **Backups are untrusted input:** imports are validated field by field. Logos must be embedded PNG/JPEG images and colours plain hex values, and bank details that would change need confirming.
- **CI:** GitHub Actions are pinned to commit SHAs, with least-privilege permissions and `npm ci --ignore-scripts`. CodeQL and Dependabot are also set up.

## Third-party notices

- Register data: Estonian e-Business Register, RIK, open data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- PDF fonts: [IBM Plex Sans and IBM Plex Mono](https://github.com/IBM/plex), SIL Open Font License 1.1 (Reserved Font Name "Plex"). They are embedded in the generated PDFs. Licence: [`public/licenses/IBM-Plex-OFL-1.1.txt`](public/licenses/IBM-Plex-OFL-1.1.txt), also served at `licenses/IBM-Plex-OFL-1.1.txt` on the site.
- PDF generation: [pdfmake](https://github.com/bpampuch/pdfmake) (MIT).
- PDF page previews: [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`), Apache License 2.0. Licence: [`public/licenses/pdf.js-Apache-2.0.txt`](public/licenses/pdf.js-Apache-2.0.txt).
- Icons: [Phosphor Icons](https://github.com/phosphor-icons/react) (MIT).
