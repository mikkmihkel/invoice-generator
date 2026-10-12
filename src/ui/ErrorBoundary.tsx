import { Component, type ErrorInfo, type ReactNode } from 'react'
import type { UiLanguage } from '../domain'
import { translate } from './i18n'

interface Props {
  children: ReactNode
  /** UI language. The top-level boundary sits outside AppProvider and falls back to the document language. */
  lang?: UiLanguage
  /** 'app' = full-screen fallback; 'page' = inside the layout, so the navigation stays usable. */
  scope?: 'app' | 'page'
  /** A change (e.g. the route path) clears a caught error. */
  resetKey?: string
}

interface State {
  error: Error | null
  resetKey?: string
}

/** Catches render errors and shows a calm screen with reload and backup options instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const lang = this.props.lang ?? (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'et')
    return <ErrorScreen error={error} lang={lang} scope={this.props.scope ?? 'app'} onReset={this.reset} />
  }
}

function ErrorScreen({ error, lang, scope, onReset }: { error: Error; lang: UiLanguage; scope: 'app' | 'page'; onReset: () => void }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key)
  const Heading = scope === 'app' ? 'h1' : 'h2'
  return (
    <div className={scope === 'app' ? 'boot' : 'page'}>
      <div className="card error-screen" role="alert" lang={lang}>
        <Heading>{t('error.title')}</Heading>
        <p>{t(scope === 'app' ? 'error.text' : 'error.pageText')}</p>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            {t('error.reload')}
          </button>
          {/* Plain link: works even when the router is what failed. */}
          <a className="btn" href="#/settings" onClick={onReset}>
            {t('error.backupLink')}
          </a>
        </div>
        <details>
          <summary>{t('common.details')}</summary>
          <pre className="small error-message">{error.message || error.name}</pre>
        </details>
      </div>
    </div>
  )
}
