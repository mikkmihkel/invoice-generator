# Estonian invoice requirements (status: October 2026)

The rules are implemented in `src/domain/` (`law.ts`, `validation.ts`, `calc.ts`, `numbering.ts`).
This is a summary for building the product. It is not legal advice.

> **How this was researched.** The sandbox could not open riigiteataja.ee, emta.ee or rik.ee directly (the proxy
> blocks them). Everything below comes from web search results that quote those sites, plus EMTA guidance pages and
> professional commentary (KPMG, EY, Fonoa, Pangaliit, python-stdnum). When the exact paragraph, subsection (lõige)
> or clause (punkt) could not be confirmed against the consolidated act, this document says so (marked **⚠ unverified**).
> Check the marked items against the current texts on Riigi Teataja before anyone relies on them for legal purposes.

## 1. Applicable law

| Act | Abbr. | What matters for invoices | Consolidated text |
|---|---|---|---|
| Käibemaksuseadus (Value-Added Tax Act) | KMS | § 37: invoice duty, mandatory data (lg 7), mandatory references/notes (lg 8, 8¹), credit notes (lg 4); § 15 (0% rate); § 16 (exemptions); § 10 (place of supply of services); § 41¹ (domestic reverse charge) | [riigiteataja.ee/akt/130122025021](https://www.riigiteataja.ee/akt/130122025021) · [EN translation](https://www.riigiteataja.ee/en/eli/527022014003/consolide) (older version) |
| Raamatupidamise seadus (Accounting Act) | RPS | § 7: source-document (algdokument) content. Applies to **every** accounting entity, including sellers not registered for VAT. § 7¹: e-invoices. § 12: retention | [riigiteataja.ee/akt/110072025003](https://www.riigiteataja.ee/akt/110072025003) |
| Äriseadustik (Commercial Code) | ÄS | § 15: business name, registered office (asukoht) and registry code on business documents and on the website | [riigiteataja.ee/akt/131122010019?leiaKehtiv](https://riigiteataja.ee/akt/131122010019?leiaKehtiv=) |
| Council Directive 2006/112/EC | VAT Dir. | Art. 226 (invoice content), 219 (amending documents), 44/196 (B2B services, reverse charge), 138 (intra-Community supply), 146 (export), 203 (VAT shown on an invoice is payable) | EUR-Lex |

## 2. VAT rates in 2026

| Rate | Applies to | Since | Status |
|---|---|---|---|
| **24%** | Standard rate | 1 July 2025 (was 22%) | **Permanent.** The 2024 law made the rise temporary until the end of 2028, with a fall back to 22% from 1 January 2029. The law that abolished the security tax (adopted in May 2025) cancelled that fall, so 24% now applies with no end date ([KPMG, June 2025](https://kpmg.com/ee/et/insights/2025/06/infokuller-juuni-2025.html); [EY](https://www.ey.com/en_gl/technical/tax-alerts/estonia-abolishes-temporary-defense-tax-increases-several-tax-rates)) |
| **13%** | Accommodation (incl. with breakfast) | 1 January 2025 (was 9%) | In force ([Fonoa](https://www.fonoa.com/resources/blog/estonia-increases-vat-rates), [Erply](https://wiki.erply.com/article/2343-vat-rate-changes-in-estonia-from-1-january-2025)) |
| **9%** | Books and educational materials, medicines and medical devices for disabled people, press publications | Press: 1 January 2025 (was 5%) | In force |
| **0%** | Intra-Community supply of goods, export and other KMS § 15 supplies | — | In force |

**Scheduled changes for 2026/2027:** none were found.
- The Riigikogu rejected a citizens' initiative to cut VAT on food on 9 March 2026.
- The Centre Party has tabled bills to cut VAT on basic foods to 13%: 885 SE on 13 April 2026 and 956 SE on 16 June 2026. The government (7 May 2026) and the Ministry of Finance (8 July 2026) did not support them. No adoption was found as of October 2026 ([ERR](https://www.err.ee/1609883530/riigikogu-ei-toetanud-toiduainete-kaibemaksu-langetamist)).
- The coalition agreement leaves any further tax changes to the government formed after the 2027 Riigikogu election.

`ESTONIAN_VAT_RATES = [24, 13, 9, 0]`, and `STANDARD_VAT_RATE = 24` is the profile's default line rate. On a domestic invoice:
- The rates 22%, 20% and 5% are accepted with a **warning**. They are meant only for corrections of earlier supplies.
- Any other rate is an **error**.

## 3. Checklist: legal requirement → invoice field → enforcement

Severity: **E** = error (blocks `canIssue`), **W** = warning (shown, does not block), **calc** = handled by
`computeTotals`, **note** = printed text from `vatSchemeNote()`, **auto** = filled in by the app.

### 3.1 Mandatory invoice data — KMS § 37 lg 7 (sellers registered for VAT)

The list in § 37 lg 7 is confirmed by EMTA ("arvele märgitavad andmed"). The clause numbers (p 1…p 10) follow the
order used in EMTA's guidance and secondary sources. **⚠ Check the clause numbering** against the consolidated act.

| # | Requirement | Legal basis | Model field | How the app enforces it |
|---|---|---|---|---|
| 1 | Invoice serial number, unique and sequential | KMS § 37 lg 7 p 1; RPS § 7 | `Invoice.number` | **E** if empty. Pass `validateInvoice(inv, { requireNumber: false })` for drafts that get their number when issued. Generated by `formatInvoiceNumber` (`{YYYY}-0001`). Storage must allocate numbers so they are never duplicated |
| 2 | Date of issue | KMS § 37 lg 7 p 1; RPS § 7 | `issueDate` | **E** if missing or not a real date; **W** if more than 30 days in the future |
| 3 | Seller's name, address and VAT number (KMKR) | KMS § 37 lg 7 p 2 | `seller.name`, `seller.address`, `seller.vatNumber` | **E** for a missing name or address (street or city; country). **W** for a missing postal code. **E** for a missing or invalid VAT number (EE checksum) under every scheme except `not-registered` |
| 4 | Buyer's name and address | KMS § 37 lg 7 p 3 | `buyer.name`, `buyer.address` | **E** for a missing name. A missing address is **E** for sellers registered for VAT and **W** for sellers who are not |
| 5 | Buyer's VAT number when the buyer is liable for the VAT (reverse charge) or on an intra-Community supply | KMS § 37 lg 7 p 4 | `buyer.vatNumber` | **E** if missing or invalid for `eu-reverse-charge`, `eu-goods` and `domestic-reverse-charge` (`vatSchemeRequiresBuyerVat`). For the EU schemes, an EE or non-EU prefix is **E**. For domestic reverse charge, a non-EE prefix is **E**. **W** if the country and the VAT prefix differ |
| 6 | Description of goods/services, and quantity or volume | KMS § 37 lg 7 p 5; RPS § 7 | `lines[].description`, `quantity`, `unit` | **E** if there are no lines, a description is empty, or a quantity is zero or missing. **W** if the unit is missing |
| 7 | Date of supply, if it can be determined and differs from the issue date | KMS § 37 lg 7 p 6 | `supplyDate` (optional), `periodStart/End` | **E** if a date is invalid or the period ends before it starts. **W** if only one end of the period is set. **W** if the invoice is issued more than 7 days after the supply (invoicing deadline, KMS § 37; **⚠ lõige not verified**) |
| 8 | Taxable value per rate or exemption, unit price excluding VAT, and discounts not included in the unit price | KMS § 37 lg 7 p 7 | `lines[].unitPrice`, `discountPercent`; `InvoiceTotals.vatBreakdown` | **E** for a missing unit price or a discount outside 0–100%. **W** for a unit price of 0. **calc**: one breakdown row per rate |
| 9 | VAT rate | KMS § 37 lg 7 p 8 | `lines[].vatRate`; breakdown `rate` | **E** for a rate that is not an Estonian rate. **W** for a historical rate. Under schemes other than domestic the rate is ignored (**W** if a line still carries one) and the breakdown prints 0% |
| 10 | VAT amount payable, in euros | KMS § 37 lg 7 (**⚠ clause no. not verified**; a secondary source cites p 10) | `InvoiceTotals.vat` | **calc**: VAT is computed per rate on the sum of that rate's line nets and rounded half-up to the cent. **W** on a domestic invoice in a currency other than EUR (the VAT must also be shown in EUR; the PDF/e-invoice must print the EUR amount) |

### 3.2 Additional references and notes — KMS § 37 lg 8 / lg 8¹, Directive art. 226

EMTA explains that § 37 lg 8 requires a reference to the KMS or Directive provision for exempt supplies, 0% supplies,
intra-Community transactions and special schemes. Under lg 8¹, that reference may be replaced by another clear and
unambiguous note. When the buyer is liable for the VAT, the word **"pöördmaksustamine"** ("reverse charge") is
mandatory whatever the rate.

| Scheme (`VatScheme`) | Legal basis | Printed note (`vatSchemeNote`, ET / EN; `et-en` → "ET / EN") | Enforcement |
|---|---|---|---|
| `domestic` | KMS § 37 lg 7 | none. A custom `vatExemptionNote` is printed if set | **W** if a 0% line has no `vatExemptionNote` (a 0% supply needs a reference) |
| `eu-reverse-charge`: B2B services to an EU taxable person | KMS § 10 (place of supply is the buyer's country; **⚠ lõige not verified**, so the note cites only "§ 10"); Dir. art. 44 and 196; KMS § 37 lg 8 | "Pöördmaksustamine. Teenuse käibe tekkimise koht on teenuse saaja asukohariik (KMS § 10; direktiivi 2006/112/EÜ art 44 ja 196)." / "Reverse charge. …" | **note** is always printed (a custom note is appended, never replaces it). Buyer VAT is required: **E** |
| `eu-goods`: intra-Community supply of goods | KMS § 15 lg 3 p 2 (**⚠ clause per EMTA/rup.ee, not checked against the current act**); Dir. art. 138 | "Kauba ühendusesisene käive, käibemaksumäär 0% (KMS § 15 lg 3 p 2; direktiivi 2006/112/EÜ art 138)." | **note**; buyer VAT from another member state: **E**. The 0% rate also requires the supply to be reported in the VD (intra-Community supply) report. That reporting is outside the app |
| `export`: goods leaving the EU | KMS § 15 lg 3 p 1 (**⚠ as above**); Dir. art. 146 | "Kauba eksport, käibemaksumäär 0% (KMS § 15 lg 3 p 1; direktiivi 2006/112/EÜ art 146)." | **note**; **W** if the buyer is in the EU. A custom `vatExemptionNote` replaces the default |
| `non-eu-services`: B2B services to a customer outside the EU | KMS § 10 (place of supply); Dir. art. 44 | "Käive ei ole Eestis maksustatav – teenuse käibe tekkimise koht on väljaspool Eestit (KMS § 10; direktiivi 2006/112/EÜ art 44)." | **note**; **W** if the buyer is in the EU or Estonia. E-invoice category G (VATEX-EU-G) |
| `exempt`: KMS § 16 exempt supplies | KMS § 16; § 37 lg 8 | Default: "Käibemaksuvaba käive (KMS § 16)." `vatExemptionNote` replaces it | **W** if `vatExemptionNote` is empty: the user is asked for the exact clause, e.g. "KMS § 16 lg 2 p 1". The generic note counts as a "clear note" under lg 8¹, so this is not an error |
| `domestic-reverse-charge`: KMS § 41¹ (immovable property where tax is opted for, metal waste, investment gold, certain metal products) | KMS § 41¹ (the separate "pöördmaksustamine" marking is in § 41¹ lg 5 according to EMTA, **⚠ unverified**) | "Pöördmaksustamine (KMS § 41¹)." | **note**; an Estonian buyer VAT number is required: **E** |
| `not-registered` | Not a VAT invoice. RPS § 7 and ÄS § 15 apply | Informational: "Müüja ei ole käibemaksukohustuslasena registreeritud, käibemaksu ei lisandu." | VAT columns are hidden (`showVat = false`) |

Not modelled: self-billing ("endale arve koostamine"), the margin schemes for second-hand goods and travel agents,
new means of transport, triangulation ("kolmnurktehing") and simplified invoices. A note for any of these can be
typed into `vatExemptionNote` or `notes` by hand.

### 3.3 Seller registration consistency

| Requirement | Legal basis | Model field | Enforcement |
|---|---|---|---|
| A person not registered for VAT must not charge VAT. VAT shown on an invoice becomes payable by whoever shows it | KMS § 19 (registration); Dir. art. 203 | `seller.vatRegistered`, `vatScheme` | **E** if `!seller.vatRegistered` and the scheme is not `not-registered`. `createEmptyInvoice` forces `not-registered` for such sellers (**auto**) |
| A seller registered for VAT must apply VAT rules | KMS § 37 | `seller.vatRegistered`, `vatScheme` | **E** if a registered seller uses `not-registered`. `createEmptyInvoice` falls back to `domestic` (**auto**) |

### 3.4 Credit notes — KMS § 37 lg 4, Directive art. 219

A document that changes an earlier invoice and refers to it, including a credit note (kreeditarve), is treated as an
invoice. It must therefore carry all the § 37 lg 7 data and an unambiguous reference to the original invoice.

| Requirement | Model field | Enforcement |
|---|---|---|
| Reference to the original invoice | `type = 'credit-note'`, `creditedInvoiceNumber` | **E** if empty or if it refers to the credit note itself |
| All mandatory invoice data | (same as 3.1) | Same rules apply |
| Credited amounts are negative | `lines[].quantity < 0` | **calc** handles negative quantities with symmetric rounding (a credit note mirrors the invoice to the cent). **W** if a credit note total is positive or an invoice total is negative |

### 3.5 Source-document requirements — RPS § 7 (all sellers, including those not registered for VAT)

RPS § 7 (lg 2, per the search snippets of the consolidated act, **⚠ lõige numbering not verified**) requires at minimum:
- the time of the transaction;
- its economic substance;
- its figures (quantity, price, amount).

When the counterparty is an accounting entity, a foreign legal person, or the state or a local government, the invoice
must also carry an invoice number or other identifier and data that identify the parties.

| Requirement | Model field | Enforcement |
|---|---|---|
| Date | `issueDate`, `supplyDate`, period | **E** (see 3.1 #2, #7) |
| Economic substance | `lines[].description` | **E** |
| Figures (quantity, price, sum) | `quantity`, `unitPrice`, totals | **E**, **calc** |
| Invoice number / identifier | `number` | **E** |
| Data identifying the parties | seller name and registry code; buyer name, address and registry code | Seller: see 3.6. Buyer registry code: **W** for an Estonian company buyer without one (or with an invalid one). Personal ID code (isikukood) of a private buyer: optional, **W** if invalid |

### 3.6 Business-document details — ÄS § 15

ÄS § 15 requires an entrepreneur to show its **business name, location (asukoht) and registry code** on its business
documents and on its website. The exact lõige is cited as lg 2 in one secondary source (**⚠ unverified**).

| Requirement | Model field | Enforcement |
|---|---|---|
| Business name | `seller.name` | **E** |
| Registry code (8 digits, checksum) | `seller.registryCode` | **E** if missing or invalid for an Estonian seller (`address.country = 'EE'`) |
| Location / address | `seller.address` | **E** (see 3.1 #3) |

### 3.7 Payment and other data (not mandatory by law, but sanity rules)

| Item | Model field | Enforcement |
|---|---|---|
| Due date | `dueDate` | **E** if missing, invalid or before the issue date. Defaults to issue date + `paymentTermDays` (14) |
| Bank account (IBAN) | `seller.bankAccounts`, `bankAccountIds` | **W** if no account is printed or a selected account no longer exists. **E** if a printed IBAN fails the ISO 13616 mod-97 check or the country length check |
| Payment reference (viitenumber) | `referenceNumber` | **E** if present but invalid (2–20 digits, Pangaliit 7-3-1 check digit). Generate it with `generateReferenceNumber(invoiceNumberDigits)` |
| Late-payment interest | `lateInterestPercentPerDay` | **E** if negative. **W** if above 0.5% per day |
| Currency | `currency` | **E** if empty. **W** for VAT in a currency other than EUR (see 3.1 #10) |

### 3.8 E-invoice right — RPS § 7¹ (in force since 1 July 2025)

According to multiple sources (Finbite, Directo, Raamatupidaja.ee), the amendment adopted on 18 September 2024 works as follows:
- An accounting entity that is **registered in the Commercial Register as an e-invoice recipient** may **require** the seller to issue an e-invoice. The seller must comply. RPS § 7¹ lg 7, **⚠ lõige from a secondary source**.
- An e-invoice is presumed compliant if it follows **EN 16931-1**. Unless the parties agree otherwise, the Estonian EVS 923 standard no longer applies on its own.
- Public-sector buyers lost their separate e-invoice-only rule. They now have the same right to request e-invoices.

**App:** the app produces EN 16931 / Peppol BIS 3 UBL XML (`src/einvoice`). **Open question:** the law
expects the e-invoice to reach the buyer's registered channel, i.e. their e-invoice operator or Peppol access point. A
downloaded XML file attached to an email may not meet that if the buyer insists. The UI should say so.

### 3.9 Retention — RPS § 12

Source documents, including issued invoices, must be kept for **at least 7 years** from the end of the financial year in
which the transaction was booked (RPS § 12; see also MKS § 58, per [EMTA](https://emta.ee/node/125/chapter/10667/pdf)).
They may be moved to another medium as long as the data is not altered.

**App:** data lives only in the browser's IndexedDB. The app should prompt for regular
JSON/Drive backups and saved PDFs. Issued invoices are frozen snapshots (`SellerSnapshot`, `BuyerSnapshot`), so
later profile edits do not change them.

## 4. Calculation rules (`calc.ts`)

- All arithmetic uses integer cents. Rounding is half-up (half away from zero for negatives, so credit notes mirror invoices).
- Line net = round(quantity × unitPrice × (1 − discount%)).
- VAT is computed **per rate on the sum of the line nets for that rate**, then rounded. This follows Estonian practice and KMS § 37 lg 7 ("taxable value by rate"). Each line's VAT is allocated proportionally (largest remainder), so line VATs add up exactly to the totals.
- Only the `domestic` scheme charges VAT. Other schemes for registered sellers show one 0% breakdown row (`showVat = true`) so that 0% or "pöördmaksustamine" is visible. `not-registered` hides VAT (`showVat = false`, no breakdown).

## 5. Identifier checks (`law.ts`, `numbering.ts`)

| Identifier | Algorithm | Source |
|---|---|---|
| Registry code (registrikood) | 8 digits. The first digit is 1 (companies), 7 (state), 8 (non-profits) or 9 (foundations). The check digit uses the isikukood algorithm: weights 1,2,…,9,1 mod 11; if the result is 10, weights 3,4,…,9,1,2,3 mod 11; if 10 again, 0. RIK does not document this, but it holds for ~100 real codes tested | [python-stdnum `ee/registrikood.py`](https://github.com/arthurdejong/python-stdnum/blob/master/stdnum/ee/registrikood.py) |
| Estonian VAT number (KMKR) | `EE` + 9 digits. Weights 3,7,1,3,7,1,3,7,1; the sum must be ≡ 0 (mod 10) | python-stdnum `ee/kmkr.py` |
| Other EU VAT numbers | Format check against the VIES pattern for each member state (EL for Greece, XI for Northern Ireland). GB, NO and CH are accepted for export customers | VIES |
| IBAN | ISO 13616: length check for each country plus mod-97 = 1 | ISO 13616 |
| Reference number (viitenumber) | 2–20 digits. Check digit by the 7-3-1 method: weights 7,3,1 repeated from the rightmost digit; check = (10 − sum mod 10) mod 10. Example: 12131295 → 121312952 | [Pangaliit](https://pangaliit.ee/settlements-and-standards/reference-number-of-the-invoice) |

## 6. Open questions / to verify

1. Exact clause numbers in KMS § 37 lg 7, and the lõige numbers in § 10, § 15 lg 3, § 41¹ lg 5, RPS § 7 / § 7¹ and ÄS § 15. Check each against the current Riigi Teataja texts. They are only used in `legalBasis` strings and printed notes, so a fix is a text change.
2. ~~Separate scheme for services supplied outside the EU~~ — resolved: added `non-eu-services` (KMS § 10).
3. Simplified invoices (KMS § 37: lower requirements for small amounts) are not supported. Every invoice is a full invoice.
4. E-invoice delivery to a buyer's registered operator or Peppol channel is out of scope for a static app (see 3.8).
5. Food VAT: bill 956 SE (food at 13%) was pending in summer 2026, and its final status could not be confirmed. If it is adopted, add the rate to `ESTONIAN_VAT_RATES` (13% already exists, so no change would be needed).
