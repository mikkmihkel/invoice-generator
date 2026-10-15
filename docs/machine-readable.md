# Machine-readable invoices

The PDF has to look good to people and also be easy for software to read: accounting software, OCR and
extraction tools, document managers, banks and AI parsers. This page covers what the PDF contains for
software, how to check it, and where the limits are.

Code: `src/pdf/machine.ts` (metadata, embedded e-invoice, EPC QR payload), applied to every document in
`src/pdf/render.ts` (`withMachineLayer`). Tests: `src/pdf/machine.test.ts`, with the pdf.js helper
`src/pdf/testing/extract.ts`.

## What the PDF contains for software

### 1. Real text, not pictures of text
- pdfmake writes every label and value as vector text in embedded, subsetted TrueType fonts (IBM Plex) with
  a `ToUnicode` map. Copy-paste, `pdftotext`, pdf.js and AI parsers therefore get the exact characters,
  including `õ ä ö ü š ž` and `€`, with no OCR step.
- Text is never rasterised. The only raster image is the seller's logo. The QR code is drawn as vector
  rectangles.
- Text is never rotated or skewed. The one exception is the diagonal "MUSTAND" / "TÜHISTATUD" watermark on
  drafts and cancelled invoices, which is deliberate.
- Identifiers are printed as written, with no letter-spacing and no hyphenation inside a value. The IBAN is
  grouped in fours (`EE47 1000 0010 2014 5685`), the standard print form that every IBAN parser accepts.

### 2. Fixed labels next to their values
- Labels come from one fixed dictionary (`src/pdf/labels.ts`): "Arve nr", "Arve kuupäev", "Maksetähtaeg",
  "Viitenumber", "Registrikood", "KMKR nr", "Summa käibemaksuta", "Käibemaks kokku", "Tasumisele
  kuulub", and the English equivalents. Bilingual invoices print "Estonian / English", or the two parts
  stacked.
- Each value directly follows its label in reading order (`Tasumisele kuulub 2 516,92 €`), so a plain regex
  is enough to find it.
- Net total and VAT total each appear exactly once. The amount due may also be shown in a header summary,
  but every occurrence must carry the same amount.
- Dates use the invoice language's fixed format: `26.10.2026` for Estonian and bilingual invoices,
  `26 Oct 2026` for English. Amounts always have two decimals.

### 3. Reading order
- The content stream follows the logical order: header and invoice data, then parties, then line items, then
  VAT breakdown and totals, then payment details and notes, then the footer.
- The totals block comes after the last line item in content order, which is what pdf.js and most
  extraction or LLM pipelines read. It also sits below the last line item on the page, which matters for
  `pdftotext` and OCR that reads top to bottom.

### 4. Document metadata (PDF Info dictionary and `/Lang`)
| Entry | Example |
|---|---|
| Title | `Arve 2026-0007` / `Invoice 2026-0007` / `Arve / Invoice 2026-0007`, drafts: `Arve (mustand)` |
| Author | seller name |
| Subject | `Arve 2026-0007, Kalda Puutöö OÜ, 2 083,20 EUR, tasuda 28.10.2026` |
| Keywords | `invoice:2026-0007; issued:2026-10-12; due:2026-10-28; seller:12345678; sellerVat:EE123456789; buyer:87654321; buyerVat:EE987654321; total:2083.20; currency:EUR; reference:20260007` |
| Creator | `Arvegeneraator` (Producer stays `pdfmake`) |
| Custom entries | `InvoiceNumber`, `InvoiceType`, `IssueDate`, `DueDate`, `SellerName`, `SellerRegistryCode`, `SellerVatNumber`, `BuyerName`, `BuyerRegistryCode`, `BuyerVatNumber`, `NetAmount`, `VatAmount`, `TotalAmount`, `Currency`, `ReferenceNumber`, `Iban` (ISO dates, amounts with a dot) |
| `/Lang` | `et-EE` (Estonian and bilingual) or `en-GB` |

