import { BuildingsIcon, FileTextIcon, GearSixIcon, PlusIcon, ReceiptIcon, UsersIcon } from '@phosphor-icons/react'
import { useEffect, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { CompanyProfile } from '../domain'
import { useApp } from './AppContext'
import { Skeleton } from './components/ui'
import { logoImageSrc } from './util'

const LEGAL_FORMS = /^(oü|as|mtü|fie|tü|uü|sa|ou|llc|ltd|gmbh|oy|ab)$/i

/** Two-letter monogram from the company name, without the legal form ("Päikese Tarkvara OÜ" → "PT"). */
function monogram(name: string | undefined): string {
  const words = (name ?? '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((w) => w && !LEGAL_FORMS.test(w))
  const letters = words.slice(0, 2).map((w) => w[0])
  return (letters.join('') || 'A').toUpperCase()
}

/** The company's own logo when set, otherwise a quiet monogram in the accent colour. */
export function BrandMark({ profile }: { profile: CompanyProfile | null }) {
  const logo = logoImageSrc(profile?.logoDataUrl)
  if (logo) {
    return (
      <span className="brand-mark brand-logo">
        <img src={logo} alt="" />
      </span>
    )
  }
  return (
    <span className="brand-mark" aria-hidden="true">
      {profile?.name ? monogram(profile.name) : <ReceiptIcon size={16} />}
    </span>
  )
}

function isTyping(el: Element | null): boolean {
  if (!el) return false
  const h = el as HTMLElement
  return h.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

/** "N" opens a new invoice, "/" focuses the list search, unless the user is typing or a dialog is open. */
function useShortcuts() {
  const navigate = useNavigate()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (isTyping(document.activeElement) || document.querySelector('[role="dialog"], [role="menu"]')) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        navigate('/invoices/new')
      } else if (e.key === '/') {
        const search = document.querySelector<HTMLInputElement>('[data-shortcut="search"]')
        if (!search) return
        e.preventDefault()
        search.focus()
        search.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])
}

export function Layout({ children }: { children: ReactNode }) {
  const { t, profile } = useApp()
  const location = useLocation()
  useShortcuts()

  // Arved is a full-bleed two-pane screen; its list pane carries the "data stays in this browser" note itself.
  const home = location.pathname === '/'
  const onInvoices = home || location.pathname.startsWith('/invoices')
  const nav = [
    { to: '/', label: t('nav.invoices'), icon: <FileTextIcon size={20} />, active: onInvoices },
    { to: '/clients', label: t('nav.clients'), icon: <UsersIcon size={20} /> },
    { to: '/company', label: t('nav.company'), icon: <BuildingsIcon size={20} /> },
    { to: '/settings', label: t('nav.settings'), icon: <GearSixIcon size={20} />, settings: true },
  ]

  return (
    <div className="shell">
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        {t('nav.skip')}
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label={profile?.name ? `${profile.name}, ${t('app.name')}` : t('app.name')}>
            <span className="brand-name">{profile?.name || t('app.name')}</span>
          </Link>
          <nav id="main-nav" className="main-nav" aria-label={t('nav.main')}>
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                title={n.settings ? n.label : undefined}
                className={({ isActive }) => `nav-link${n.settings ? ' nav-settings' : ''}${isActive || n.active ? ' active' : ''}`}
              >
                {n.icon}
                <span className="nav-label">{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <Link to="/invoices/new" className="btn btn-primary new-invoice" aria-keyshortcuts="N" title={t('nav.newInvoiceShortcut')}>
            <PlusIcon />
            <span>{t('nav.newInvoice')}</span>
          </Link>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={home ? 'main-flush' : undefined}>
        {children}
      </main>
      {!home && (
        <footer className="footer">
          <span>{t('footer.local')}</span>
          <Link to="/settings">{t('footer.backup')}</Link>
        </footer>
      )}
    </div>
  )
}

/** First paint while IndexedDB opens: the shell and a list-shaped placeholder instead of a spinner. */
export function BootSkeleton({ label }: { label: string }) {
  return (
    <div className="shell" role="status" aria-label={label}>
      <div className="topbar">
        <div className="topbar-inner">
          <Skeleton w={140} h={14} />
        </div>
      </div>
      <main className="main-flush">
        <div className="arved">
          <div className="arved-list sk-list">
            <Skeleton w="80%" h={14} />
            <Skeleton w={220} h={28} />
            <Skeleton w="100%" h={32} />
            {Array.from({ length: 6 }, (_, i) => (
              <div className="sk-row" key={i}>
                <Skeleton w="55%" />
                <Skeleton w="30%" />
              </div>
            ))}
          </div>
          <div className="arved-detail sk-detail">
            <Skeleton w={200} h={24} />
            <Skeleton w={160} />
            <Skeleton w={180} h={32} />
            <Skeleton w="100%" h={1} />
            <Skeleton w="70%" />
            <Skeleton w="60%" />
          </div>
        </div>
      </main>
    </div>
  )
}
