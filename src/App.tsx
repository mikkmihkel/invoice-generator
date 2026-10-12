// OWNER: UI agent.
import type { ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { Repository } from './storage'
import { AppProvider, useApp } from './ui/AppContext'
import { ConfirmProvider } from './ui/components/Dialog'
import { Layout } from './ui/Layout'
import ClientsPage from './ui/pages/ClientsPage'
import CompanyPage from './ui/pages/CompanyPage'
import InvoiceEditorRoute from './ui/pages/InvoiceEditor'
import InvoiceList from './ui/pages/InvoiceList'
import Onboarding from './ui/pages/Onboarding'
import SettingsPage from './ui/pages/SettingsPage'
import { ToastProvider } from './ui/Toasts'

/**
 * Route map (HashRouter):
 *   #/                 invoices list (home)
 *   #/invoices/new     new draft (optional ?client=<clientId>); URL becomes #/invoices/:id after first autosave
 *   #/invoices/:id     invoice editor / viewer
 *   #/clients          clients
 *   #/company          company profile
 *   #/settings         settings, backup, Google, registry
 * Without a company profile every route shows the onboarding.
 */
function Gate() {
  const { ready, profile, loadError, t } = useApp()
  if (!ready) {
    return (
      <div className="boot" role="status">
        <span className="spinner" /> {t('common.loading')}
      </div>
    )
  }
  if (loadError && !profile) {
    return (
      <div className="boot">
        <div className="card notice notice-error" role="alert">
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
      <Routes>
        <Route path="/" element={<InvoiceList />} />
        <Route path="/invoices/:id" element={<InvoiceEditorRoute />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/company" element={<CompanyPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

function Providers({ children }: { children: ReactNode }) {
  const { t } = useApp()
  return (
    <ToastProvider closeLabel={t('common.close')}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  )
}

export default function App({ repository }: { repository?: Repository } = {}) {
  return (
    <AppProvider repository={repository}>
      <HashRouter>
        <Providers>
          <Gate />
        </Providers>
      </HashRouter>
    </AppProvider>
  )
}