The file is written as PDF 1.7.

### 5. Embedded e-invoice (UBL 2.1 / Peppol BIS Billing 3.0)
Every issued (numbered, non-draft) PDF carries the e-invoice XML as an embedded file:

- name `Arve_2026-0007.xml` / `Invoice_2026-0007.xml` / `Kreeditarve_2026-0008.xml`, MIME type
  `application/xml`, description "E-arve 2026-0007 (UBL 2.1, Peppol BIS Billing 3.0 / EN 16931)";
- it is listed in the document's `EmbeddedFiles` name tree (the paperclip panel in Acrobat, Firefox and
  others) and in the catalog `/AF` array with `/AFRelationship /Alternative`;
- the XML is `buildUblXml(invoice)` built **without** the PDF inside, so the PDF and the XML do not contain
  each other;
- drafts get no attachment: a draft has no number and is not a valid invoice.

`renderInvoicePdf(invoice, { embedEInvoice: false })` leaves the attachment out. Use this for the PDF that
itself goes into a UBL file as `AdditionalDocumentReference`, where the XML inside would only be a
redundant copy.

**This is a hybrid PDF in spirit, but it is not ZUGFeRD / Factur-X / XRechnung-in-PDF.** A certified
Factur-X / ZUGFeRD 2.x file needs:
1. the **CII** syntax (UN/CEFACT Cross Industry Invoice) as `factur-x.xml`, while we embed **UBL**;
2. **PDF/A-3b** conformance: an embedded ICC output intent, an XMP metadata stream, every font fully
   embedded, and no transparency issues. pdfmake/PDFKit does not produce validated PDF/A-3;
3. **XMP extension schema** entries that declare the Factur-X document type, file name, version and
   conformance level (MINIMUM … EN 16931 … EXTENDED).

So a ZUGFeRD/Factur-X reader (for example German or French accounting software) will not recognise our
file as a Factur-X invoice. A generic reader that looks at PDF attachments, or a person, can still pull out
the UBL and import it. In Estonia, e-invoices travel as separate XML through e-arvete operaatorid (Peppol),
not inside PDFs, so the separate "E-arve (XML)" export remains the main machine channel. The embedded copy is
a convenience that keeps the PDF and its data together.

### 6. Optional EPC QR code ("scan to pay")
`Invoice.paymentQr` (default off; profile default `InvoiceDefaults.paymentQr`) prints an EPC069-12
"SEPA Credit Transfer" QR code, also known as GiroCode or SEPA QR. Templates get the payload from
`paymentQrPayload(invoice)` and render it with error-correction level **M**, as the EPC guidelines require.

Payload (`epcQrPayload` / `epcPayload`), elements separated by LF, with no separator after the last
populated element:

```
BCD                          service tag
002                          version (BIC optional)
1                            character set: UTF-8
SCT                          SEPA Credit Transfer
EEUHEE2X                     BIC of the account, or empty
Õunapuu & Šokolaad OÜ        beneficiary (seller) name, max 70 chars
EE471000001020145685         IBAN
EUR2516.92                   amount, EUR, 0.01–999999999.99
                             purpose: empty
                             structured reference: only an ISO 11649 "RF…" creditor reference
Arve 2026-0007, viitenumber 20260007   unstructured remittance, max 140 chars
```

- The total payload is at most 331 bytes. If multi-byte letters would push it over, the remittance text is
  shortened.
- The Estonian viitenumber (7-3-1) is not an RF reference and EPC has no field for national references, so
  it goes in the remittance text. If `referenceNumber` is a valid `RF…` reference, it goes into the structured
  element and the text line is dropped (EPC allows only one of the two).
- No QR code is printed (`null`) for non-EUR invoices, credit notes, cancelled invoices, totals ≤ 0 or above
  999 999 999,99, or when no selected bank account has a valid IBAN.

