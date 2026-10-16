import { ArrowSquareOutIcon, CaretRightIcon, CheckCircleIcon, CircleIcon, FolderOpenIcon, SignInIcon, SignOutIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { normalizeAutoBackup } from '../../../integrations/autoBackup'
import { googleSignOut } from '../../../integrations/googleAuth'
import { canSendWithGmail, driveFolderLabel, driveFolderUrl } from '../../../integrations/googleClient'
import { useApp } from '../../AppContext'
import { CheckboxField, TextField } from '../../components/fields'
import { Section } from '../../components/misc'
import { useDriveConnect } from '../../google/driveConnectContext'
import { revealSection, useGoogleAccount } from '../../google/useGoogleAccount'
import { useToast } from '../../Toasts'
import { errorMessage } from '../../util'
import { GOOGLE_CLIENT_ID_RE } from '../backupReview'
import { GOOGLE_SETUP_URL } from '../SettingsPage'

/** "Advanced": the user's own OAuth client ID (overrides the built-in client; enables Gmail) and the folder name. */
function OwnClient({ showFolderName }: { showFolderName: boolean }) {
  const { t, settings, saveSettings } = useApp()
  const toast = useToast()
  const [clientId, setClientId] = useState(settings.googleClientId ?? '')
  const [folder, setFolder] = useState(settings.driveFolderName)
  const [busy, setBusy] = useState(false)
  const clientIdError = clientId.trim() && !GOOGLE_CLIENT_ID_RE.test(clientId.trim()) ? t('google.clientIdInvalid') : undefined

  const save = async () => {
    if (clientIdError) {
      toast.error(clientIdError)
      return
    }
    setBusy(true)
    try {
      await saveSettings({ googleClientId: clientId.trim() || undefined, driveFolderName: folder.trim() || settings.driveFolderName })
      toast.success(t('common.saved'))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="disclosure-body stack-sm">
      <p>{t('gdrive.advancedIntro')}</p>
      <ol className="howto">
        <li>{t('google.step1')}</li>
        <li>{t('google.step2')}</li>
        <li>{t('google.step3')}</li>
      </ol>
      <p>
        <a href={GOOGLE_SETUP_URL} target="_blank" rel="noreferrer" className="ext-link">
          {t('google.guideLink')}
          <ArrowSquareOutIcon size={14} />
        </a>
      </p>
      <div className="grid">
        <TextField className="span-2" label={t('google.clientId')} value={clientId} onChange={setClientId} placeholder="123456789-abc.apps.googleusercontent.com" spellCheck={false} error={clientIdError} />
        {showFolderName && <TextField label={t('google.folder')} value={folder} onChange={setFolder} hint={t('google.folderHint')} />}
      </div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => void save()} disabled={busy}>
          {t('common.save')}
        </button>
      </div>
      {canSendWithGmail(settings) && (
        <p className="status-line status-ok">
          <CheckCircleIcon />
          {t('gdrive.gmailOn')}
        </p>
      )}
    </div>
  )
}

/**
 * Settings → Google: account, Drive folder, automatic PDF saving, a pointer to automatic backup, and the user's own
 * client ID as an advanced option.
 */
export function GoogleSection() {
  const { t, settings, saveSettings } = useApp()
  const toast = useToast()
  const account = useGoogleAccount()
  const { connect, busy } = useDriveConnect()
  const folder = settings.driveFolder
  const backup = normalizeAutoBackup(settings.autoBackup)
  // Open when there is nothing else to use, or the user already set their own client.
  const [advancedOpen] = useState(() => !account.available || !!settings.googleClientId)

  const signOut = async () => {
    await googleSignOut()
    toast.info(t('gdrive.signedOut'))
  }

  const accountText = account.signedIn
    ? t('gdrive.signedInAs', { email: account.email ?? '' })
    : account.connected
      ? t('gdrive.rememberedAs', { email: account.email ?? '' })
      : t('gdrive.notSignedIn')

  return (
    <Section id="set-google" title={t('gdrive.settingsTitle')} description={t('gdrive.settingsIntro')}>
      {!account.available && <p className="notice notice-info">{t('gdrive.noClient')}</p>}
      {account.available && (
        <>
          <div className="setting-row">
            <div>
              <strong>{t('gdrive.accountTitle')}</strong>
              <p className={`status-line${account.signedIn ? ' status-ok' : ''}`}>
                {account.signedIn ? <CheckCircleIcon /> : <CircleIcon />}
                {accountText}
              </p>
            </div>
            <div className="btn-row">
              {!account.signedIn && (
                <button type="button" className="btn btn-primary" onClick={() => void connect()} disabled={busy}>
                  <SignInIcon />
                  {account.connected ? t('gdrive.reconnect') : t('gdrive.signIn')}
                </button>
              )}
              {account.connected && (
                <button type="button" className="btn" onClick={() => void signOut()}>
                  <SignOutIcon />
                  {t('gdrive.signOut')}
                </button>
              )}
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>{t('gdrive.folderRow')}</strong>
              {folder ? (
                <>
                  <p className="setting-desc drive-folder-name">
                    <FolderOpenIcon />
                    {folder.name}
                  </p>
                  <p className="setting-desc">{t('gdrive.folderSubfolders', { pdf: driveFolderLabel(settings, 'pdf'), backup: driveFolderLabel(settings, 'backup') })}</p>
                </>
              ) : (
                <p className="setting-desc">{t('gdrive.folderNone', { name: settings.driveFolderName })}</p>
              )}
            </div>
            <div className="btn-row">
              {folder && (
                <a className="btn" href={driveFolderUrl(folder.id)} target="_blank" rel="noreferrer">
                  <ArrowSquareOutIcon />
                  {t('gdrive.openInDrive')}
                </a>
              )}
              <button type="button" className="btn" onClick={() => void connect({ chooseFolder: true })} disabled={busy}>
                <FolderOpenIcon />
                {folder ? t('gdrive.changeFolder') : t('gdrive.chooseFolder')}
              </button>
            </div>
          </div>
          <CheckboxField
            label={t('gdrive.autoPdf')}
            hint={folder ? t('gdrive.autoPdfHint', { folder: driveFolderLabel(settings, 'pdf') }) : t('gdrive.autoPdfNeedsFolder')}
            checked={!!folder && settings.autoSavePdf !== false}
            disabled={!folder}
            onChange={(autoSavePdf) => void saveSettings({ autoSavePdf })}
          />
          <div className="setting-row">
            <div>
              <strong>{t('gdrive.autoBackupRow')}</strong>
              <p className="setting-desc">{backup.enabled ? t('gdrive.autoBackupOn', { folder: driveFolderLabel(settings, 'backup') }) : t('gdrive.autoBackupOff')}</p>
            </div>
            <button type="button" className="btn" onClick={() => revealSection('set-autobackup')}>
              {t('gdrive.autoBackupSettings')}
            </button>
          </div>
        </>
      )}
      <details className="panel disclosure google-advanced" open={advancedOpen}>
        <summary>
          <CaretRightIcon className="caret" />
          <span className="disclosure-title">{t('gdrive.advanced')}</span>
        </summary>
        <OwnClient key={`${settings.googleClientId ?? ''}|${settings.driveFolderName}`} showFolderName={!folder} />
      </details>
    </Section>
  )
}
