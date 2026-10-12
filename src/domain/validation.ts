import { computeTotals } from './calc'
import { isValidISODate, todayISO, addDays } from './factory'
import {
  ESTONIAN_VAT_RATES,
  HISTORICAL_VAT_RATES,
  isEuCountry,
  isEuVatNumber,
  isValidEstonianPersonalCode,
  isValidEstonianRegistryCode,
  isValidIban,
  isValidVatNumber,
  normalizeVatNumber,
  vatPrefixToCountry,
  vatSchemeRequiresBuyerVat,
} from './law'
import { isValidReferenceNumber } from './numbering'
import type { Address, Invoice, ValidationIssue } from './types'

export interface ValidateOptions {
  /**
   * Whether an empty invoice number is an error (default true). Pass false to validate a draft whose
   * number will be allocated at the moment of issuing.
   */
  requireNumber?: boolean
  /** Reference "today" for date sanity checks (default: local today). */
  today?: string
}

const L = {
  KMS37: 'KMS § 37 lg 7',
  KMS37_1: 'KMS § 37 lg 7 p 1',
  KMS37_2: 'KMS § 37 lg 7 p 2',
  KMS37_3: 'KMS § 37 lg 7 p 3',
  KMS37_4: 'KMS § 37 lg 7 p 4',
  KMS37_5: 'KMS § 37 lg 7 p 5',
  KMS37_6: 'KMS § 37 lg 7 p 6',
  KMS37_7: 'KMS § 37 lg 7 p 7',
  KMS37_8: 'KMS § 37 lg 7 p 8',
  KMS37_EUR: 'KMS § 37 lg 7 (käibemaksusumma eurodes)',
  KMS37_REF: 'KMS § 37 lg 8',
  KMS37_CREDIT: 'KMS § 37 lg 4; direktiiv 2006/112/EÜ art 219',
  KMS10: 'KMS § 10',
  KMS15: 'KMS § 15 lg 3',
  KMS15_RATES: 'KMS § 15',
  KMS16: 'KMS § 16; KMS § 37 lg 8',
  KMS411: 'KMS § 41¹',
  NOT_REG: 'KMS § 19; direktiiv 2006/112/EÜ art 203',
  RPS7: 'RPS § 7',
  AS: 'ÄS § 15',
} as const

type Severity = ValidationIssue['severity']

function isBlank(value: string | undefined | null): boolean {
  return !value || value.trim() === ''
}

