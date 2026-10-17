// UBL 2.1 Invoice / CreditNote per Peppol BIS Billing 3.0 (EN 16931). Element order follows the UBL 2.1 schemas.
import { computeTotals, selectedBankAccounts, textRows, vatInEur, vatSchemeNote } from '../domain'
import type { Invoice, Party } from '../domain/types'
import { endpointFor, legalIdScheme, taxCategoryFor, unitCode, type TaxCategory } from './codes'
import { el, leaf, serialize, type XmlChild, type XmlElement } from './xml'

export const PEPPOL_CUSTOMIZATION_ID = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0'
export const PEPPOL_PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'

const NS_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'
const NS_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
const NS_INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'
const NS_CREDIT_NOTE = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'

export interface UblOptions {
  /** Embed the human-readable PDF as an attachment (AdditionalDocumentReference). */
  pdf?: { base64: string; fileName: string }
}

/** Amount with exactly two decimals, no "-0.00". */
export function amount(value: number): string {
  const cents = Math.round(value * 100)
  return (cents === 0 ? 0 : cents / 100).toFixed(2)
}

/** Decimal without trailing zeros (quantities, prices, percentages). */
export function decimal(value: number, maxDecimals = 6): string {
  if (!Number.isFinite(value)) return '0'
  const s = value.toFixed(maxDecimals).replace(/\.?0+$/, '')
  return s === '-0' ? '0' : s
}

const cbc = (name: string, value: string | number | undefined | null, attrs?: Record<string, string | undefined>) => leaf(`cbc:${name}`, value, attrs)
const cac = (name: string, ...children: XmlChild[]) => el(`cac:${name}`, null, ...children)

function taxCategoryXml(name: 'TaxCategory' | 'ClassifiedTaxCategory', c: TaxCategory, withReason: boolean): XmlElement {
  return cac(
    name,
    cbc('ID', c.id),
    c.percent !== undefined ? cbc('Percent', decimal(c.percent, 2)) : null,
    withReason && cbc('TaxExemptionReasonCode', c.reasonCode),
    withReason && cbc('TaxExemptionReason', c.reason),
    cac('TaxScheme', cbc('ID', 'VAT')),
  )
}

function partyXml(party: Party & { contactPerson?: string }, o: { vatId: boolean }): XmlElement {
  const endpoint = endpointFor(party)
  const a = party.address
  const regCode = party.registryCode?.trim()
  return cac(
    'Party',
    endpoint && cbc('EndpointID', endpoint.value, { schemeID: endpoint.schemeID }),
    cac('PartyName', cbc('Name', party.name)),
    cac(
      'PostalAddress',
      cbc('StreetName', a?.street),
      cbc('CityName', a?.city),
      cbc('PostalZone', a?.postalCode),
      cbc('CountrySubentity', a?.county),
      cac('Country', cbc('IdentificationCode', (a?.country || 'EE').toUpperCase())),
    ),
    o.vatId && party.vatNumber?.trim() && cac('PartyTaxScheme', cbc('CompanyID', party.vatNumber.replace(/\s+/g, '').toUpperCase()), cac('TaxScheme', cbc('ID', 'VAT'))),
    cac('PartyLegalEntity', cbc('RegistrationName', party.name), cbc('CompanyID', regCode, { schemeID: legalIdScheme(party) })),
    cac('Contact', cbc('Name', party.contactPerson), cbc('Telephone', party.phone), cbc('ElectronicMail', party.email)),
  )
}

function paymentTermsText(invoice: Invoice): string | undefined {
  const lang = invoice.language
  const parts: string[] = []
  const due = invoice.dueDate
  if (due) {
    const d = due.split('-').reverse().join('.')
    if (lang === 'en') parts.push(`Due date ${d}.`)
    else if (lang === 'et') parts.push(`Maksetähtaeg ${d}.`)
    else parts.push(`Maksetähtaeg / Due date ${d}.`)
  }
  const li = invoice.lateInterestPercentPerDay
  if (li && li > 0 && invoice.type !== 'credit-note') {
    const p = decimal(li, 4)
    if (lang === 'en') parts.push(`Late payment interest ${p}% per day.`)
    else if (lang === 'et') parts.push(`Viivis ${p.replace('.', ',')}% päevas.`)
    else parts.push(`Viivis / Late payment interest ${p.replace('.', ',')}% päevas / per day.`)
  }
  return parts.join(' ') || undefined
}

