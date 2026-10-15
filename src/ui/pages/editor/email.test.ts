import { describe, expect, it } from 'vitest'
import { createDefaultProfile, type Invoice } from '../../../domain'
import { sampleProfile } from '../../testing/memoryRepo'
import { newDraft } from './builders'
import { emailTemplates, emailVars, fillEmailText, parseRecipients, reminderTemplates } from './email'

describe('parseRecipients', () => {
  it('splits on commas, semicolons and line breaks and accepts "Name <address>"', () => {
    const r = parseRecipients('Jaan Tamm <jaan@firma.ee>; mari@firma.ee,\n"Tamm, Jaan" <jt@firma.ee>')
    expect(r.invalid).toEqual([])
    expect(r.valid.map((x) => x.address)).toEqual(['jaan@firma.ee', 'mari@firma.ee', 'jt@firma.ee'])
    expect(r.valid[0].display).toBe('Jaan Tamm <jaan@firma.ee>')
    expect(r.valid[1].display).toBe('mari@firma.ee')
  })

  it('reports invalid addresses and ignores empty entries', () => {
    const r = parseRecipients('jaan@firma, , <mari@firma.ee>, not an email')
    expect(r.valid.map((x) => x.display)).toEqual(['mari@firma.ee'])
    expect(r.invalid).toEqual(['jaan@firma', 'not an email'])
    expect(parseRecipients('jüri@firma.ee').invalid).toEqual(['jüri@firma.ee'])
  })
})

describe('emailTemplates', () => {
  const d = createDefaultProfile().defaults

  it('picks the template by invoice language', () => {
    expect(emailTemplates('et', d).subject).toBe('Arve {number} – {company}')
    expect(emailTemplates('en', d).subject).toBe('Invoice {number} from {company}')
    expect(emailTemplates('en', d).body).toContain('Please find attached invoice no. {number}')
  })

  it('uses the Estonian subject and both bodies for bilingual invoices', () => {
    const t = emailTemplates('et-en', d)
    expect(t.subject).toBe(d.emailSubject)
    expect(t.body.indexOf('Tere!')).toBeLessThan(t.body.indexOf('Hello,'))
  })

  it('has one quote text per language, with the validity date and an invitation to reply', () => {
    const et = emailTemplates('et', d, 'quote')
    expect(et.subject).toBe('Hinnapakkumine {number} – {company}')
    expect(et.body).toBe(
      'Tere!\n\nManuses on hinnapakkumine nr {number} summas {total}. Pakkumine kehtib kuni {validUntil}.\n\nKüsimuste korral vastake julgelt sellele kirjale.\n\nLugupidamisega\n{company}',
    )
    expect(emailTemplates('en', d, 'quote').body).toContain('The offer is valid until {validUntil}.')
    expect(emailTemplates('et-en', d, 'quote').body).toBe(et.body + '\n\n---\n\n' + emailTemplates('en', d, 'quote').body)
  })

  it('falls back to built-in English defaults for older profiles', () => {
    const { emailSubjectEn: _s, emailBodyEn: _b, ...old } = d
    expect(emailTemplates('en', old).subject).toBe('Invoice {number} from {company}')
    expect(emailTemplates('en', { ...old, emailSubjectEn: 'Custom {number}' }).subject).toBe('Custom {number}')
  })
})

describe('emailVars', () => {
  it('formats amount and due date in the invoice language with thousands separators', () => {
    const inv: Invoice = {
      ...newDraft(sampleProfile()),
      number: '2026-0001',
      dueDate: '2026-10-26',
      lines: [{ id: 'l1', description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 6025, vatRate: 24 }],
    }
    expect(emailVars(inv, 'Näidis OÜ')).toMatchObject({ total: '7 471,00 €', dueDate: '26.10.2026' })
    expect(emailVars({ ...inv, language: 'en' }, 'Näidis OÜ')).toMatchObject({ total: '€7,471.00', dueDate: '26 Oct 2026' })
  })
})