**Support in Estonian bank apps has not been verified.** EPC QR codes are widely used and scanned by banking
apps in Germany, Austria, the Netherlands, Belgium and Finland. Secondary sources (Wikipedia, generator
vendors) also list Estonia, Latvia and Lithuania. I could not confirm from the banks' own documentation
that the Swedbank, SEB, LHV, Luminor or Coop Pank apps scan EPC QR codes from invoices; their QR features
are mostly their own payment-request or payment-link codes. The QR is therefore **opt-in**. The printed IBAN
and viitenumber stay the primary payment details. Test with your own bank app before turning it on for
everyone. Foreign (for example German or Finnish) customers are the most likely to benefit.

## How to check it yourself

```sh
pdftotext -layout Arve_2026-0007.pdf -           # text as most tools see it
pdfinfo Arve_2026-0007.pdf                        # Title, Subject, Keywords, Creator, PDF version
pdfinfo -custom Arve_2026-0007.pdf                # custom Info entries (poppler ≥ 22)
pdffonts Arve_2026-0007.pdf                       # all fonts embedded, "uni" = yes (ToUnicode present)
pdfdetach -list Arve_2026-0007.pdf                # → 1: Arve_2026-0007.xml
pdfdetach -saveall -o /tmp Arve_2026-0007.pdf     # extract the UBL
```

In a browser, open the PDF in Firefox or Chrome, select all and paste: the text should come out in reading
order with Estonian letters intact. Firefox lists the XML in its attachments sidebar.

In code (Node/Vitest): `extractPdf(bytes)` from `src/pdf/testing/extract.ts` returns content-order text,
visual lines, Info and custom metadata, `/Lang`, attachments and image counts (pdf.js legacy build).

To check the QR code, scan the printed or on-screen code with a banking app. A generic QR reader should show
the payload above.

## What the tests check (`src/pdf/machine.test.ts`)
For every template in `TEMPLATES` × {et, en, et-en}, the tests render a real PDF and extract it with pdf.js:
- invoice number, issue date, due date, reference number, seller and buyer registry codes and VAT numbers
  each appear right after their label, and no label is followed by a conflicting value;
- seller and buyer names and the IBAN appear as text;
- net total and VAT total appear exactly once with their labels; the amount due appears with its label,
  and every occurrence has the same value;
- totals come after the last line item, both in content order and visually;
- `õäöüšž ÕÄÖÜŠŽ €` survive extraction, with no U+FFFD or private-use glyphs, no rotated text and at most
  one raster image (the logo) per page;
- Title, Subject, Keywords, Author, Creator, custom entries and `/Lang` are correct;
- exactly one attachment named like `Arve_2026-0007.xml`, which parses as XML and whose `cbc:ID`,
  `TaxExclusiveAmount`, `TaxInclusiveAmount` and `PayableAmount` match the PDF, with no PDF embedded inside it.

Also covered: the draft (no attachment, watermark is the only rotated text), the credit note (UBL
`CreditNote`), the `embedEInvoice: false` option, a PDF without a logo (zero raster images), EPC payload unit
tests (the published UTF-8 example, field order, RF references, length and byte limits, the null cases),
the `paymentQr` factory default and backup validation.

## Limits
- No tagged PDF (structure tree) yet. pdfmake 0.3 can set `tagged`, but it does not emit a meaningful
  structure tree, so screen readers and PDF/UA validators get untagged content. Reading order relies on
  content order.
- Not PDF/A, so not suitable as a long-term archival format on its own (keep the UBL XML as well).
- Multi-column header layouts (parties side by side, meta data to the right) interleave in `pdftotext`'s
  default (non-`-layout`) mode. Content order (pdf.js) stays clean. Use `pdftotext -layout` for a visual
  rendering.
- The embedded XML is only as valid as the e-invoice export: see `eInvoiceIssues()` for things that make it
  fail Peppol validation, for example a missing buyer VAT number or registry code.
