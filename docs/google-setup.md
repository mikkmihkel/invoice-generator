# Google sign-in, Drive and Gmail setup

The app can save PDFs and backups to the user's own **Google Drive** and, with an own client, send
invoices through **Gmail**. This runs entirely in the browser. There is no server, no client secret and
no refresh token. Signing in is optional: PDF download, the Web Share sheet, mailto links and file
backups work without Google.

There are two ways to get a Google OAuth *client ID* (a public identifier, not a secret):

- **Shared client of the published site** (recommended for the public site). The site owner creates
  one client and the build injects it. Users just press "Sign in with Google". It asks only for
  non-sensitive scopes, so Gmail sending is not available with it.
- **Your own client** (self-hosting, or to send with Gmail). You create a client in your own Google
  Cloud project and paste it under **Settings → Google → Advanced**. It overrides the shared client.

## What the app asks for

| Feature | Scope | Google classification | Shared client | Own client |
|---|---|---|---|---|
| Show which account is signed in | `openid`, `email` | non-sensitive | yes | yes |
| Save PDFs and backups to Drive | `https://www.googleapis.com/auth/drive.file` | non-sensitive. The app only sees files and folders **it created or the user picked** in the Google Picker, not the rest of the Drive. | yes | yes |
| Send email with the PDF attached | `https://www.googleapis.com/auth/gmail.send` | **sensitive**. The app can send mail as the user but cannot read the mailbox. | **never** | yes |

With the shared client the app refuses to request `gmail.send` at all; the email dialog offers the
share sheet and the mail app instead. With an own client, permissions are requested
**incrementally**: Drive when signing in or first saving, Gmail the first time an email is sent.

### Where the files go

After signing in, the user chooses a folder: with the **Google Picker** (when the build has an API
key and app ID, and the shared client is in use) or by letting the app create a folder **Arveldaja**
in My Drive (it finds that folder again on another computer, also after it was moved). The app stores
the folder by ID and creates two subfolders in it: **Arved** for invoice PDFs and **Varukoopiad** for
backups. Settings from earlier versions that only name a folder (default `Arved`) keep working until a
folder is chosen; older backups stay in that folder and are still offered when restoring.

## For the site owner: shared client

Do this once for the published site (e.g. `https://<github-user>.github.io/invoice-generator/`).

1. **Project.** In <https://console.cloud.google.com/> create a project (e.g. `arveldaja`). Note its
   **project number** (Dashboard / IAM & Admin → Settings): it is the Picker's *App ID*.
2. **APIs.** In *APIs & Services → Library* enable **Google Drive API** and **Google Picker API**.
   (Gmail API is not needed for the shared client.)