describe('fillEmailText', () => {
  const inv: Invoice = {
    ...newDraft(sampleProfile()),
    number: '2026-0001',
    dueDate: '2026-10-26',
    language: 'et-en',
    lines: [{ id: 'l1', description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 6025, vatRate: 24 }],
  }

  it('formats the English half of a bilingual e-mail in English', () => {
    const body = fillEmailText(reminderTemplates('et-en').body, inv, 'Näidis OÜ').replace(/[\u00a0\u202f]/g, ' ')
    const [etPart, enPart] = body.split('\n\n---\n\n')
    expect(etPart).toContain('7 471,00 €')
    expect(etPart).toContain('26.10.2026')
    expect(enPart).toContain('€7,471.00')
    expect(enPart).toContain('26 Oct 2026')
    expect(enPart).not.toContain('26.10.2026')
  })

  it('uses a given amount (e.g. what is still owed after a credit note)', () => {
    expect(fillEmailText('{total}', { ...inv, language: 'et' }, 'X', 600).replace(/[\u00a0\u202f]/g, ' ')).toBe('600,00 €')
    expect(emailVars({ ...inv, language: 'en' }, 'X', { amount: 600 }).total).toBe('€600.00')
  })
})

describe('reminderTemplates', () => {
  it('follows the invoice language and keeps the placeholders', () => {
    expect(reminderTemplates('et').subject).toBe('Meeldetuletus: arve {number} on tasumata')
    expect(reminderTemplates('en').body).toContain('{dueDate}')
    const both = reminderTemplates('et-en')
    expect(both.body.indexOf('Tere!')).toBeLessThan(both.body.indexOf('Hello,'))
  })

  it('adds the late interest paragraph only when asked', () => {
    expect(reminderTemplates('et').body).not.toContain('{interest}')
    const et = reminderTemplates('et', { interest: true }).body
    expect(et).toContain('viivis on {interestRate}% päevas')
    expect(et.indexOf('{interest}')).toBeLessThan(et.indexOf('Lugupidamisega'))
    expect(reminderTemplates('et-en', { interest: true }).body.match(/\{interest\}/g)).toHaveLength(2)
  })

  it('uses a firmer text for the second reminder', () => {
    expect(reminderTemplates('et', { second: true }).subject).toBe('Teine meeldetuletus: arve {number} on endiselt tasumata')
    expect(reminderTemplates('et', { second: true }).body).toContain('7 päeva jooksul')
    expect(reminderTemplates('en', { second: true }).subject).toBe('Second reminder: invoice {number} is still unpaid')
  })
})

describe('reminder interest', () => {
  const inv: Invoice = {
    ...newDraft(sampleProfile()),
    number: '2026-0004',
    dueDate: '2026-10-01',
    lines: [{ id: 'l1', description: 'Töö', quantity: 1, unit: 'tk', unitPrice: 1000, vatRate: 24 }],
  }
  const interest = { amount: 9.92, days: 16, ratePercentPerDay: 0.05 }

  it('fills the interest, rate and days in the invoice language', () => {
    const et = fillEmailText(reminderTemplates('et', { interest: true }).body, { ...inv, language: 'et' }, 'Näidis OÜ', 1240, interest).replace(/[\u00a0\u202f]/g, ' ')
    expect(et).toContain('Arvel kokku lepitud viivis on 0,05% päevas. Makse on hilinenud 16 päeva ja tänaseks on viivist kogunenud 9,92 €.')
    expect(et).toContain('summas 1 240,00 €')
    const en = fillEmailText(reminderTemplates('en', { interest: true }).body, { ...inv, language: 'en' }, 'Näidis OÜ', 1240, interest)
    expect(en).toContain('0.05% per day. Days overdue: 16; interest accrued to date: €9.92.')
  })
})

describe('quote e-mail', () => {
  it('has its own text with the validity date', () => {
    const d = createDefaultProfile().defaults
    expect(emailTemplates('et', d, 'quote').subject).toBe('Hinnapakkumine {number} – {company}')
    expect(emailTemplates('et-en', d, 'quote').body).toContain('valid until {validUntil}')
    const inv: Invoice = { ...newDraft(sampleProfile()), type: 'quote', number: 'HP-2026-001', validUntil: '2026-10-29', language: 'et' }
    expect(fillEmailText(emailTemplates('et', d, 'quote').body, inv, 'Näidis OÜ')).toContain('Pakkumine kehtib kuni 29.10.2026.')
  })
})
