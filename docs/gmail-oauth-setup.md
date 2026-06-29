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
║  GMAIL_LIVE=true & connected googleOAuth2 credential?         ║
║     ├─ yes ─▶ resolve+refresh access_token ─▶ Gmail API send  ║
║     └─ no  ─▶ SMTP ─▶ infra-mailpit (dev fallback)            ║
╚══════════════════════════════════════════════════════════════╝
```

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

## Step 2 — Engine env (`apps/engine/.env`)

```
GOOGLE_CLIENT_ID=<client id from step 1>
GOOGLE_CLIENT_SECRET=<client secret from step 1>
ENGINE_PUBLIC_URL=http://localhost:8787      # must match the redirect URI host
CREDENTIALS_ENCRYPTION_KEY=<a real >=16-char secret>   # required to store tokens safely
GMAIL_LIVE=true                              # flip on once connected
```

Restart the engine after editing `.env`.

## Step 3 — Connect the account (one-time consent)

Create a `googleOAuth2` credential, then run the consent flow. Logged in to the web app
(so the session cookie is sent), in the browser console or via curl with your session:

```bash
# 1) create the credential (scopes = what the agent may do)
curl -s -X POST http://localhost:8787/api/v1/credentials \
  -H 'content-type: application/json' -H 'x-team: demo' -H 'x-role: owner' \
  -d '{"type":"googleOAuth2","name":"Gmail (kev.aubree)","data":{"scope":"https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly"}}'
# → returns { id: "cred_…" }

# 2) open the authorize URL in your browser (must be logged in to the app):
#    http://localhost:8787/api/v1/credentials/cred_…/authorize
#    → Google consent → pick kev.aubree@gmail.com → redirected back to the callback,
#      which stores the tokens and shows a success page.
```

After consent, `GET /api/v1/credentials` shows the credential with `connected: true`.

## Step 4 — Verify

With `GMAIL_LIVE=true` and the credential connected, re-run the loop:

```bash
bun --cwd apps/web test:e2e:loop
```

The invoice/meeting runs will now send through **real Gmail** (check the inbox /
Sent of `kev.aubree@gmail.com`) instead of Mailpit. The `email.send` event records
`via: "gmail"`. If anything is missing (no credential, GMAIL_LIVE off, refresh
failure) it transparently falls back to Mailpit, so dev never breaks.

## Guardrails / notes

- **Approval-gated**: the seeded `gmail.send` tool has `requireApproval:true` — the
  first real send waits for an explicit approval before anything leaves the inbox.
- **Never** reuse the Codex OAuth client id for Gmail — separate client, separate CGU.
- While the consent screen is in "Testing", only listed test users can authorize, and
  refresh tokens may expire after 7 days. Publish the app (or keep re-consenting) for
  long-lived use.
- `CREDENTIALS_ENCRYPTION_KEY` must be set to a real value before storing tokens,
  otherwise they're encrypted with an insecure dev key.
