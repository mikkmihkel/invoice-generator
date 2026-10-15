import { CaretDownIcon, DotsThreeIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { MENU_SHEET_QUERY, menuOffset, VIEWPORT_GAP } from './menuPlacement'

/** Icon-only button: the label is both the accessible name and the hover tooltip. */
export function IconButton({ label, icon, className, ...rest }: { label: string; icon: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button type="button" className={`icon-btn${className ? ' ' + className : ''}`} aria-label={label} title={label} {...rest}>
      {icon}
    </button>
  )
}

/** Visual keyboard hint; the real shortcut is announced with aria-keyshortcuts on the control. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="kbd" aria-hidden="true">
      {children}
    </kbd>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
  count?: number
}

/** Single-choice segmented control built on native radio inputs. */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
  disabled,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: SegmentOption<T>[]
  className?: string
  disabled?: boolean
}) {
  const name = useId()
  return (
    <div className={`segmented${className ? ' ' + className : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className={value === o.value ? 'selected' : undefined}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} disabled={disabled} />
          {o.label}
          {o.count != null && <span className="seg-count">{o.count}</span>}
        </label>
      ))}
    </div>
  )
}

/** Search box for list pages. "/" focuses it (see the shell's shortcuts). */
export function SearchField({ value, onChange, label, placeholder, shortcutHint }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; shortcutHint?: string }) {
  return (
    <div className="search-field">
      <MagnifyingGlassIcon className="search-icon" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-shortcut="search"
        aria-keyshortcuts="/"
        title={shortcutHint}
      />
      {!value && <Kbd>/</Kbd>}
    </div>
  )
}

export interface MenuItem {
  key: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

/**
 * Overflow menu (menu button pattern): arrow keys move, Escape closes and returns focus to the button.
 * With `text` the trigger is a quiet text button ("Rohkem ▾") instead of the icon-only "…" button.
 * The popup is measured on open and kept inside the viewport; on phones it is a bottom sheet.
 */
export function Menu({ label, items, disabled, text, align = 'end' }: { label: string; items: MenuItem[]; disabled?: boolean; text?: string; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined)
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()

  // Before paint: position the popup so it never widens the page (no sideways scroll on phones/tablets).
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const el = menu.current
      const w = wrap.current
      if (!el || !w) return
      if (typeof window.matchMedia === 'function' && window.matchMedia(MENU_SHEET_QUERY).matches) {
        setPlace(undefined)
        return
      }
      const viewport = document.documentElement.clientWidth || window.innerWidth
      const width = Math.min(el.offsetWidth, viewport - 2 * VIEWPORT_GAP)
      const r = w.getBoundingClientRect()
      setPlace({ left: menuOffset(r, width, viewport, align), right: 'auto', maxWidth: viewport - 2 * VIEWPORT_GAP })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!menu.current?.contains(target) && !btn.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    btn.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    const i = list.indexOf(document.activeElement as HTMLElement)
    const move = (n: number) => {
      e.preventDefault()
      list[(n + list.length) % list.length]?.focus()
    }
    if (e.key === 'ArrowDown') move(i + 1)
    else if (e.key === 'ArrowUp') move(i - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(list.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={wrap} className={`menu-wrap${align === 'start' ? ' menu-start' : ''}`}>
      <button
        ref={btn}
        type="button"
        className={text ? 'btn btn-text' : 'btn btn-icon'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={text ? undefined : label}
        title={text ? undefined : label}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {text ? (
          <>
            {text}
            <CaretDownIcon size={12} className="menu-caret" />
          </>
        ) : (
          <DotsThreeIcon size={18} />
        )}
      </button>
      {open && <div className="menu-backdrop" aria-hidden="true" />}
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={label} className="menu" style={place} onKeyDown={onKeyDown}>
          {items.map((it) => (
            <Fragment key={it.key}>
              {it.separatorBefore && <div role="separator" className="menu-sep" />}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`menu-item${it.danger ? ' menu-item-danger' : ''}`}
                disabled={it.disabled}
                onClick={() => {
                  close()
                  it.onSelect()
                }}
              >
                {it.icon}
                <span>{it.label}</span>
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

/** Composed empty state: what this place is for and how to start. */
export function EmptyState({ icon, title, children, actions, headingLevel = 2 }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; headingLevel?: 1 | 2 }) {
  const H = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <H className="empty-title">{title}</H>
      {children && <div className="empty-body">{children}</div>}
      {actions && <div className="btn-row empty-actions">{actions}</div>}
    </div>
  )
}

/** Placeholder block for loading states; layout-matching skeletons are composed from these. */
export function Skeleton({ w, h = 12, className }: { w?: number | string; h?: number; className?: string }) {
  return <span className={`skeleton${className ? ' ' + className : ''}`} style={{ width: w, height: h }} aria-hidden="true" />
}

/** Live amount display: tabular figures, never wrapped. */
export function Amount({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`amount${className ? ' ' + className : ''}`}>{children}</span>
}

/** Loading spinner with an accessible label. */
export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} />
}
