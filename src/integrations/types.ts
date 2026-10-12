export interface EmailDraft {
  to: string[]
  cc?: string[]
  subject: string
  body: string
  attachments: { fileName: string; blob: Blob }[]
}

export interface GoogleStatus {
  configured: boolean
  signedIn: boolean
  email?: string
}
