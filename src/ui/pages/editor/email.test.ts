import { describe, expect, it } from 'vitest'
import { createDefaultProfile, type Invoice } from '../../../domain'
import { sampleProfile } from '../../testing/memoryRepo'
import { newDraft } from './builders'
import { emailTemplates, emailVars, parseRecipients } from './email'

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
