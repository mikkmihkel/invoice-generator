import { createContext, useContext } from 'react'

export type ConnectResult = 'connected' | 'failed'

export interface DriveConnectApi {
  /**
   * Sign in with Google (call from a click: it may open the consent popup), then let the user choose a Drive folder
   * when none is chosen yet (or always, with `chooseFolder`), then offer to restore a backup when the app is still
   * empty. Resolves when the whole flow is over.
   */
  connect(options?: { chooseFolder?: boolean }): Promise<ConnectResult>
  /** The sign-in step is running. */
  busy: boolean
}

export const DriveConnectContext = createContext<DriveConnectApi | null>(null)

/** The connect flow hosted by DriveConnectProvider (mounted once in App). */
export function useDriveConnect(): DriveConnectApi {
  const ctx = useContext(DriveConnectContext)
  if (!ctx) throw new Error('useDriveConnect outside DriveConnectProvider')
  return ctx
}
