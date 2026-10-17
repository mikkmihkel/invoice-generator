import { ArrowRightIcon, CheckCircleIcon, CheckIcon, FolderOpenIcon, SignInIcon } from '@phosphor-icons/react'
import { chosenDriveFolder, driveFolderLabel } from '../../integrations/googleClient'
import { useApp } from '../AppContext'
import { useDriveConnect } from './driveConnectContext'
import { useGoogleAccount } from './useGoogleAccount'

/**
 * First onboarding step when Google sign-in is available: why to keep the data in one's own Drive, with "Sign in
 * with Google" first and "Continue without an account" next to it. Signing in also chooses the folder and, when
 * Drive already has backups (a new computer), offers to restore them.
 */
export function OnboardingDriveStep({ onNext }: { onNext: () => void }) {
  const { t, settings } = useApp()
  const account = useGoogleAccount()
  const { connect, busy } = useDriveConnect()

  const signIn = async () => {
    if ((await connect()) === 'connected') onNext()
  }

  if (account.signedIn) {
    const folder = chosenDriveFolder(settings)
    return (
      <div className="panel onb-drive">
        <p className="status-line status-ok">
          <CheckCircleIcon />
          {folder
            ? t('gdrive.onbConnected', { email: account.email ?? '', folder: driveFolderLabel(settings, 'pdf') })
            : t('gdrive.onbConnectedNoFolder', { email: account.email ?? '' })}
        </p>
        <div className="onb-drive-actions">
          <button type="button" className="btn btn-primary" onClick={onNext}>
            {t('common.next')}
            <ArrowRightIcon />
          </button>
          {!folder && (
            <button type="button" className="btn" onClick={() => void connect({ chooseFolder: true })} disabled={busy}>
              <FolderOpenIcon />
              {t('gdrive.chooseFolder')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="panel onb-drive">
      <ul className="onb-benefits">
        {(['gdrive.benefitFiles', 'gdrive.benefitRestore', 'gdrive.benefitPrivate'] as const).map((key) => (
          <li key={key}>
            <CheckIcon size={16} />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      <p className="field-hint">{t('gdrive.onbBackupNote')}</p>
      <div className="onb-drive-actions">
        <button type="button" className="btn btn-primary" onClick={() => void signIn()} disabled={busy} data-autofocus>
          <SignInIcon />
          {busy ? t('common.working') : t('gdrive.signIn')}
        </button>
        <button type="button" className="btn" onClick={onNext}>
          {t('gdrive.continueWithout')}
        </button>
      </div>
      <p className="field-hint">{t('gdrive.withoutHint')}</p>
    </div>
  )
}