/** Check an invoice against Estonian legal requirements (KMS § 37, RPS § 7, ÄS § 15) and sanity rules. */
export function validateInvoice(invoice: Invoice, options: ValidateOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (field: string, severity: Severity, et: string, en: string, legalBasis?: string) => {
    const issue: ValidationIssue = { field, severity, message: { et, en } }
    if (legalBasis) issue.legalBasis = legalBasis
    issues.push(issue)
  }
  const { seller, buyer, vatScheme } = invoice
  const sellerRegistered = vatScheme !== 'not-registered'
  const lines = invoice.lines ?? []

  // --- Invoice identification -------------------------------------------------
  if ((options.requireNumber ?? true) && isBlank(invoice.number)) {
    add('number', 'error', 'Arve number puudub.', 'Invoice number is missing.', `${L.KMS37_1}; ${L.RPS7}`)
  }
  const issueOk = isValidISODate(invoice.issueDate)
  if (!issueOk) {
    add('issueDate', 'error', 'Arve kuupäev puudub või on vigane.', 'Issue date is missing or invalid.', `${L.KMS37_1}; ${L.RPS7}`)
  } else {
    const today = options.today ?? todayISO()
    if (invoice.issueDate > addDays(today, 30)) {
      add('issueDate', 'warning', 'Arve kuupäev on kaugel tulevikus.', 'Issue date is far in the future.')
    }
  }
  if (!isValidISODate(invoice.dueDate)) {
    add('dueDate', 'error', 'Maksetähtaeg puudub või on vigane.', 'Due date is missing or invalid.')
  } else if (issueOk && invoice.dueDate < invoice.issueDate) {
    add('dueDate', 'error', 'Maksetähtaeg ei saa olla enne arve kuupäeva.', 'Due date cannot be before the issue date.')
  }
  if (invoice.supplyDate !== undefined && invoice.supplyDate !== '') {
    if (!isValidISODate(invoice.supplyDate)) {
      add('supplyDate', 'error', 'Käibe kuupäev on vigane.', 'Date of supply is invalid.', L.KMS37_6)
    } else if (issueOk && sellerRegistered && addDays(invoice.supplyDate, 7) < invoice.issueDate) {
      add(
        'supplyDate',
        'warning',
        'Arve tuleb üldjuhul väljastada 7 kalendripäeva jooksul käibe tekkimisest.',
        'An invoice must generally be issued within 7 calendar days of the supply.',
        'KMS § 37',
      )
    }
  }
  const hasStart = !isBlank(invoice.periodStart)
  const hasEnd = !isBlank(invoice.periodEnd)
  if (hasStart && !isValidISODate(invoice.periodStart!)) {
    add('periodStart', 'error', 'Perioodi algus on vigane.', 'Period start is invalid.')
  }
  if (hasEnd && !isValidISODate(invoice.periodEnd!)) {
    add('periodEnd', 'error', 'Perioodi lõpp on vigane.', 'Period end is invalid.')
  }
  if (hasStart && hasEnd && invoice.periodEnd! < invoice.periodStart!) {
    add('periodEnd', 'error', 'Perioodi lõpp on enne perioodi algust.', 'Period end is before period start.')
  }
  if (hasStart !== hasEnd) {
    add(
      hasStart ? 'periodEnd' : 'periodStart',
      'warning',
      'Teenuse perioodil on märgitud ainult üks kuupäev.',
      'Only one date of the service period is set.',
    )
  }

  // --- Seller -------------------------------------------------------------------
  if (isBlank(seller?.name)) {
    add('seller.name', 'error', 'Müüja nimi (ärinimi) puudub.', 'Seller (business) name is missing.', `${L.KMS37_2}; ${L.AS}; ${L.RPS7}`)
  }
  const sellerInEE = (seller?.address?.country ?? 'EE').toUpperCase() === 'EE'
  if (isBlank(seller?.registryCode)) {
    if (sellerInEE) {
      add('seller.registryCode', 'error', 'Müüja registrikood puudub.', 'Seller registry code is missing.', `${L.AS}; ${L.RPS7}`)
    }
  } else if (sellerInEE && !isValidEstonianRegistryCode(seller.registryCode!)) {
    add(
      'seller.registryCode',
      'error',
      'Müüja registrikood on vigane (8 numbrit, kontrollnumber ei klapi).',
      'Seller registry code is invalid (8 digits, check digit mismatch).',
      L.AS,
    )
  }
  checkAddress(seller?.address, 'seller.address', 'error', `${L.KMS37_2}; ${L.AS}`, 'Müüja', 'Seller', add)

  if (seller?.vatRegistered && vatScheme === 'not-registered') {
    add(
      'vatScheme',
      'error',
      'Käibemaksukohustuslasest müüja peab valima käibemaksu režiimi (nt "Eesti käive").',
      'A VAT-registered seller must choose a VAT scheme (e.g. "domestic").',
      L.KMS37,
    )
  }
  if (seller && !seller.vatRegistered && sellerRegistered) {
    add(
      'vatScheme',
      'error',
      'Käibemaksukohustuslaseks registreerimata müüja ei tohi arvel käibemaksu arvestada ega KMKR režiimi kasutada.',
      'A seller not registered for VAT cannot charge VAT or use a VAT scheme.',
      L.NOT_REG,
    )
  }
  if (sellerRegistered) {
    if (isBlank(seller?.vatNumber)) {
      add('seller.vatNumber', 'error', 'Müüja KMKR number puudub.', 'Seller VAT number is missing.', L.KMS37_2)
    } else if (!isValidVatNumber(seller.vatNumber!)) {
      add('seller.vatNumber', 'error', 'Müüja KMKR number on vigane.', 'Seller VAT number is invalid.', L.KMS37_2)
    }
  }

  // --- Bank accounts ------------------------------------------------------------
  const accounts = seller?.bankAccounts ?? []
  const selected = invoice.bankAccountIds?.length
    ? accounts.filter((a) => invoice.bankAccountIds.includes(a.id))
    : accounts
  if (selected.length === 0) {
    add(
      'bankAccountIds',
      'warning',
      'Arvel pole ühtegi pangakontot – ostja ei tea, kuhu maksta.',
      'No bank account on the invoice – the buyer will not know where to pay.',
    )
  }
  ;(invoice.bankAccountIds ?? []).forEach((id) => {
    if (!accounts.some((a) => a.id === id)) {
      add('bankAccountIds', 'warning', 'Valitud pangakontot ei leitud müüja andmetest.', 'A selected bank account no longer exists in the seller data.')
    }
  })
  accounts.forEach((account, i) => {
    if (selected.includes(account) && !isValidIban(account.iban)) {
      add(`seller.bankAccounts.${i}.iban`, 'error', `IBAN ${account.iban} on vigane.`, `IBAN ${account.iban} is invalid.`)
    }
  })

  // --- Buyer --------------------------------------------------------------------
  if (isBlank(buyer?.name)) {
    add('buyer.name', 'error', 'Ostja nimi puudub.', 'Buyer name is missing.', `${L.KMS37_3}; ${L.RPS7}`)
  }
  checkAddress(
    buyer?.address,
    'buyer.address',
    sellerRegistered ? 'error' : 'warning',
    sellerRegistered ? L.KMS37_3 : L.RPS7,
    'Ostja',
    'Buyer',
    add,
  )
  const buyerCountry = (buyer?.address?.country ?? '').trim().toUpperCase()
  if (buyer?.kind === 'company' && buyerCountry === 'EE') {
    if (isBlank(buyer.registryCode)) {
      add(
        'buyer.registryCode',
        'warning',
        'Ostja registrikood puudub (vajalik tehingu osapoole tuvastamiseks).',
        'Buyer registry code is missing (needed to identify the counterparty).',
        L.RPS7,
      )
    } else if (!isValidEstonianRegistryCode(buyer.registryCode!)) {
      add('buyer.registryCode', 'warning', 'Ostja registrikood tundub vigane.', 'Buyer registry code looks invalid.')
    }
  }
  if (buyer?.kind === 'person' && !isBlank(buyer.personalCode) && buyerCountry === 'EE' && !isValidEstonianPersonalCode(buyer.personalCode!)) {
    add('buyer.personalCode', 'warning', 'Ostja isikukood tundub vigane.', 'Buyer personal ID code looks invalid.')
  }

  const buyerVat = isBlank(buyer?.vatNumber) ? '' : normalizeVatNumber(buyer.vatNumber!)
  const buyerVatValid = buyerVat !== '' && isValidVatNumber(buyerVat)
  const buyerVatPrefix = buyerVat.slice(0, 2)
  if (vatSchemeRequiresBuyerVat(vatScheme)) {
    if (!buyerVat) {
      add('buyer.vatNumber', 'error', 'Ostja KMKR number on selle käibe puhul kohustuslik.', 'Buyer VAT number is mandatory for this type of supply.', L.KMS37_4)
    } else if (!buyerVatValid) {
      add('buyer.vatNumber', 'error', 'Ostja KMKR number on vigane.', 'Buyer VAT number is invalid.', L.KMS37_4)
    }
  } else if (buyerVat && !buyerVatValid) {
    add('buyer.vatNumber', 'warning', 'Ostja KMKR number tundub vigane.', 'Buyer VAT number looks invalid.')
  }
  if ((vatScheme === 'eu-reverse-charge' || vatScheme === 'eu-goods') && buyerVatValid) {
    if (buyerVatPrefix === 'EE') {
      add(
        'buyer.vatNumber',
        'error',
        'Ühendusesisene käive / pöördmaksustamine eeldab teise liikmesriigi KMKR numbrit; Eesti ostjale kasuta "Eesti käive".',
        'Intra-Community supply / EU reverse charge needs a VAT number from another Member State; use "domestic" for Estonian buyers.',
        vatScheme === 'eu-goods' ? L.KMS15 : 'KMS § 10',
      )
    } else if (!isEuVatNumber(buyerVat)) {
      add(
        'buyer.vatNumber',
        'error',
        'Ostja KMKR number ei ole EL liikmesriigi number; väljapoole EL-i müügi korral kasuta "Eksport".',
        'Buyer VAT number is not from an EU Member State; use "export" for non-EU customers.',
        vatScheme === 'eu-goods' ? L.KMS15 : 'KMS § 10',
      )
    } else if (buyerCountry && vatPrefixToCountry(buyerVatPrefix) !== buyerCountry && !(buyerVatPrefix === 'XI' && buyerCountry === 'GB')) {
      add('buyer.address.country', 'warning', 'Ostja riik ei vasta KMKR numbri riigikoodile.', 'Buyer country does not match the VAT number prefix.')
    }
  }
  if (vatScheme === 'domestic-reverse-charge' && buyerVatValid && buyerVatPrefix !== 'EE') {
    add(
      'buyer.vatNumber',
      'error',
      'Siseriiklik pöördmaksustamine eeldab Eesti KMKR numbriga ostjat.',
      'Domestic reverse charge requires a buyer with an Estonian VAT number.',
      L.KMS411,
    )
  }
  if (vatScheme === 'export' && buyerCountry && isEuCountry(buyerCountry)) {
    add(
      'vatScheme',
      'warning',
      'Ostja asub EL-is – eksport on kauba väljavedu EL-ist. Kontrolli, kas sobib "EL kaup" või "EL teenus (pöördmaksustamine)".',
      'The buyer is in the EU – export means goods leaving the EU. Check whether "EU goods" or "EU services (reverse charge)" fits.',
      L.KMS15,
    )
  }
  if (vatScheme === 'non-eu-services' && buyerCountry && (isEuCountry(buyerCountry) || buyerCountry === 'EE')) {
    add(
      'vatScheme',
      'warning',
      'Ostja asub EL-is – teenuse müügil ELi ettevõttele kasuta "EL teenus (pöördmaksustamine)", Eesti ostjale tavalist käibemaksu.',
      'The buyer is in the EU – for services to an EU business use "EU services (reverse charge)", for an Estonian buyer use normal VAT.',
      L.KMS10,
    )
  }
  if (vatScheme === 'domestic' && buyerCountry && buyerCountry !== 'EE' && buyer?.kind === 'company' && buyerVatValid && buyerVatPrefix !== 'EE') {
    add(
      'vatScheme',
      'warning',
      'Ostja on teise riigi ettevõte – kontrolli, kas peaks kasutama pöördmaksustamist, ühendusesisest käivet või eksporti.',
      'The buyer is a foreign business – check whether reverse charge, intra-Community supply or export applies.',
    )
  }

  // --- Scheme notes -------------------------------------------------------------
  if (vatScheme === 'exempt' && isBlank(invoice.vatExemptionNote)) {
    add(
      'vatExemptionNote',
      'warning',
      'Maksuvaba käibe korral täpsusta maksuvabastuse alus (nt "KMS § 16 lg 2 p 1"); vaikimisi trükitakse üldviide KMS § 16-le.',
      'For an exempt supply specify the exact exemption (e.g. "KMS § 16 lg 2 p 1"); by default a generic reference to KMS § 16 is printed.',
      L.KMS16,
    )
  }

  // --- Credit note --------------------------------------------------------------
  if (invoice.type === 'credit-note') {
    if (isBlank(invoice.creditedInvoiceNumber)) {
      add(
        'creditedInvoiceNumber',
        'error',
        'Kreeditarvel peab olema viide algsele arvele (arve number).',
        'A credit note must refer to the original invoice (invoice number).',
        L.KMS37_CREDIT,
      )
    } else if (invoice.creditedInvoiceNumber!.trim() === invoice.number.trim()) {
      add('creditedInvoiceNumber', 'error', 'Kreeditarve ei saa viidata iseendale.', 'A credit note cannot refer to itself.')
    }
  }

  // --- Lines --------------------------------------------------------------------
  if (lines.length === 0) {
    add('lines', 'error', 'Arvel peab olema vähemalt üks rida.', 'The invoice must have at least one line.', `${L.KMS37_5}; ${L.RPS7}`)
  }
  let zeroRateDomestic = false
  lines.forEach((line, i) => {
    const f = `lines.${i}`
    if (isBlank(line.description)) {
      add(`${f}.description`, 'error', `Rida ${i + 1}: kauba või teenuse kirjeldus puudub.`, `Line ${i + 1}: description of goods or services is missing.`, `${L.KMS37_5}; ${L.RPS7}`)
    }
    if (typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity === 0) {
      add(`${f}.quantity`, 'error', `Rida ${i + 1}: kogus puudub või on null.`, `Line ${i + 1}: quantity is missing or zero.`, `${L.KMS37_5}; ${L.RPS7}`)
    }
    if (typeof line.unitPrice !== 'number' || !Number.isFinite(line.unitPrice)) {
      add(`${f}.unitPrice`, 'error', `Rida ${i + 1}: ühiku hind puudub.`, `Line ${i + 1}: unit price is missing.`, `${L.KMS37_7}; ${L.RPS7}`)
    } else if (line.unitPrice === 0) {
      add(`${f}.unitPrice`, 'warning', `Rida ${i + 1}: ühiku hind on 0.`, `Line ${i + 1}: unit price is 0.`)
    }
    if (isBlank(line.unit)) {
      add(`${f}.unit`, 'warning', `Rida ${i + 1}: mõõtühik puudub.`, `Line ${i + 1}: unit of measure is missing.`, L.KMS37_5)
    }
    if (line.discountPercent !== undefined && line.discountPercent !== null) {
      const d = line.discountPercent
      if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > 100) {
        add(`${f}.discountPercent`, 'error', `Rida ${i + 1}: allahindlus peab olema 0–100%.`, `Line ${i + 1}: discount must be 0–100%.`, L.KMS37_7)
      }
    }
    if (vatScheme === 'domestic') {
      const rate = line.vatRate
      if (typeof rate !== 'number' || !Number.isFinite(rate)) {
        add(`${f}.vatRate`, 'error', `Rida ${i + 1}: käibemaksumäär puudub.`, `Line ${i + 1}: VAT rate is missing.`, L.KMS37_8)
      } else if (HISTORICAL_VAT_RATES.includes(rate)) {
        add(
          `${f}.vatRate`,
          'warning',
          `Rida ${i + 1}: ${rate}% ei ole 2026. aastal kehtiv määr (lubatud ainult varasema käibe korrigeerimisel).`,
          `Line ${i + 1}: ${rate}% is not a current rate (only for corrections of earlier supplies).`,
          L.KMS15_RATES,
        )
      } else if (!ESTONIAN_VAT_RATES.includes(rate)) {
        add(
          `${f}.vatRate`,
          'error',
          `Rida ${i + 1}: lubamatu käibemaksumäär ${rate}% (lubatud ${ESTONIAN_VAT_RATES.join(', ')}%).`,
          `Line ${i + 1}: invalid VAT rate ${rate}% (allowed ${ESTONIAN_VAT_RATES.join(', ')}%).`,
          L.KMS37_8,
        )
      } else if (rate === 0) {
        zeroRateDomestic = true
      }
    } else if (typeof line.vatRate === 'number' && line.vatRate !== 0) {
      add(
        `${f}.vatRate`,
        'warning',
        `Rida ${i + 1}: käibemaksumäära ei arvestata valitud režiimi puhul (arvel 0% / käibemaksuta).`,
        `Line ${i + 1}: the VAT rate is ignored for the selected scheme (0% / no VAT on the invoice).`,
      )
    }
  })
  if (zeroRateDomestic && isBlank(invoice.vatExemptionNote)) {
    add(
      'vatExemptionNote',
      'warning',
      '0% määraga käibe korral tuleb arvele märkida viide KMS-i või direktiivi vastavale sättele.',
      'For a 0% supply the invoice must state the relevant provision of the VAT Act or the Directive.',
      L.KMS37_REF,
    )
  }

  // --- Totals / currency ----------------------------------------------------------
  if (lines.length > 0) {
    const totals = computeTotals(invoice)
    if (invoice.type === 'credit-note' && totals.gross > 0) {
      add(
        'lines',
        'warning',
        'Kreeditarve summa on positiivne – krediteeritavad kogused peaksid olema negatiivsed.',
        'The credit note total is positive – credited quantities should be negative.',
      )
    }
    if (invoice.type !== 'credit-note' && totals.gross < 0) {
      add('lines', 'warning', 'Arve summa on negatiivne – kasuta kreeditarvet.', 'The invoice total is negative – use a credit note.')
    }
    if (isBlank(invoice.currency)) {
      add('currency', 'error', 'Valuuta puudub.', 'Currency is missing.')
    } else if (vatScheme === 'domestic' && totals.vat !== 0 && invoice.currency.trim().toUpperCase() !== 'EUR') {
      add(
        'currency',
        'warning',
        'Välisvaluutas arvel tuleb käibemaksusumma näidata ka eurodes.',
        'On a foreign-currency invoice the VAT amount must also be shown in euros.',
        L.KMS37_EUR,
      )
    }
  }

  // --- Payment reference ----------------------------------------------------------
  if (!isBlank(invoice.referenceNumber) && !isValidReferenceNumber(invoice.referenceNumber!)) {
    add(
      'referenceNumber',
      'error',
      'Viitenumber on vigane (2–20 numbrit, kontrollnumber 7-3-1 meetodil).',
      'Reference number is invalid (2–20 digits with a 7-3-1 check digit).',
    )
  }
  if (invoice.lateInterestPercentPerDay !== undefined && invoice.lateInterestPercentPerDay !== null) {
    const r = invoice.lateInterestPercentPerDay
    if (!Number.isFinite(r) || r < 0) {
      add('lateInterestPercentPerDay', 'error', 'Viivise määr on vigane.', 'Late interest rate is invalid.')
    } else if (r > 0.5) {
      add('lateInterestPercentPerDay', 'warning', 'Viivise määr tundub ebatavaliselt kõrge.', 'Late interest rate looks unusually high.')
    }
  }

  return issues
}

