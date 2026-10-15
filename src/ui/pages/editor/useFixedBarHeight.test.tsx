import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFixedBarHeight } from './useFixedBarHeight'

let resize: (() => void) | null = null

class FakeResizeObserver {
  constructor(cb: () => void) {
    resize = cb
  }
  observe() {}
  disconnect() {
    resize = null
  }
}

function Bar({ height, position }: { height: number; position: 'fixed' | 'sticky' }) {
  const ref = useFixedBarHeight()
  return (
    <aside
      ref={(el) => {
        if (el) el.getBoundingClientRect = () => ({ height }) as DOMRect
        return ref(el)
      }}
      style={{ position }}
    />
  )
}

const live = () => document.documentElement.style.getPropertyValue('--ed-bar-live')

describe('useFixedBarHeight', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('publishes the pinned bar height, follows resizes and clears it when the bar is in the flow or gone', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const { container, unmount } = render(<Bar height={140.2} position="fixed" />)
    expect(live()).toBe('141px')

    const bar = container.querySelector('aside')!
    bar.getBoundingClientRect = () => ({ height: 315 }) as DOMRect
    act(() => resize?.())
    expect(live()).toBe('315px')

    bar.style.position = 'sticky'
    act(() => window.dispatchEvent(new Event('resize')))
    expect(live()).toBe('')

    bar.style.position = 'fixed'
    bar.getBoundingClientRect = () => ({ height: 200 }) as DOMRect
    act(() => window.dispatchEvent(new Event('resize')))
    expect(live()).toBe('200px')
    unmount()
    expect(live()).toBe('')
  })

  it('does nothing without ResizeObserver (the CSS estimate applies)', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    render(<Bar height={300} position="fixed" />)
    expect(live()).toBe('')
  })
})