/** Whether the document has an e-invoice form (UBL Invoice / CreditNote). Quotes do not. */
export function supportsEInvoice(invoice: Pick<Invoice, 'type'>): boolean {
  return invoice.type !== 'quote'
}

/**
 * Build UBL 2.1 Invoice (or CreditNote) XML compliant with Peppol BIS Billing 3.0 / EN 16931.
 * Credit notes whose amounts are negative in the app (negative quantities) are written with positive amounts,
 * as UBL CreditNote expects.
 */
export function buildUblXml(invoice: Invoice, opts: UblOptions = {}): string {
  if (!supportsEInvoice(invoice)) throw new Error('A quote has no e-invoice')
  const isCredit = invoice.type === 'credit-note'
  const totals = computeTotals(invoice)
  const sign = isCredit && totals.gross < 0 ? -1 : 1
  const currency = (invoice.currency || 'EUR').toUpperCase()
  const money = (name: string, v: number) => cbc(name, amount(v * sign), { currencyID: currency })
  const vatEur = vatInEur(invoice, totals)
  const scheme = invoice.vatScheme
  const reason = scheme === 'domestic' ? undefined : vatSchemeNote(scheme, invoice.language, invoice.vatExemptionNote) ?? undefined
  const categoryFor = (rate: number) => taxCategoryFor(scheme, scheme === 'domestic' ? rate : 0, reason)
  const vatIds = scheme !== 'not-registered'
  const docName = isCredit ? 'CreditNote' : 'Invoice'
  const lineName = isCredit ? 'CreditNoteLine' : 'InvoiceLine'
  const qtyName = isCredit ? 'CreditedQuantity' : 'InvoicedQuantity'

  // --- VAT breakdown (BG-23) -------------------------------------------------------------
  const subtotals: XmlElement[] =
    scheme === 'domestic'
      ? totals.vatBreakdown.map((r) =>
          cac('TaxSubtotal', money('TaxableAmount', r.taxable), money('TaxAmount', r.vat), taxCategoryXml('TaxCategory', categoryFor(r.rate), true)),
        )
      : [cac('TaxSubtotal', money('TaxableAmount', totals.net), money('TaxAmount', 0), taxCategoryXml('TaxCategory', categoryFor(0), true))]

  // --- Lines (BG-25) ---------------------------------------------------------------------
  const netById = new Map(totals.lines.map((l) => [l.lineId, l.net]))
  const lines = invoice.lines.map((line, i) => {
    let qty = (line.quantity || 0) * sign
    let price = line.unitPrice || 0
    if (price < 0) {
      // Item net price must not be negative (BR-27): move the sign to the quantity.
      price = -price
      qty = -qty
    }
    const net = (netById.get(line.id) ?? 0) * sign
    const discount = line.discountPercent ?? 0
    const gross = Math.round(qty * price * 100) / 100
    const allowance = discount ? Math.round((gross - net) * 100) / 100 : 0
    const description = line.description?.trim() || '-'
    const firstLine = description.split(/\r?\n/)[0].slice(0, 200)
    return cac(
      lineName,
      cbc('ID', i + 1),
      cbc(qtyName, decimal(qty), { unitCode: unitCode(line.unit) }),
      cbc('LineExtensionAmount', amount(net), { currencyID: currency }),
      discount !== 0 &&
        cac(
          'AllowanceCharge',
          cbc('ChargeIndicator', 'false'),
          cbc('AllowanceChargeReasonCode', '95'),
          cbc('AllowanceChargeReason', 'Discount'),
          cbc('MultiplierFactorNumeric', decimal(discount, 4)),
          cbc('Amount', amount(allowance), { currencyID: currency }),
          cbc('BaseAmount', amount(gross), { currencyID: currency }),
        ),
      cac(
        'Item',
        firstLine !== description ? cbc('Description', description) : null,
        cbc('Name', firstLine),
        taxCategoryXml('ClassifiedTaxCategory', categoryFor(line.vatRate), false),
      ),
      cac('Price', cbc('PriceAmount', decimal(price, 6), { currencyID: currency })),
    )
  })

  // --- Header ---------------------------------------------------------------------------
  const accounts = selectedBankAccounts(invoice)
  // Peppol BIS allows one document-level note (PEPPOL-EN16931-R002): the free-text rows and notes share it, in the
  // PDF's reading order (text before the lines, text after the totals, notes).
  const notes = [...textRows(invoice.textBefore), ...textRows(invoice.textAfter), invoice.notes?.trim() ?? '']
    .map((n) => n.trim())
    .filter(Boolean)
    .join('\n\n')
  const buyer = invoice.buyer
  const buyerReference = buyer.contactPerson?.trim() || (invoice.orderReference?.trim() ? undefined : invoice.number || 'N/A')
  const needsDeliveryCountry = scheme === 'eu-goods'
  const deliveryDate = invoice.supplyDate || (needsDeliveryCountry && !invoice.periodStart && !invoice.periodEnd ? invoice.issueDate : undefined)
  const paymentMeans = accounts.map((acc) => {
    const iban = acc.iban.replace(/\s+/g, '').toUpperCase()
    const sepa = /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)
    return cac(
      'PaymentMeans',
      cbc('PaymentMeansCode', sepa ? '58' : '30', { name: sepa ? 'SEPA credit transfer' : 'Credit transfer' }),
      isCredit && cbc('PaymentDueDate', invoice.dueDate),
      cbc('PaymentID', invoice.referenceNumber),
      cac('PayeeFinancialAccount', cbc('ID', iban), cbc('Name', invoice.seller.name), acc.bic && cac('FinancialInstitutionBranch', cbc('ID', acc.bic.trim()))),
    )
  })

  const root = el(
    docName,
    { xmlns: isCredit ? NS_CREDIT_NOTE : NS_INVOICE, 'xmlns:cac': NS_CAC, 'xmlns:cbc': NS_CBC },
    cbc('CustomizationID', PEPPOL_CUSTOMIZATION_ID),
    cbc('ProfileID', PEPPOL_PROFILE_ID),
    cbc('ID', invoice.number || 'DRAFT'),
    cbc('IssueDate', invoice.issueDate),
    !isCredit && cbc('DueDate', invoice.dueDate),
    isCredit ? cbc('CreditNoteTypeCode', '381') : cbc('InvoiceTypeCode', invoice.type === 'prepayment' ? '386' : '380'),
    cbc('Note', notes),
    cbc('DocumentCurrencyCode', currency),
    vatEur !== null && cbc('TaxCurrencyCode', 'EUR'),
    cbc('BuyerReference', buyerReference),
    (invoice.periodStart || invoice.periodEnd) && cac('InvoicePeriod', cbc('StartDate', invoice.periodStart), cbc('EndDate', invoice.periodEnd)),
    cac('OrderReference', cbc('ID', invoice.orderReference)),
    isCredit && cac('BillingReference', cac('InvoiceDocumentReference', cbc('ID', invoice.creditedInvoiceNumber))),
    opts.pdf?.base64 &&
      cac(
        'AdditionalDocumentReference',
        cbc('ID', invoice.number || opts.pdf.fileName),
        cbc('DocumentDescription', isCredit ? 'Credit note PDF' : 'Invoice PDF'),
        cac('Attachment', cbc('EmbeddedDocumentBinaryObject', opts.pdf.base64, { mimeCode: 'application/pdf', filename: opts.pdf.fileName })),
      ),
    cac('AccountingSupplierParty', partyXml(invoice.seller, { vatId: vatIds })),
    cac('AccountingCustomerParty', partyXml(buyer, { vatId: vatIds })),
    (deliveryDate || needsDeliveryCountry) &&
      cac(
        'Delivery',
        cbc('ActualDeliveryDate', deliveryDate),
        needsDeliveryCountry &&
          cac(
            'DeliveryLocation',
            cac(
              'Address',
              cbc('StreetName', buyer.address?.street),
              cbc('CityName', buyer.address?.city),
              cbc('PostalZone', buyer.address?.postalCode),
              cac('Country', cbc('IdentificationCode', (buyer.address?.country || 'EE').toUpperCase())),
            ),
          ),
      ),
    paymentMeans,
    cac('PaymentTerms', cbc('Note', paymentTermsText(invoice))),
    cac('TaxTotal', money('TaxAmount', totals.vat), subtotals),
    // BR-53: VAT total in the accounting currency (EUR) when it differs from the invoice currency.
    vatEur !== null && cac('TaxTotal', cbc('TaxAmount', amount(vatEur * sign), { currencyID: 'EUR' })),
    cac(
      'LegalMonetaryTotal',
      money('LineExtensionAmount', totals.net),
      money('TaxExclusiveAmount', totals.net),
      money('TaxInclusiveAmount', totals.gross),
      money('PayableAmount', totals.gross),
    ),
    lines,
  )
  return serialize(root)
}

