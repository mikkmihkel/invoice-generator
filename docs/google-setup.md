# Google Drive and Gmail setup

The app can save PDFs and backups to **Google Drive** and send invoices by email through **Gmail**.
This runs entirely in your browser. There is no server, no client secret and no refresh token. You
create your own Google OAuth *client ID* (a public identifier, not a secret) and paste it into the
app's **Settings**. It takes about 10 minutes and costs nothing.

You can use the app without this. PDF download, the Web Share sheet, mailto links and file backups
work without Google.

## What the app asks for

| Feature | Scope | Google classification |
|---|---|---|
| Show which account is signed in | `openid`, `email` | non-sensitive |
| Save PDFs and backups to Drive | `https://www.googleapis.com/auth/drive.file` | non-sensitive. The app only sees files and folders **it created**, not the rest of your Drive. |
| Send email with the PDF attached | `https://www.googleapis.com/auth/gmail.send` | **sensitive**. The app can send mail as you but cannot read your mailbox. |

Permissions are requested **incrementally**: Drive access is asked for the first time you save to
Drive, and Gmail access the first time you send an email.

## 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in with the Google account that will send the invoices.
2. Use the project picker at the top and choose **New project**. Name it something like `invoice-generator`, then **Create**, and make sure the new project is selected.

## 2. Enable the APIs

1. Go to **APIs & Services → Library**.
2. Search **Google Drive API** and click **Enable**.
3. Search **Gmail API** and click **Enable**.

If you skip this step, the app shows "The Google API is not enabled in your project".

## 3. Configure the consent screen (Google Auth Platform)

The console calls this **Google Auth Platform** (menu **APIs & Services → OAuth consent screen**
leads there). Its sections are *Branding*, *Audience*, *Data Access* and *Clients*.

1. Click **Get started** (or **Branding**):
   - **App name**: e.g. `Arvegeneraator`
   - **User support email**: your email address
   - **Audience**: **External**. ("Internal" is only available for Google Workspace organisations. If you have Workspace and are the only user, Internal works too and skips steps 2–3 below.)
   - **Contact information**: your email address. Accept the policy and click **Create**.
2. **Audience**: leave the publishing status as **Testing**.
3. **Audience → Test users → Add users**: add **your own Gmail address** (the one you will sign in with). Only listed test users can sign in while the app is in Testing. Google allows up to 100 of them.
4. **Data Access** (optional): you can add the scopes `.../auth/drive.file` and `.../auth/gmail.send`. The app requests them at runtime anyway.

### Why "Testing" is fine here

- `gmail.send` is a **sensitive** scope. A *published* app using it would need Google's verification
  review. While the app stays in **Testing**, no verification is needed and it works for the test users
  you listed, which here is you.
- When you sign in, Google shows the warning **"Google hasn't verified this app"**. That is expected,
  because it is your own app. Click **Continue** (on some screens: *Advanced → Go to Arvegeneraator (unsafe)*).
- You may have read that Testing-mode authorisations expire after **7 days**. That rule applies to
  **refresh tokens**. This app uses the Google Identity Services **token model**, which issues only
  short-lived access tokens (about 1 hour), kept in memory and never stored. It never gets a refresh token,
  so the 7-day limit doesn't affect it. When a token expires, the app silently asks Google for a new
  one. You may see a popup flash briefly, and after a page reload you might be asked to pick your
  account again.
- Do **not** click "Publish app". Publishing would make Google require verification for `gmail.send`.

## 4. Create the OAuth client ID

1. Go to **Clients → Create client** (older UI: *Credentials → Create credentials → OAuth client ID*).
2. **Application type**: **Web application**. **Name**: e.g. `invoice-generator web`.
3. **Authorized JavaScript origins → Add URI**:
   - `https://<your-github-user>.github.io`: the origin of your GitHub Pages site. Enter **only** the scheme and host, **without** the `/<repo>/` path and without a trailing slash. If you use a custom domain, add that origin, e.g. `https://arved.example.ee`.
   - `http://localhost:5173`: only needed for local development (`npm run dev`).
4. **Authorized redirect URIs**: leave empty. The token model uses a popup and doesn't need one.
5. Click **Create** and copy the **Client ID**. It looks like `1234567890-abc123def456.apps.googleusercontent.com`.
   Ignore the client secret. The app doesn't use it, so don't paste it anywhere.

Changes to origins can take a few minutes, and occasionally longer, to take effect.

## 5. Paste the client ID into the app

1. Open the app and go to **Settings (Seaded) → Google**.
2. Paste the client ID and save. The ID is stored only in this browser's IndexedDB and in your backups.
3. Optionally, set the **Drive folder name** (default e.g. `Arved`). The app creates this folder on first use.
4. Click **Sign in with Google** and allow the requested permissions. Leave the checkboxes for Drive and
   Gmail **ticked**. If you untick one, that feature reports a missing permission until you sign in again.

## Troubleshooting

| Message / symptom | Fix |
|---|---|
| Popup shows **Error 400: origin_mismatch** | The page's origin isn't in *Authorized JavaScript origins*. Add exactly what the browser shows, e.g. `https://user.github.io`, with no path. Wait a few minutes and retry. |
| **Error 403: access_denied** / "app is currently being tested" | Your account isn't listed under *Audience → Test users*. |
| **invalid_client** | The client ID in Settings is wrong or was deleted. Copy it again. |
| "The browser blocked the Google sign-in popup" | Allow popups for the site. Sign in from the Settings button first, then retry the action. |
| "The Google API is not enabled" | Step 2: enable Drive API / Gmail API in the same project as the client ID. |
| "Google did not grant the required permission" | You unticked Drive or Gmail on the consent screen. Sign out in the app and sign in again. |
| Want to revoke access completely | In the app choose **Sign out**, which revokes the token. You can also go to <https://myaccount.google.com/permissions> and remove the app. |

## Privacy notes

- Data never passes through any server of ours. The browser talks directly to `accounts.google.com`,
  `www.googleapis.com` and `gmail.googleapis.com`.
- With `drive.file`, the app can only see what it created. A backup restore therefore finds only
  backups that this app uploaded. The manual backup `invoice-generator-backup.json` is overwritten on each
  manual Drive backup.
- Automatic backups (Settings → Automatic backup to Google Drive) are separate, dated files in the same
  folder, optionally encrypted with a passphrase. Each browser keeps its own newest versions (at least 3) and
  moves only its own older versions to the Drive trash; copies made on other devices are never touched. If
  Drive already holds a backup with more issued documents than this browser, automatic backup pauses and
  offers to restore it first.
- Automatic backup never opens a Google sign-in window on its own. After the page is reloaded it waits until
  you use a Google feature or press **Back up now**.
- Emails are sent from your Gmail account and appear in your *Sent* folder.
