import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRepository } from '../storage'
import { AppProvider, useApp } from './AppContext'

afterEach(cleanup)

function Probe() {
  const { ready, products, recurringRules, invoiceEvents } = useApp()
  if (!ready) return null
  return (
    <ul>
      <li>products: {products.map((p) => p.description).join(', ')}</li>
      <li>rules: {recurringRules.map((r) => r.nextDate).join(', ')}</li>
      <li>events: {invoiceEvents.map((e) => e.kind).join(', ')}</li>
    </ul>
  )
}

const ts = '2026-10-01T00:00:00.000Z'

describe('AppProvider catalogue, recurring rules and events', () => {
  it('loads them and follows writes made directly through the repository', async () => {
    const repo = createRepository({ dbName: `ctx-${Math.random()}` })
    await repo.saveProduct({ id: 'p1', description: 'Arendus', unit: 'h', unitPrice: 60, createdAt: ts, updatedAt: ts })
    render(
      <AppProvider repository={repo}>
        <Probe />
      </AppProvider>,
    )
    expect(await screen.findByText('products: Arendus')).toBeInTheDocument()

    await repo.saveProduct({ id: 'p2', description: 'Analüüs', unit: 'h', unitPrice: 70, createdAt: ts, updatedAt: ts })
    await repo.saveRecurringRule({ id: 'r1', sourceInvoiceId: 'i1', interval: 'monthly', nextDate: '2026-11-01', active: true, createdAt: ts, updatedAt: ts })
    await repo.addInvoiceEvent({ id: 'e1', invoiceId: 'i1', kind: 'reminder', at: ts })
    await waitFor(() => expect(screen.getByText('products: Analüüs, Arendus')).toBeInTheDocument())
    expect(screen.getByText('rules: 2026-11-01')).toBeInTheDocument()
    expect(screen.getByText('events: reminder')).toBeInTheDocument()

    await repo.deleteProduct('p1')
    await waitFor(() => expect(screen.getByText('products: Analüüs')).toBeInTheDocument())
  })
})