export interface UblIssue {
  field: string
  message: { et: string; en: string }
}

/**
 * Things that make the XML fail Peppol validation or unusable for routing. Show these next to the export button;
 * the XML is still produced.
 */
export function eInvoiceIssues(invoice: Invoice): UblIssue[] {
  const issues: UblIssue[] = []
  const add = (field: string, et: string, en: string) => issues.push({ field, message: { et, en } })
  if (!supportsEInvoice(invoice)) {
    add('type', 'Hinnapakkumisest e-arvet ei koostata.', 'A quote is not sent as an e-invoice.')
    return issues
  }
  if (!invoice.number) add('number', 'Arvel puudub number (mustand).', 'The invoice has no number (draft).')
  if (!endpointFor(invoice.seller)) {
    add('seller.registryCode', 'Müüjal puudub e-arve aadress (registrikood või KMKR number).', 'Seller has no e-invoice address (registry code or VAT number).')
  }
  if (!endpointFor(invoice.buyer)) {
    if (invoice.buyer.kind === 'person') {
      add(
        'buyer.registryCode',
        'Ostjal puudub e-arve aadress (Eesti registrikood või KMKR number). Eraisikutele e-arvet Peppol-võrgu kaudu ei saadeta.',
        'Buyer has no e-invoice address (Estonian registry code or VAT number). Private persons cannot receive Peppol e-invoices.',
      )
    } else {
      add(
        'buyer.registryCode',
        'Ostjal puudub e-arve aadress (Eesti registrikood või ELi KMKR number). XML-fail sobib arhiveerimiseks ja käsitsi saatmiseks, kuid e-arve operaator ei pruugi seda ostjale edastada.',
        'The buyer has no Peppol electronic address (Estonian registry code or EU VAT number) – the XML is valid for archiving/manual sending, but an operator may not be able to deliver it.',
      )
    }
  }
  if (invoice.vatScheme !== 'not-registered' && !invoice.seller.vatNumber?.trim()) {
    add('seller.vatNumber', 'Käibemaksuga arvel peab olema müüja KMKR number.', 'A VAT invoice must contain the seller VAT number.')
  }
  if (['eu-reverse-charge', 'eu-goods', 'domestic-reverse-charge'].includes(invoice.vatScheme) && !invoice.buyer.vatNumber?.trim() && !invoice.buyer.registryCode?.trim()) {
    add('buyer.vatNumber', 'Selle käibemaksurežiimi puhul on vaja ostja KMKR numbrit.', 'This VAT treatment requires the buyer VAT number.')
  }
  // The XML carries the EUR VAT total (TaxCurrencyCode) whenever a usable exchange rate is set, so only warn without one.
  const rate = invoice.eurExchangeRate
  const hasEurRate = !!rate && Number.isFinite(rate) && rate > 0
  if ((invoice.currency || 'EUR').toUpperCase() !== 'EUR' && invoice.vatScheme === 'domestic' && !hasEurRate) {
    add(
      'currency',
      'Välisvaluutas käibemaksuga arvel peab käibemaksusumma olema ka eurodes. E-arvele lisatakse see ainult siis, kui euro vahetuskurss on sisestatud.',
      'On a foreign-currency VAT invoice the VAT must also be stated in EUR. The e-invoice includes it only when the euro exchange rate is entered.',
    )
  }
  if (!invoice.lines.length) add('lines', 'Arvel pole ridu.', 'The invoice has no lines.')
  return issues
}
