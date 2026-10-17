import { describe, expect, it } from 'vitest'
import { createDefaultProfile } from './factory'
import {
  addMonths,
  canRecur,
  createRecurringRule,
  firstOccurrence,
  monthsBetween,
  nextOccurrence,
  nextRecurring,
  prepareRecurringDrafts,
  recurringDraft,
  recurringDraftId,
  recurringOverview,
  resumeRule,
  undoPause,
  undoResume,
  undoStop,
  ruleForInvoice,
  stopRulesFor,
  upcomingOccurrence,
} from './recurring'
import type { CompanyProfile, Invoice, RecurringRule } from './types'

const NOW = '2026-10-15T08:00:00.000Z'

function profile(): CompanyProfile {
  const p = createDefaultProfile()
  p.name = 'Näide OÜ'
  p.bankAccounts = [{ id: 'b1', iban: 'EE382200221020145685' }]
  p.defaults.paymentTermDays = 7
  p.defaults.lateInterestPercentPerDay = 0.05
  return p
}

function source(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'src',
    number: '2026-0007',
    type: 'invoice',
    status: 'issued',
    issueDate: '2026-01-31',
    dueDate: '2026-02-14',
    seller: { name: 'Vana nimi OÜ', vatRegistered: false, address: { street: 'A 1', city: 'Tallinn', postalCode: '10111', country: 'EE' }, bankAccounts: [] },
    buyer: { kind: 'company', name: 'Klient AS', registryCode: '10234957', address: { street: 'B 2', city: 'Tartu', postalCode: '50101', country: 'EE' } },
    bankAccountIds: [],
    lines: [{ id: 'l1', description: 'Hooldus', quantity: 1, unit: 'kuu', unitPrice: 200, vatRate: 24 }],
    currency: 'EUR',
    vatScheme: 'domestic',
    referenceNumber: '202600076',
    textBefore: ['Lepingu nr 5 alusel'],
    notes: 'Märkus',
    language: 'et',
    templateId: 'modern',
    accentColor: '#123456',
    issuedAt: '2026-01-31T10:00:00.000Z',
    createdAt: '2026-01-31T09:00:00.000Z',
    updatedAt: '2026-01-31T10:00:00.000Z',
    ...overrides,
  }
}

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return { id: 'r1', sourceInvoiceId: 'src', interval: 'monthly', nextDate: '2026-02-28', active: true, createdAt: NOW, updatedAt: NOW, ...overrides }
}

describe('addMonths', () => {
  it('clamps to the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30')
    expect(addMonths('2026-08-31', 3)).toBe('2026-11-30')
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28')
  })
  it('crosses year boundaries both ways', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
    expect(addMonths('2026-12-31', 1)).toBe('2027-01-31')
  })
  it('aims for an anchor day and can keep the month end', () => {
    expect(addMonths('2026-02-28', 1, { day: 31 })).toBe('2026-03-31')
    expect(addMonths('2026-02-28', 1, { day: 30 })).toBe('2026-03-30')
    expect(addMonths('2026-02-28', 1, { keepMonthEnd: true })).toBe('2026-03-31')
    expect(addMonths('2026-04-30', 1, { keepMonthEnd: true })).toBe('2026-05-31')
    expect(addMonths('2026-04-29', 1, { keepMonthEnd: true })).toBe('2026-05-29')
  })
  it('rejects malformed dates', () => {
    expect(() => addMonths('2026-02-30', 1)).toThrow()
  })
  it('counts calendar months', () => {
    expect(monthsBetween('2026-01-31', '2026-02-01')).toBe(1)
    expect(monthsBetween('2025-11-15', '2026-02-10')).toBe(3)
  })
})