3. **Consent screen** (*Google Auth Platform*):
   - *Branding*: app name `Arveldaja`, support email, the site's home page and privacy policy links
     (the README's privacy section can serve as the policy), authorised domain `github.io` or your
     custom domain.
   - *Audience*: **External**, then **Publish app** (status *In production*).
   - *Data Access*: add only `openid`, `.../auth/userinfo.email` and `.../auth/drive.file`.

   Because all three scopes are **non-sensitive**, publishing needs **no security assessment** and no
   sensitive-scope review, and there is no 100-user test limit. Google may still require **brand
   verification** (app name, logo, home page and privacy policy on a domain you own) before the app
   name and logo are shown on the consent screen; check *Google Auth Platform → Verification Center*
   after publishing. Do not add `gmail.send` here: it is sensitive and would require Google's
   verification.
4. **OAuth client** (*Clients → Create client*): type **Web application**, **Authorized JavaScript
   origins**: `https://<github-user>.github.io` (scheme and host only, no path, no trailing slash) and
   any custom domain; add `http://localhost:5173` only if you also want it for local development.
   No redirect URIs. Copy the client ID; ignore the client secret.
5. **API key for the Picker** (*Credentials → Create credentials → API key*), then restrict it:
   - *Application restrictions*: **Websites (HTTP referrers)**: `https://<github-user>.github.io/*`
     (and your custom domain).
   - *API restrictions*: **Google Picker API** only.

   The key ends up in the public JavaScript; these restrictions are what keep it from being misused.
6. **Repository variables** (*GitHub → Settings → Secrets and variables → Actions → Variables*, not
   secrets: these are public identifiers):

   | Variable | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | the client ID, `…apps.googleusercontent.com` |
   | `GOOGLE_API_KEY` | the restricted API key |
   | `GOOGLE_APP_ID` | the project number |

   The deploy workflow passes them to the build as `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`
   and `VITE_GOOGLE_APP_ID`. Run the workflow again to publish.

Without `GOOGLE_API_KEY`/`GOOGLE_APP_ID` sign-in still works and users get the "Create folder
Arveldaja" option instead of the Picker. Without `GOOGLE_CLIENT_ID` the site has no built-in sign-in
and hides the sign-in step, the account chip and the Drive reminder; users can still add their own
client in Settings. For local development, put the same values in `.env.local` as
`VITE_GOOGLE_CLIENT_ID=…` etc. (and add `http://localhost:5173` to the client's origins and the key's
referrers).

## For users and self-hosters: your own client

Use this to send invoices with Gmail, or when you host your own copy without a shared client. The
client ID you paste in Settings overrides the shared one in this browser. It takes about 10 minutes
and costs nothing.

If you deploy your own copy and want Gmail, leave the `GOOGLE_*` repository variables unset and paste
your client ID in Settings: a client injected at build time is treated as the shared client, which
never requests Gmail. The Picker is only used with the shared client; with your own client the app
creates the **Arveldaja** folder instead.

### 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in with the Google account that will send the invoices.
2. Use the project picker at the top and choose **New project**. Name it something like `invoice-generator`, then **Create**, and make sure the new project is selected.

### 2. Enable the APIs

1. Go to **APIs & Services → Library**.
2. Search **Google Drive API** and click **Enable**.
3. Search **Gmail API** and click **Enable**.

If you skip this step, the app shows "The Google API is not enabled in your project".

### 3. Configure the consent screen (Google Auth Platform)

The console calls this **Google Auth Platform** (menu **APIs & Services → OAuth consent screen**
leads there). Its sections are *Branding*, *Audience*, *Data Access* and *Clients*.

1. Click **Get started** (or **Branding**):
   - **App name**: e.g. `Arveldaja`
   - **User support email**: your email address
   - **Audience**: **External**. ("Internal" is only available for Google Workspace organisations. If you have Workspace and are the only user, Internal works too and skips steps 2–3 below.)
   - **Contact information**: your email address. Accept the policy and click **Create**.
2. **Audience**: leave the publishing status as **Testing**.
3. **Audience → Test users → Add users**: add **your own Gmail address** (the one you will sign in with). Only listed test users can sign in while the app is in Testing. Google allows up to 100 of them.
4. **Data Access** (optional): you can add the scopes `.../auth/drive.file` and `.../auth/gmail.send`. The app requests them at runtime anyway.

#### Why "Testing" is fine here

- `gmail.send` is a **sensitive** scope. A *published* app using it would need Google's verification
  review. While the app stays in **Testing**, no verification is needed and it works for the test users
  you listed, which here is you.
- When you sign in, Google shows the warning **"Google hasn't verified this app"**. That is expected,
  because it is your own app. Click **Continue** (on some screens: *Advanced → Go to Arveldaja (unsafe)*).
- You may have read that Testing-mode authorisations expire after **7 days**. That rule applies to
  **refresh tokens**. This app uses the Google Identity Services **token model**, which issues only
  short-lived access tokens (about 1 hour), kept in memory and never stored. It never gets a refresh token,
  so the 7-day limit doesn't affect it. When a token expires, the app silently asks Google for a new
  one. You may see a popup flash briefly, and after a page reload you might be asked to pick your
  account again.
- Do **not** click "Publish app". Publishing would make Google require verification for `gmail.send`.

### 4. Create the OAuth client ID

1. Go to **Clients → Create client** (older UI: *Credentials → Create credentials → OAuth client ID*).
2. **Application type**: **Web application**. **Name**: e.g. `invoice-generator web`.
3. **Authorized JavaScript origins → Add URI**:
   - `https://<your-github-user>.github.io`: the origin of your GitHub Pages site. Enter **only** the scheme and host, **without** the `/<repo>/` path and without a trailing slash. If you use a custom domain, add that origin, e.g. `https://arved.example.ee`.
   - `http://localhost:5173`: only needed for local development (`npm run dev`).
4. **Authorized redirect URIs**: leave empty. The token model uses a popup and doesn't need one.
5. Click **Create** and copy the **Client ID**. It looks like `1234567890-abc123def456.apps.googleusercontent.com`.
   Ignore the client secret. The app doesn't use it, so don't paste it anywhere.

Changes to origins can take a few minutes, and occasionally longer, to take effect.

### 5. Paste the client ID into the app

1. Open the app and go to **Settings (Seaded) → Google’i konto ja Drive → Täpsemad seaded** (Advanced).
2. Paste the client ID and save. The ID is stored only in this browser's IndexedDB and in your backups.
3. Click **Sign in with Google** and allow the requested permissions. Leave the checkboxes for Drive and
   Gmail **ticked**. If you untick one, that feature reports a missing permission until you sign in again.
4. Choose the folder: the app creates **Arveldaja** in your Drive (move it anywhere you like). Until you
   choose one, the folder named in the advanced settings (default `Arved`) is used, as in earlier versions.

## Troubleshooting

| Message / symptom | Fix |
|---|---|
| Popup shows **Error 400: origin_mismatch** | The page's origin isn't in *Authorized JavaScript origins*. Add exactly what the browser shows, e.g. `https://user.github.io`, with no path. Wait a few minutes and retry. |
| **Error 403: access_denied** / "app is currently being tested" | Your account isn't listed under *Audience → Test users*. |
| **invalid_client** | The client ID in Settings is wrong or was deleted. Copy it again. |
| "The browser blocked the Google sign-in popup" | Allow popups for the site. Sign in from the Settings button first, then retry the action. |
| "The Google API is not enabled" | Step 2: enable Drive API / Gmail API in the same project as the client ID. |
| The folder picker does not open, and the app offers "Create folder Arveldaja" | The Picker needs the Google Picker API enabled and an API key restricted to the site's referrer (shared client only). Creating the folder works just as well. |
| "The chosen Google Drive folder was not found" | The folder was deleted, or you signed in with another Google account. Choose the folder again in Settings. |
| "Google did not grant the required permission" | You unticked Drive or Gmail on the consent screen. Sign out in the app and sign in again. |
| Want to revoke access completely | In the app choose **Sign out**, which revokes the token. You can also go to <https://myaccount.google.com/permissions> and remove the app. |

## Privacy notes

- Data never passes through any server of ours, also not with the shared client: the site owner only
  registers the client and never sees users' files or tokens. The browser talks directly to
  `accounts.google.com`, `www.googleapis.com`, `gmail.googleapis.com` and, for the folder picker,
  `apis.google.com` and `docs.google.com`.
- With `drive.file`, the app can only see what it created or what the user picked. A backup restore
  therefore finds only backups that this app uploaded. A user-made subfolder called `Arved` or
  `Varukoopiad` inside the chosen folder is not visible to the app, which creates its own next to it.
- The chosen folder's ID and name are kept in the settings (and in backups). Importing a backup keeps
  the folder chosen in the current browser. The manual backup `arveldaja-backup.json` is overwritten on each
  manual Drive backup (a manual backup saved by an earlier version as `invoice-generator-backup.json` is
  overwritten in place and keeps that name).
- Automatic backups are named `arveldaja-backup-YYYY-MM-DD-HHmmss.json` (`.json.enc` when encrypted). Versions
  named `arvegeneraator-backup-…` by earlier versions are still listed, restored and pruned the same way.
- Automatic backups (Settings → Automatic backup to Google Drive) are separate, dated files in the backup
  folder (`Varukoopiad`, or the named folder of earlier versions). Choosing a folder switches them on
  ("Back up automatically to this folder", ticked by default unless switched off before; the dialog recommends
  setting a passphrase). They are optionally encrypted with a passphrase. Each browser keeps its own newest versions (at least 3) and
  moves only its own older versions to the Drive trash; copies made on other devices are never touched. If
  Drive already holds a backup with more issued documents than this browser, automatic backup pauses and
  offers to restore it first. Documents you delete on purpose do not trigger this pause.
- Automatic backup never opens a Google sign-in window on its own. After the page is reloaded it waits until
  you use a Google feature or press **Back up now**.
- Emails are sent from your Gmail account and appear in your *Sent* folder.
