import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSettings, type BackupFile, type Invoice } from '../domain'
import { AppProvider } from './AppContext'
import { TemplatePicker } from './components/Appearance'
import { Dialog } from './components/Dialog'
import { LogoInput } from './components/misc'
import { ErrorBoundary } from './ErrorBoundary'
import { ToastProvider } from './Toasts'
import { keepClientId, paymentDetailChanges } from './pages/backupReview'
import { redateInvoice } from './pages/editor/builders'
import { useAutosave } from './pages/editor/useAutosave'
import { createMemoryRepo, sampleProfile } from './testing/memoryRepo'
import { accentColor, logoImageSrc, normalizeInvoice, reconcileList, roundTo } from './util'

vi.mock('../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage')>()),
  subscribe: () => () => undefined,
}))
vi.mock('../pdf', async () => (await import('./testing/mocks')).pdfMock())

afterEach(cleanup)

function Boom({ message = 'kaboom' }: { message?: string }): never {
  throw new Error(message)
}

describe('ErrorBoundary', () => {
  it('shows a calm Estonian screen with reload, backup link and collapsed details', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <ErrorBoundary lang="et">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Midagi läks valesti')
    expect(screen.getByText(/salvestatud andmed on selles brauseris alles/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Laadi leht uuesti' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ava seaded ja tee varukoopia' })).toHaveAttribute('href', '#/settings')
    const details = screen.getByText('kaboom').closest('details')!
    expect(details).not.toHaveAttribute('open')
    vi.restoreAllMocks()
  })

  it('speaks English and resets when the reset key (route) changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { rerender } = render(
      <ErrorBoundary lang="en" scope="page" resetKey="/a">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    rerender(
      <ErrorBoundary lang="en" scope="page" resetKey="/b">
        <p>fine</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeInTheDocument()
    vi.restoreAllMocks()
  })
})