describe('nextOccurrence', () => {
  it('does not drift after a short month', () => {
    const dates = ['2026-01-31']
    for (let i = 0; i < 4; i++) dates.push(nextOccurrence(dates[dates.length - 1], 'monthly', '2026-01-31'))
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
  })
  it('steps quarterly and yearly', () => {
    expect(nextOccurrence('2026-11-30', 'quarterly', '2026-11-30')).toBe('2027-02-28')
    expect(nextOccurrence('2028-02-29', 'yearly', '2028-02-29')).toBe('2029-02-28')
    expect(nextOccurrence('2029-02-28', 'yearly', '2028-02-29')).toBe('2030-02-28')
  })
  it('the upcoming date of a series is after today', () => {
    expect(upcomingOccurrence({ issueDate: '2026-01-31' }, 'monthly', '2026-01-31')).toBe('2026-02-28')
    expect(upcomingOccurrence({ issueDate: '2026-01-31' }, 'monthly', '2026-10-15')).toBe('2026-10-31')
    expect(upcomingOccurrence({ issueDate: '2026-01-31' }, 'monthly', '2026-10-31')).toBe('2026-11-30')
    expect(upcomingOccurrence({ issueDate: '2026-01-15' }, 'quarterly', '2026-10-15')).toBe('2027-01-15')
  })
  it('a new rule starts one interval after the source', () => {
    expect(firstOccurrence({ issueDate: '2026-01-31' }, 'monthly')).toBe('2026-02-28')
    const r = createRecurringRule({ id: 'x', issueDate: '2026-10-15' }, 'quarterly', NOW)
    expect(r).toMatchObject({ sourceInvoiceId: 'x', interval: 'quarterly', nextDate: '2027-01-15', active: true, createdAt: NOW })
  })
})

describe('recurringDraft', () => {
  it('copies the content and moves the dates', () => {
    const src = source({ supplyDate: '2026-01-31', periodStart: '2026-01-01', periodEnd: '2026-01-31' })
    const d = recurringDraft(src, rule(), '2026-02-28', profile(), NOW)
    expect(d.id).not.toBe(src.id)
    expect(d).toMatchObject({
      number: '',
      status: 'draft',
      type: 'invoice',
      issueDate: '2026-02-28',
      dueDate: '2026-03-14',
      supplyDate: '2026-02-28',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      recurringRuleId: 'r1',
      currency: 'EUR',
      vatScheme: 'domestic',
      textBefore: ['Lepingu nr 5 alusel'],
      notes: 'Märkus',
      templateId: 'modern',
      accentColor: '#123456',
    })
    expect(d.buyer).toEqual(src.buyer)
    expect(d.buyer).not.toBe(src.buyer)
    expect(d.lines[0]).toMatchObject({ description: 'Hooldus', unitPrice: 200 })
    expect(d.lines[0].id).not.toBe('l1')
    expect(d.referenceNumber).toBeUndefined()
    expect(d.issuedAt).toBeUndefined()
    // Seller and bank accounts come from the current profile, the source's own settings win for late interest.
    expect(d.seller.name).toBe('Näide OÜ')
    expect(d.bankAccountIds).toEqual(['b1'])
    expect(d.lateInterestPercentPerDay).toBeUndefined()
  })
  it('keeps a whole-month period whole after a short month', () => {
    const src = source({ periodStart: '2026-01-01', periodEnd: '2026-01-31' })
    const d = recurringDraft(src, rule(), '2026-03-31', profile(), NOW)
    expect([d.periodStart, d.periodEnd]).toEqual(['2026-03-01', '2026-03-31'])
    const q = recurringDraft(src, rule(), '2026-04-30', profile(), NOW)
    expect(q.periodEnd).toBe('2026-04-30')
  })
  it('leaves the exchange rate empty: the new supply date needs its own rate', () => {
    const d = recurringDraft(source({ currency: 'USD', eurExchangeRate: 1.08 }), rule(), '2026-02-28', profile(), NOW)
    expect(d.currency).toBe('USD')
    expect(d.eurExchangeRate).toBeUndefined()
  })
  it('gets an id derived from the rule and the date', () => {
    const a = recurringDraft(source(), rule(), '2026-02-28', profile(), NOW)
    const b = recurringDraft(source(), rule(), '2026-02-28', profile(), '2026-10-16T08:00:00.000Z')
    expect(a.id).toBe('rec-r1-2026-02-28')
    expect(b.id).toBe(a.id)
    expect(recurringDraft(source(), rule(), '2026-03-31', profile(), NOW).id).not.toBe(a.id)
    expect(recurringDraftId('a/b c?', '2026-02-28')).toBe('rec-a_b_c_-2026-02-28')
  })
  it('keeps prepayment invoices and drops credit-note specifics', () => {
    expect(recurringDraft(source({ type: 'prepayment' }), rule(), '2026-02-28', profile(), NOW).type).toBe('prepayment')
  })
})

