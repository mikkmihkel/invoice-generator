import { IconContext } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { Repository } from './storage'
import { AppProvider, useApp } from './ui/AppContext'
import { ConfirmProvider } from './ui/components/Dialog'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { DriveConnectProvider } from './ui/google/DriveConnect'
import { NavGuardProvider } from './ui/navGuard'
import { BootSkeleton, Layout } from './ui/Layout'
import ClientsPage from './ui/pages/ClientsPage'
import CompanyPage from './ui/pages/CompanyPage'
import InvoiceEditorRoute from './ui/pages/InvoiceEditor'
import InvoiceList from './ui/pages/InvoiceList'
import Onboarding from './ui/pages/Onboarding'
import ProductsPage from './ui/pages/ProductsPage'
import SettingsPage from './ui/pages/SettingsPage'
import { ToastProvider } from './ui/Toasts'

/** Per-route boundary: a crashing page keeps the navigation usable and clears when the user navigates away. */
function RouteBoundary({ children }: { children: ReactNode }) {
  const { lang } = useApp()
  const { pathname } = useLocation()
  return (
    <ErrorBoundary scope="page" lang={lang} resetKey={pathname}>
      {children}
    </ErrorBoundary>
  )
}

/**
 * Route map (HashRouter):
 *   #/                 invoices list (home)
 *   #/invoices/new     new draft (optional ?client=<clientId>); URL becomes #/invoices/:id after first autosave
 *   #/invoices/:id     invoice editor / viewer
 *   #/clients          clients
 *   #/products         products and services catalogue
 *   #/company          company profile
 *   #/settings         settings, backup, Google, registry
 * Without a company profile every route shows the onboarding.
 */
function Gate() {
  const { ready, profile, loadError, t } = useApp()
  if (!ready) return <BootSkeleton label={t('common.loading')} />
  if (loadError && !profile) {
    return (
      <div className="boot">
        <div className="panel boot-error" role="alert">
          <h1>{t('app.loadErrorTitle')}</h1>
          <p>{t('app.loadErrorText')}</p>
          <code className="small">{loadError}</code>
        </div>
      </div>
    )
  }
  if (!profile) return <Onboarding />
  return (
    <Layout>
      <RouteBoundary>
        <Routes>
          <Route path="/" element={<InvoiceList />} />
          <Route path="/invoices/:id" element={<InvoiceEditorRoute />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/company" element={<CompanyPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </RouteBoundary>
    </Layout>
  )
}

function Providers({ children }: { children: ReactNode }) {
  const { t } = useApp()
  return (
    <ToastProvider closeLabel={t('common.close')}>
      <ConfirmProvider closeLabel={t('common.close')}>
        <NavGuardProvider>
          <DriveConnectProvider>{children}</DriveConnectProvider>
        </NavGuardProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

/** One icon style everywhere: Phosphor regular, 16 px, decorative (labels carry the meaning). */
const ICONS = { size: 16, weight: 'regular', 'aria-hidden': true, focusable: false } as const

export default function App({ repository }: { repository?: Repository } = {}) {
  return (
    <ErrorBoundary scope="app">
      <IconContext.Provider value={ICONS}>
        <AppProvider repository={repository}>
          <HashRouter>
            <Providers>
              <Gate />
            </Providers>
          </HashRouter>
        </AppProvider>
      </IconContext.Provider>
    </ErrorBoundary>
  )
}
