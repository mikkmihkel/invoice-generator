import { describe, expect, it } from 'vitest'
import { makeInvoice, makeProfile } from '../../../storage/testFixtures'
import { creditNoteFor, duplicateInvoice } from './builders'

describe('copies of a reopened document', () => {
  const reopened = makeInvoice('src', { number: 'A-001', status: 'draft', reopenedAt: '2026-03-11T10:00:00.000Z', reopenedIssueDate: '2026-03-10' })

  it('do not carry its reopening over', () => {
    for (const copy of [duplicateInvoice(reopened, makeProfile()), creditNoteFor({ ...reopened, status: 'issued' }, makeProfile())]) {
      expect(copy.number).toBe('')
      expect(copy).not.toHaveProperty('reopenedAt')
      expect(copy).not.toHaveProperty('reopenedIssueDate')
    }
  })
})
