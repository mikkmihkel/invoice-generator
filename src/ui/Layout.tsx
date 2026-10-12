import { BuildingsIcon, FileTextIcon, GearSixIcon, PlusIcon, ReceiptIcon, UsersIcon } from '@phosphor-icons/react'
import { useEffect, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { CompanyProfile } from '../domain'
import { useApp } from './AppContext'
import { Kbd, Skeleton } from './components/ui'
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
  const { t, lang, saveSettings, profile } = useApp()
  const location = useLocation()
  useShortcuts()

  const nav = [
    { to: '/', label: t('nav.invoices'), icon: <FileTextIcon size={18} />, end: true },
    { to: '/clients', label: t('nav.clients'), icon: <UsersIcon size={18} /> },
    { to: '/company', label: t('nav.company'), icon: <BuildingsIcon size={18} /> },
    { to: '/settings', label: t('nav.settings'), icon: <GearSixIcon size={18} /> },
  ]
  const onEditor = location.pathname.startsWith('/invoices')

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
          <Link to="/" className="brand" aria-label={t('app.name')}>
            <BrandMark profile={profile} />
            <span className="brand-text">
              <span className="brand-name">{t('app.name')}</span>
              {profile?.name && <span className="brand-company">{profile.name}</span>}
            </span>
          </Link>
          <nav id="main-nav" className="main-nav" aria-label={t('nav.main')}>
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive || (n.to === '/' && onEditor) ? ' active' : ''}`}>
                {n.icon}
                <span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="topbar-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm lang-toggle"
              onClick={() => void saveSettings({ uiLanguage: lang === 'et' ? 'en' : 'et' })}
              aria-label={t('nav.switchLanguage')}
              title={t('nav.switchLanguage')}
              lang={lang === 'et' ? 'en' : 'et'}
            >
              {lang === 'et' ? 'EN' : 'ET'}
            </button>
            <Link to="/invoices/new" className="btn btn-primary new-invoice" aria-keyshortcuts="N" title={t('nav.newInvoiceShortcut')}>
              <PlusIcon />
              <span>{t('nav.newInvoice')}</span>
              <Kbd>N</Kbd>
            </Link>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="footer">
        <span>{t('footer.local')}</span>
        <Link to="/settings">{t('footer.backup')}</Link>
      </footer>
    </div>
  )
}

/** First paint while IndexedDB opens: the shell and a ledger-shaped placeholder instead of a spinner. */
export function BootSkeleton({ label }: { label: string }) {
  return (
    <div className="shell" role="status" aria-label={label}>
      <div className="topbar">
        <div className="topbar-inner">
          <Skeleton w={28} h={28} />
          <Skeleton w={120} h={14} />
        </div>
      </div>
      <main>
        <div className="page">
          <Skeleton w={140} h={24} className="sk-title" />
          <div className="sk-figures">
            <Skeleton w="70%" h={36} />
            <Skeleton w="70%" h={36} />
            <Skeleton w="70%" h={36} />
          </div>
          <div className="panel sk-table">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="sk-row" key={i}>
                <Skeleton w={80} />
                <Skeleton w="40%" />
                <Skeleton w={70} />
                <Skeleton w={90} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
