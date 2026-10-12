import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useApp } from './AppContext'

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" className="brand-mark">
      <rect x="5" y="2.5" width="22" height="27" rx="4" fill="var(--primary)" />
      <path d="M10 10h12M10 15h12M10 20h7" stroke="var(--primary-contrast)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { t, lang, saveSettings, profile } = useApp()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => setMenuOpen(false), [location.pathname])

  const nav = [
    { to: '/', label: t('nav.invoices'), end: true },
    { to: '/clients', label: t('nav.clients') },
    { to: '/company', label: t('nav.company') },
    { to: '/settings', label: t('nav.settings') },
  ]

  return (
    <div className="shell">
      <a href="#main" className="skip-link" onClick={(e) => {
        e.preventDefault()
        document.getElementById('main')?.focus()
      }}>
        {t('nav.skip')}
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label={t('app.name')}>
            <Logo />
            <span className="brand-text">
              <span className="brand-name">{t('app.name')}</span>
              {profile?.name && <span className="brand-company">{profile.name}</span>}
            </span>
          </Link>
          <button type="button" className="icon-btn menu-toggle" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen((o) => !o)} aria-label={t('nav.menu')}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <nav id="main-nav" className={`main-nav${menuOpen ? ' open' : ''}`} aria-label={t('nav.main')}>
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive || (n.to === '/' && location.pathname.startsWith('/invoices')) ? ' active' : ''}`}>
                {n.label}
              </NavLink>
            ))}
            <button type="button" className="lang-toggle" onClick={() => void saveSettings({ uiLanguage: lang === 'et' ? 'en' : 'et' })} aria-label={t('nav.switchLanguage')} lang={lang === 'et' ? 'en' : 'et'}>
              {lang === 'et' ? 'EN' : 'ET'}
            </button>
          </nav>
          <Link to="/invoices/new" className="btn btn-primary new-invoice">
            <span aria-hidden="true">+</span> <span className="new-invoice-label">{t('nav.newInvoice')}</span>
          </Link>
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