function checkAddress(
  address: Address | undefined,
  field: string,
  severity: Severity,
  legalBasis: string,
  whoEt: string,
  whoEn: string,
  add: (field: string, severity: Severity, et: string, en: string, legalBasis?: string) => void,
) {
  if (!address || (isBlank(address.street) && isBlank(address.city))) {
    add(field, severity, `${whoEt} aadress puudub.`, `${whoEn} address is missing.`, legalBasis)
    return
  }
  if (isBlank(address.street)) add(`${field}.street`, severity, `${whoEt} aadressil puudub tänav ja maja.`, `${whoEn} address has no street.`, legalBasis)
  if (isBlank(address.city)) add(`${field}.city`, severity, `${whoEt} aadressil puudub linn/asula.`, `${whoEn} address has no city.`, legalBasis)
  if (isBlank(address.country)) add(`${field}.country`, severity, `${whoEt} aadressil puudub riik.`, `${whoEn} address has no country.`, legalBasis)
  if (isBlank(address.postalCode)) add(`${field}.postalCode`, 'warning', `${whoEt} aadressil puudub postiindeks.`, `${whoEn} address has no postal code.`)
}

/** True when there are no 'error' severity issues. */
export function canIssue(invoice: Invoice, options?: ValidateOptions): boolean {
  return !validateInvoice(invoice, options).some((i) => i.severity === 'error')
}
