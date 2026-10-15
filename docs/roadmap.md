# Roadmap: the 10 most valuable missing features

Ranked by value for the owner of an Estonian micro-company who invoices a few times a month, with all data in
the browser. Effort: S (a day or less), M (a few days), L (a week or more / needs outside setup).

| # | Feature | Why it matters | Effort |
|---|---|---|---|
| 1 | **Automatic backup and sync to Google Drive** | Data lives only in one browser, but invoices must be kept for 7 years (RPS § 12). One lost browser profile loses the books. Back up automatically after every issued invoice (versioned files in the Drive folder), restore on a new device, optional passphrase encryption of the backup. | M |
| 2 | **Bank statement import to mark invoices paid** | Today every payment is marked by hand. Import the bank's ISO 20022 camt.053 XML or CSV export (LHV, Swedbank, SEB, Coop, Luminor), match payments by viitenumber, then amount and payer, and mark matching invoices paid with the real payment date. | M |
| 3 | **VAT return helper and VAT-threshold tracker** | Pre-filled figures for the KMD (taxable turnover per rate, 0 % EU supplies, reverse charge, exempt) per month, ready to copy into e-MTA. For non-registered sellers, taxable turnover since the start of the calendar year against the 40 000 € registration threshold (KMS § 19), with an early warning. | M |
| 4 | **Export for the accountant** | One click: a period's invoices as CSV/Excel (number, dates, client, net, VAT per rate, total, status) plus a ZIP of all PDFs and e-invoice XMLs. This is what an accountant or e-arveldaja import actually needs. | S |
| 5 | **Products and services catalogue** | Saved items (description, unit, price, VAT rate) picked while typing a line, and each client's last used prices remembered. Removes most retyping for a small business that sells the same things. | S |
| 6 | **Recurring invoices** | Monthly retainers and subscriptions: "repeat monthly" on an invoice creates the next draft with dates and service period moved forward, and the invoice list shows which recurring drafts are due. Works without a server because drafts are prepared when the app is opened. | M |
| 7 | **Quotes (hinnapakkumine) that become invoices** | A quote with validity date and its own PDF wording, sent the same way as an invoice, and converted to an invoice in one click when accepted. | M |
| 8 | **Payment reminders with late interest** | The reminder e-mail exists; add the calculated viivis (the invoice's daily rate × days overdue), a reminder log per invoice (sent on which dates), and a second, firmer reminder text. | S |
| 9 | **Exchange rates and VAT number check** | Fill the euro exchange rate automatically from the ECB reference rates for the supply date (needed for foreign-currency invoices with VAT), and check EU buyers' VAT numbers against VIES before issuing a reverse-charge invoice (KMS requires a valid buyer VAT number). Needs both services to allow browser requests or a tiny proxy. | M |
| 10 | **Real e-invoice delivery** | Buyers registered as e-invoice recipients can require one (RPS § 7¹). Today the XML is downloaded and uploaded to an operator by hand. Send it directly through an operator or RIK's e-arveldaja API with the owner's own API key, and show the delivery status. Needs an operator contract and a check of the API's browser (CORS) support. | L |

Also worth considering: installable app (PWA) for a desktop icon and offline start (needs a CSP change for the
service worker), several companies in one app (FIE and OÜ side by side), prepayment invoices deducted on the final
invoice, attachments such as timesheets appended to the PDF.
