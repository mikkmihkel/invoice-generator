import { ArrowsClockwiseIcon, FolderOpenIcon, GearSixIcon, SignOutIcon, UserCircleIcon } from '@phosphor-icons/react'
import { googleSignOut } from '../../integrations/googleAuth'
import { driveFolderUrl } from '../../integrations/googleClient'
import { useApp } from '../AppContext'
import { Menu, type MenuItem } from '../components/ui'
import { useGuardedNavigation } from '../navGuard'
import { useToast } from '../Toasts'
import { useDriveConnect } from './driveConnectContext'
import { revealSection, useGoogleAccount } from './useGoogleAccount'

/**
 * Top bar: the signed-in Google account (initial, and the e-mail address where there is room) with a menu to
 * reconnect, open the Drive folder, open the Google settings or sign out. Hidden when not signed in.
 */
export function AccountChip() {
  const { t, settings } = useApp()
  const toast = useToast()
  const account = useGoogleAccount()
  const { connect } = useDriveConnect()
  const { go } = useGuardedNavigation()
  if (!account.available || !account.connected) return null

  const email = account.email ?? t('gdrive.account')
  const folder = settings.driveFolder
  const items: MenuItem[] = [{ key: 'who', label: email, icon: <UserCircleIcon />, onSelect: () => {}, disabled: true }]
  if (!account.signedIn) items.push({ key: 'reconnect', label: t('gdrive.reconnect'), icon: <ArrowsClockwiseIcon />, onSelect: () => void connect() })
  if (folder) {
    items.push({
      key: 'folder',
      label: t('gdrive.openFolder'),
      icon: <FolderOpenIcon />,
      onSelect: () => window.open(driveFolderUrl(folder.id), '_blank', 'noopener,noreferrer'),
    })
  }
  items.push({
    key: 'settings',
    label: t('gdrive.openSettings'),
    icon: <GearSixIcon />,
    onSelect: () => {
      go('/settings')
      revealSection('set-google')
    },
  })
  items.push({
    key: 'signout',
    label: t('gdrive.signOut'),
    icon: <SignOutIcon />,
    separatorBefore: true,
    onSelect: () => void googleSignOut().then(() => toast.info(t('gdrive.signedOut'))),
  })
  const label = [t('gdrive.accountLabel', { email }), account.signedIn ? '' : t('gdrive.notConnectedNow')].filter(Boolean).join(', ')

  return (
    <div className="acct">
      <Menu
        label={label}
        items={items}
        triggerClassName={`acct-chip${account.signedIn ? '' : ' acct-idle'}`}
        trigger={
          <>
            <span className="acct-avatar" aria-hidden="true">
              {(account.email?.[0] ?? 'G').toUpperCase()}
            </span>
            <span className="acct-email">{email}</span>
          </>
        }
      />
    </div>
  )
}
