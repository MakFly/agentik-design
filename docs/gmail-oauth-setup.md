# Gmail OAuth — real configuration

> Goal: let a seeded agent send real email through a Gmail account
> (`kev.aubree@gmail.com`) instead of the dev Mailpit relay. The whole flow is
> already wired in the engine — this is the Google Cloud + app setup to turn it on.

## How it works (already built)

```
╔══════════════════════ Gmail send path ══════════════════════╗
║  agent run (email.send)                                       ║
║        │ deliverEmail(teamId, mail)   (src/infra/gmail.ts)    ║
║        ▼                                                      ║
║  team has a CONNECTED googleOAuth2 credential? (no env flag)  ║
║     ├─ yes ─▶ resolve+refresh access_token ─▶ Gmail API send  ║
║     └─ no  ─▶ SMTP ─▶ infra-mailpit (dev fallback)            ║
╚══════════════════════════════════════════════════════════════╝
```

> **No env vars needed.** You supply your Google OAuth client id/secret + scopes in the
> app (Settings → Connections) and connect via an in-app popup. Once a team has a
> connected Google account, its agent email sends through real Gmail; otherwise Mailpit.

- Credential type `googleOAuth2`, secrets encrypted at rest (AES-256-GCM).
- `GET /api/v1/credentials/:id/authorize` → Google consent.
- `GET /api/v1/oauth/google/callback` → exchanges the code, stores access + refresh tokens.
- The worker / `resolveGmailAccessToken` auto-refresh the access token (60s skew).
- `gmail.send` tool is granted with `requireApproval:true` in the seeder, so the first
  real send halts at `waiting_approval` until you approve.

## Step 1 — Google Cloud Console

1. Create (or pick) a project: <https://console.cloud.google.com/>.
2. **Enable the Gmail API**: APIs & Services → Library → "Gmail API" → Enable.
3. **OAuth consent screen**: APIs & Services → OAuth consent screen
   - User type: **External**.
   - App name, support email, developer email: yours.
   - **Scopes**: add `https://www.googleapis.com/auth/gmail.send` (and
     `.../auth/gmail.readonly` if you also want triage to read the inbox).
   - **Test users**: add `kev.aubree@gmail.com` (required while the app is in "Testing";
     no Google verification needed for test users).
4. **Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**.
   - **Authorized redirect URI** (exact match):
     `http://localhost:8787/api/v1/oauth/google/callback`
     (this is `ENGINE_PUBLIC_URL` + `/api/v1/oauth/google/callback`; for a deployed
     engine use its public URL).
   - Copy the **Client ID** and **Client secret**.

The only engine env that matters is `CREDENTIALS_ENCRYPTION_KEY` (a real ≥16-char
secret, so stored tokens are encrypted safely) and `ENGINE_PUBLIC_URL` (must match the
redirect URI host). There is **no** `GOOGLE_CLIENT_*` or `GMAIL_LIVE` to set — those
come from the UI.

## Step 2 — Connect the account in the app (Settings → Connections)

1. Open the app (e.g. <http://localhost:3333>) and sign in.
2. Go to **Settings → Connections** (`/<team>/settings?tab=connections`).
3. Click **Connect a Google account**, paste the **client ID** and **client secret**
   from step 1, keep the prefilled `gmail.send gmail.readonly` scopes, and **Save & connect**.
4. A Google consent popup opens → pick `kev.aubree@gmail.com` → it redirects to the
   callback, stores the tokens (encrypted), and the row flips to **connected**.

## Step 3 — Verify

The team now has a connected Google account, so its agent email goes through **real
Gmail** automatically (no flag). Re-run the loop:

```bash
bun --cwd apps/web test:e2e:loop
```

The invoice/meeting runs send through Gmail (check the Sent folder of
`kev.aubree@gmail.com`); the `email.send` event records `via: "gmail"`. If the account
isn't connected (or token refresh fails) it transparently falls back to Mailpit, so dev
never breaks.

## Guardrails / notes

- **Approval-gated**: the seeded `gmail.send` tool has `requireApproval:true` — the
  first real send waits for an explicit approval before anything leaves the inbox.
- **Never** reuse the Codex OAuth client id for Gmail — separate client, separate CGU.
- While the consent screen is in "Testing", only listed test users can authorize, and
  refresh tokens may expire after 7 days. Publish the app (or keep re-consenting) for
  long-lived use.
- `CREDENTIALS_ENCRYPTION_KEY` must be set to a real value before storing tokens,
  otherwise they're encrypted with an insecure dev key.
