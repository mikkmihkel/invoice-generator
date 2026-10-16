import { CloudArrowUpIcon, SignInIcon, XIcon } from '@phosphor-icons/react'
import { useId, useState } from 'react'
import { useApp } from '../AppContext'
import { IconButton } from '../components/ui'
import { useDriveConnect } from './driveConnectContext'
import { dismissNudge, isNudgeDismissed } from './nudge'
import { useGoogleAccount } from './useGoogleAccount'

/**
 * "Keep your invoices in your Google Drive": shown while Google sign-in is available but the user has never
 * signed in in this browser. Dismissing hides it for 30 days.
 */
export function DriveNudge() {
  const { t } = useApp()
  const account = useGoogleAccount()
  const { connect, busy } = useDriveConnect()
  const [hidden, setHidden] = useState(isNudgeDismissed)
  const id = useId()
  if (!account.available || account.connected || hidden) return null
  return (
    <aside className="drive-nudge" aria-labelledby={id}>
      <span className="drive-nudge-icon" aria-hidden="true">
        <CloudArrowUpIcon size={20} />
      </span>
      <div className="drive-nudge-text">
        <strong id={id}>{t('gdrive.nudgeTitle')}</strong>
        <p>{t('gdrive.nudgeText')}</p>
        <button type="button" className="btn btn-primary btn-sm drive-nudge-cta" onClick={() => void connect()} disabled={busy}>
          <SignInIcon />
          {t('gdrive.signIn')}
        </button>
      </div>
      <IconButton
        className="drive-nudge-close"
        label={t('gdrive.nudgeDismiss')}
        icon={<XIcon />}
        onClick={() => {
          dismissNudge()
          setHidden(true)
        }}
      />
    </aside>
  )
}