describe('Dialog', () => {
  it('cannot be dismissed with Escape, the backdrop or × while not dismissible', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Dialog title="T" onClose={onClose} dismissible={false}>
        body
      </Dialog>,
    )
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.mouseDown(document.querySelector('.dialog-backdrop')!)
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    expect(onClose).not.toHaveBeenCalled()
    rerender(
      <Dialog title="T" onClose={onClose}>
        body
      </Dialog>,
    )
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useAutosave', () => {
  it('keeps one save in flight and then saves only the latest value', async () => {
    const first = deferred()
    const save = vi.fn((v: string) => (v === 'a' ? first.promise : Promise.resolve()))
    const { result, rerender } = renderHook(({ v }) => useAutosave(v, { save }), { initialProps: { v: 'a' } })
    let p1!: Promise<boolean>, p2!: Promise<boolean>, p3!: Promise<boolean>
    await act(async () => {
      result.current.markDirty()
      p1 = result.current.flush()
    })
    expect(save).toHaveBeenCalledWith('a')
    rerender({ v: 'b' })
    act(() => {
      result.current.markDirty()
      p2 = result.current.flush()
    })
    rerender({ v: 'c' })
    act(() => {
      result.current.markDirty()
      p3 = result.current.flush()
    })
    await act(async () => {})
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => {
      first.resolve()
      await Promise.all([p1, p2, p3])
    })
    expect(save.mock.calls.map((c) => c[0])).toEqual(['a', 'c'])
    expect(result.current.state).toBe('saved')
  })

  it('reports failures, keeps the changes dirty and succeeds on retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const onError = vi.fn()
    const { result } = renderHook(() => useAutosave('x', { save, onError }))
    act(() => result.current.markDirty())
    let ok = true
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(false)
    expect(result.current.state).toBe('error')
    expect(onError).toHaveBeenCalledWith(expect.any(Error), true)
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
    expect(result.current.state).toBe('saved')
  })

  it('discard waits for the in-flight save and stops further saves', async () => {
    const d = deferred()
    const save = vi.fn(() => d.promise)
    const { result } = renderHook(() => useAutosave('x', { save }))
    await act(async () => {
      result.current.markDirty()
      void result.current.flush()
    })
    expect(save).toHaveBeenCalledTimes(1)
    let done = false
    const discarding = result.current.discard().then(() => {
      done = true
    })
    await Promise.resolve()
    expect(done).toBe(false)
    await act(async () => {
      d.resolve()
      await discarding
    })
    expect(done).toBe(true)
    act(() => result.current.markDirty())
    await act(async () => {
      await result.current.flush()
    })
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('util', () => {
  it('rounds half away from zero to the printed precision', () => {
    expect(roundTo(1.23456, 3)).toBe(1.235)
    expect(roundTo(10.123456, 4)).toBe(10.1235)
    expect(roundTo(-2.0005, 3)).toBe(-2.001)
    expect(roundTo(1.005, 2)).toBe(1.01)
  })

  it('normalizes malformed invoice records for display', () => {
    const inv = normalizeInvoice({ id: 'x', status: 'draft' } as unknown as Invoice)
    expect(inv).toMatchObject({ issueDate: '', dueDate: '', lines: [], bankAccountIds: [], number: '', buyer: { name: '' }, seller: { bankAccounts: [] } })
  })

  it('keeps unchanged items and the list itself when id + updatedAt match', () => {
    const a = { id: 'a', updatedAt: '1' }
    const b = { id: 'b', updatedAt: '1' }
    const prev = [a, b]
    expect(reconcileList(prev, [{ ...a }, { ...b }])).toBe(prev)
    const next = reconcileList(prev, [{ ...a }, { id: 'b', updatedAt: '2' }])
    expect(next).not.toBe(prev)
    expect(next[0]).toBe(a)
    expect(reconcileList(prev, [{ ...b }, { ...a }])).toEqual([b, a])
  })

  it('only lets embedded PNG/JPEG logos and #rrggbb accents reach the DOM', () => {
    expect(logoImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(logoImageSrc('data:image/jpeg;base64,AAAA')).toBeDefined()
    expect(logoImageSrc('https://evil.example/pixel.png')).toBeUndefined()
    expect(logoImageSrc('data:image/svg+xml;base64,AAAA')).toBeUndefined()
    expect(accentColor('#12abEF')).toBe('#12abEF')
    expect(accentColor('red;background:url(https://x)')).toBe('#1f6feb')
  })
})

describe('logo and accent sinks', () => {
  it('render no remote logo and no unsafe accent', () => {
    render(
      <AppProvider repository={createMemoryRepo()}>
        <ToastProvider>
          <LogoInput value="https://evil.example/track.png" onChange={() => undefined} />
          <TemplatePicker value="classic" onChange={() => undefined} accent="url(https://evil.example/x)" />
        </ToastProvider>
      </AppProvider>,
    )
    expect(document.querySelector('img')).toBeNull()
    expect(document.body.innerHTML).not.toContain('evil.example')
  })
})

describe('redateInvoice', () => {
  const inv = { issueDate: '2026-09-01', dueDate: '2026-09-15', supplyDate: '2026-09-01' } as Invoice
  it('keeps the payment term and moves a supply date equal to the issue date', () => {
    expect(redateInvoice(inv, '2026-10-12')).toMatchObject({ issueDate: '2026-10-12', dueDate: '2026-10-26', supplyDate: '2026-10-12' })
  })
  it('leaves a different supply date alone', () => {
    expect(redateInvoice({ ...inv, supplyDate: '2026-08-20' }, '2026-10-12').supplyDate).toBe('2026-08-20')
  })
})

describe('backup review', () => {
  const profile = sampleProfile()
  const settings = { ...createDefaultSettings(), googleClientId: '1-own.apps.googleusercontent.com' }
  const backup = (patch: Partial<BackupFile> = {}): BackupFile => ({
    app: 'invoice-generator',
    version: 1,
    exportedAt: '2026-10-01T00:00:00Z',
    profile,
    clients: [],
    invoices: [],
    settings,
    ...patch,
  })

  it('reports nothing for identical payment data', () => {
    expect(paymentDetailChanges({ profile, settings }, backup())).toEqual([])
  })

  it('lists changed IBANs, VAT number and client ID (old → new)', () => {
    const changed = backup({
      profile: { ...profile, vatNumber: 'EE100931558', bankAccounts: [{ id: 'x', iban: 'EE471000001020145685' }] },
      settings: { ...settings, googleClientId: '2-evil.apps.googleusercontent.com' },
    })
    expect(paymentDetailChanges({ profile, settings }, changed)).toEqual([
      { field: 'vatNumber', from: profile.vatNumber, to: 'EE100931558' },
      { field: 'ibans', from: 'EE38 2200 2210 2014 5685', to: 'EE47 1000 0010 2014 5685' },
      { field: 'googleClientId', from: '1-own.apps.googleusercontent.com', to: '2-evil.apps.googleusercontent.com' },
    ])
  })

  it('keeps the current client ID unless asked', () => {
    const b = backup({ settings: { ...settings, googleClientId: '2-evil.apps.googleusercontent.com' } })
    expect(keepClientId(b, '1-own.apps.googleusercontent.com').settings?.googleClientId).toBe('1-own.apps.googleusercontent.com')
    expect(keepClientId(b, undefined).settings).not.toHaveProperty('googleClientId')
  })
})
