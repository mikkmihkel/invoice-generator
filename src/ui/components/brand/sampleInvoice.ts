// A realistic sample invoice for the design preview, built from the (possibly unfinished) company profile.
import { createEmptyInvoice, predictNumber, type ColorMode, type CompanyProfile, type Invoice, type InvoiceLanguage, type TemplateId } from '../../../domain'

const TEXT: Record<'et' | 'en', { seller: string; buyer: string; lines: [string, number, string, number][] }> = {
  et: {
    seller: 'Sinu Ettevõte OÜ',
    buyer: 'Näidis Klient OÜ',
    lines: [
      ['Veebilehe kujundus ja arendus', 24, 'h', 65],
      ['Majutusteenus, 12 kuud', 1, 'tk', 120],
      ['Konsultatsioon', 2, 'h', 55],
    ],
  },
  en: {
    seller: 'Your Company Ltd',
    buyer: 'Sample Client Ltd',
    lines: [
      ['Website design and development', 24, 'h', 65],
      ['Hosting, 12 months', 1, 'pcs', 120],
      ['Consultation', 2, 'h', 55],
    ],
  },
}

export interface DesignChoice {
  templateId: TemplateId
  accentColor: string
  secondaryColor?: string
  colorMode?: ColorMode
}

/**
 * Issued-looking sample invoice (no draft watermark) with the profile's seller details, logo and defaults, and the
 * given design. Missing seller details get placeholders so the preview is meaningful during onboarding.
 */
export function designSampleInvoice(profile: CompanyProfile, design: DesignChoice, issueDate = '2026-10-14'): Invoice {
  const lang: InvoiceLanguage = profile.defaults.language
  const text = TEXT[lang === 'en' ? 'en' : 'et']
  const inv = createEmptyInvoice(profile)
  const year = Number(issueDate.slice(0, 4))
  const vatRate = inv.vatScheme === 'domestic' ? profile.defaults.defaultVatRate : 0
  const due = new Date(Date.UTC(year, Number(issueDate.slice(5, 7)) - 1, Number(issueDate.slice(8, 10)) + profile.defaults.paymentTermDays))
  const sample: Invoice = {
    ...inv,
    id: 'design-sample',
    number: predictNumber(profile.numbering, issueDate),
    status: 'issued',
    issueDate,
    dueDate: due.toISOString().slice(0, 10),
    seller: {
      ...inv.seller,
      name: profile.name.trim() || text.seller,
      logoDataUrl: profile.logoDataUrl,
      bankAccounts: profile.bankAccounts.filter((a) => a.iban.trim()),
    },
    bankAccountIds: [],
    buyer: { kind: 'company', name: text.buyer, registryCode: '12345678', address: { street: 'Pikk 1', city: 'Tallinn', postalCode: '10123', country: 'EE' } },
    lines: text.lines.map(([description, quantity, unit, unitPrice], i) => ({ id: `s${i}`, description, quantity, unit, unitPrice, vatRate })),
    language: lang,
    templateId: design.templateId,
    accentColor: design.accentColor,
    createdAt: `${issueDate}T09:00:00.000Z`,
    updatedAt: `${issueDate}T09:00:00.000Z`,
  }
  delete sample.secondaryColor
  delete sample.colorMode
  if (design.secondaryColor) sample.secondaryColor = design.secondaryColor
  if (design.colorMode) sample.colorMode = design.colorMode
  return sample
}