describe('prepareRecurringDrafts', () => {
  it('creates nothing before the next date', () => {
    const run = prepareRecurringDrafts([rule()], [source()], profile(), '2026-02-27', NOW)
    expect(run).toEqual({ drafts: [], rules: [] })
  })
  it('creates the due draft and advances the rule', () => {
    const run = prepareRecurringDrafts([rule()], [source()], profile(), '2026-02-28', NOW)
    expect(run.drafts.map((d) => d.issueDate)).toEqual(['2026-02-28'])
    expect(run.rules).toEqual([{ ...rule(), nextDate: '2026-03-31', lastCreatedInvoiceId: run.drafts[0].id, updatedAt: NOW }])
  })
  it('catches up missed periods, at most the latest twelve', () => {
    const run = prepareRecurringDrafts([rule()], [source()], profile(), '2026-05-10', NOW)
    expect(run.drafts.map((d) => d.issueDate)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
    expect(run.rules[0].nextDate).toBe('2026-05-31')
    const long = prepareRecurringDrafts([rule()], [source()], profile(), '2028-06-01', NOW)
    expect(long.drafts).toHaveLength(12)
    expect(long.drafts[0].issueDate).toBe('2027-06-30')
    expect(long.rules[0].nextDate).toBe('2028-06-30')
  })
  it('does not create a draft twice', () => {
    const first = prepareRecurringDrafts([rule()], [source()], profile(), '2026-02-28', NOW)
    const again = prepareRecurringDrafts([rule()], [source(), ...first.drafts], profile(), '2026-02-28', NOW)
    expect(again.drafts).toEqual([])
    expect(again.rules[0].nextDate).toBe('2026-03-31')
  })
  it('does not recreate a draft whose issue date was edited', () => {
    const first = prepareRecurringDrafts([rule()], [source()], profile(), '2026-02-28', NOW)
    const edited = { ...first.drafts[0], issueDate: '2026-02-27' }
    expect(prepareRecurringDrafts([rule()], [source(), edited], profile(), '2026-02-28', NOW).drafts).toEqual([])
  })
  it('skips paused rules and missing, draft or cancelled sources', () => {
    expect(prepareRecurringDrafts([rule({ active: false })], [source()], profile(), '2026-12-01', NOW).drafts).toEqual([])
    expect(prepareRecurringDrafts([rule()], [], profile(), '2026-12-01', NOW).rules).toEqual([])
    expect(prepareRecurringDrafts([rule()], [source({ status: 'cancelled' })], profile(), '2026-12-01', NOW).rules).toEqual([])
    expect(prepareRecurringDrafts([rule()], [source({ status: 'draft' })], profile(), '2026-12-01', NOW).rules).toEqual([])
    expect(prepareRecurringDrafts([rule({ nextDate: 'bad' })], [source()], profile(), '2026-12-01', NOW).rules).toEqual([])
  })
  it('paid sources keep recurring', () => {
    expect(prepareRecurringDrafts([rule()], [source({ status: 'paid', paidAt: '2026-02-01' })], profile(), '2026-02-28', NOW).drafts).toHaveLength(1)
  })
})

describe('helpers', () => {
  it('only issued invoices recur', () => {
    expect(canRecur({ type: 'invoice', status: 'issued' })).toBe(true)
    expect(canRecur({ type: 'invoice', status: 'paid' })).toBe(true)
    expect(canRecur({ type: 'prepayment', status: 'paid' })).toBe(false)
    expect(canRecur({ type: 'invoice', status: 'draft' })).toBe(false)
    expect(canRecur({ type: 'credit-note', status: 'issued' })).toBe(false)
    expect(canRecur({ type: 'quote', status: 'issued' })).toBe(false)
    expect(canRecur({ type: 'invoice', status: 'cancelled' })).toBe(false)
  })
  it('switches off the active rules of a cancelled invoice', () => {
    const rules = [rule({ id: 'a' }), rule({ id: 'b', active: false }), rule({ id: 'c', sourceInvoiceId: 'x' })]
    expect(stopRulesFor(rules, 'src', NOW)).toEqual([{ ...rule({ id: 'a' }), active: false, updatedAt: NOW }])
    expect(stopRulesFor(rules, 'none', NOW)).toEqual([])
  })
  it('finds the active rule of an invoice', () => {
    const rules = [rule({ id: 'old', active: false }), rule({ id: 'cur' }), rule({ id: 'other', sourceInvoiceId: 'x' })]
    expect(ruleForInvoice(rules, 'src')?.id).toBe('cur')
    expect(ruleForInvoice(rules.slice(0, 1), 'src')?.id).toBe('old')
    expect(ruleForInvoice(rules, 'none')).toBeUndefined()
  })
})

describe('recurring overview', () => {
  const invoices = [
    source(),
    source({ id: 'b', buyer: { ...source().buyer, name: 'Teine AS' } }),
    source({ id: 'void', status: 'cancelled' }),
    source({ id: 'draft', status: 'draft', number: '' }),
  ]

  it('lists active rules by the next draft date, then paused ones that can still be resumed', () => {
    const rules = [
      rule({ id: 'late', sourceInvoiceId: 'b', nextDate: '2026-12-01' }),
      rule({ id: 'soon', nextDate: '2026-11-01' }),
      rule({ id: 'paused', sourceInvoiceId: 'b', active: false }),
      rule({ id: 'stoppedOnCancel', sourceInvoiceId: 'void', active: false }),
      rule({ id: 'ofDraft', sourceInvoiceId: 'draft' }),
      rule({ id: 'orphan', sourceInvoiceId: 'gone' }),
    ]
    const { active, paused } = recurringOverview(rules, invoices)
    expect(active.map((e) => e.rule.id)).toEqual(['soon', 'late'])
    expect(active[0].source.id).toBe('src')
    expect(paused.map((e) => e.rule.id)).toEqual(['paused'])
  })

  it('names the next draft, skipping a rule still active on a cancelled invoice', () => {
    const rules = [rule({ id: 'v', sourceInvoiceId: 'void', nextDate: '2026-10-20' }), rule({ id: 'b', sourceInvoiceId: 'b', nextDate: '2026-11-05' })]
    expect(nextRecurring(rules, invoices)?.rule.id).toBe('b')
    expect(nextRecurring([], invoices)).toBeUndefined()
  })

  it('resumes from the next date still ahead, or from the next date of the series without catching up', () => {
    expect(resumeRule(rule({ active: false, nextDate: '2026-11-30' }), source(), '2026-10-16', NOW)).toMatchObject({ active: true, nextDate: '2026-11-30', updatedAt: NOW })
    // Paused since spring: the series of the 31st goes on after today, the missed months are not prepared.
    expect(resumeRule(rule({ active: false, nextDate: '2026-04-30' }), source(), '2026-10-16', NOW)).toMatchObject({ active: true, nextDate: '2026-10-31' })
  })

  it('undoes only what each action changed, on the rule as it is now', () => {
    const paused = rule({ active: false })
    // Pausing undone: switched on with the interval and date changed meanwhile, not the old copy.
    expect(undoPause([{ ...paused, interval: 'quarterly', nextDate: '2027-01-31' }], paused, NOW)).toMatchObject({ active: true, interval: 'quarterly', nextDate: '2027-01-31' })
    expect(undoPause([{ ...paused, active: true }], paused, NOW)).toBeNull()
    expect(undoPause([], paused, NOW)).toBeNull()

    const before = rule({ active: false, nextDate: '2026-04-30' })
    const resumed = { ...before, active: true, nextDate: '2026-10-31' }
    expect(undoResume([resumed], before, resumed, NOW)).toMatchObject({ active: false, nextDate: '2026-04-30' })
    // The next date was changed after resuming: pausing again keeps that change.
    expect(undoResume([{ ...resumed, nextDate: '2026-11-15' }], before, resumed, NOW)).toMatchObject({ active: false, nextDate: '2026-11-15' })
    expect(undoResume([{ ...resumed, active: false }], before, resumed, NOW)).toBeNull()

    const stopped = rule({ id: 'gone' })
    expect(undoStop([], stopped, NOW)).toMatchObject({ id: 'gone', active: true, updatedAt: NOW })
    // The invoice was given a new rule meanwhile: the old one is not brought back beside it.
    expect(undoStop([rule({ id: 'new' })], stopped, NOW)).toBeNull()
  })

  it("keeps today's draft when resuming on the day it is due", () => {
    // Paused with the next draft due today: resuming today prepares it (the date is not in the past).
    expect(resumeRule(rule({ active: false, nextDate: '2026-10-16' }), source(), '2026-10-16', NOW).nextDate).toBe('2026-10-16')
    // Paused for months, resumed on a date of the series: that date's draft is due now.
    expect(resumeRule(rule({ active: false, nextDate: '2026-04-30' }), source(), '2026-10-31', NOW).nextDate).toBe('2026-10-31')
    expect(upcomingOccurrence({ issueDate: '2026-01-31' }, 'monthly', '2026-10-31', { includeToday: true })).toBe('2026-10-31')
    // A rule set up today on an old invoice still starts with the next period.
    expect(upcomingOccurrence({ issueDate: '2026-01-31' }, 'monthly', '2026-10-31')).toBe('2026-11-30')
  })
})
