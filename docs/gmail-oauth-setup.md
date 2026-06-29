# Gmail OAuth — real configuration

> Goal: let a seeded agent **send** real email through a Gmail account
> (`kev.aubree@gmail.com`) instead of the dev Mailpit relay, and **read** the
> real inbox (triage). The whole flow is already wired in the engine — this is
> the Google Cloud + app setup to turn it on.

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

╔══════════════════════ Gmail read path ══════════════════════╗
║  listGmailMessages(teamId, {maxResults})  (src/infra/gmail.ts)║
║        │ resolve+refresh access_token (gmail.readonly)        ║
║        ▼                                                      ║
║  GET users/me/messages?labelIds=INBOX  ─▶ per-id metadata get ║
║     (From / Subject / Date / snippet)                         ║
║  No Mailpit fallback: reading needs real Gmail + the API on.  ║
╚══════════════════════════════════════════════════════════════╝
```

> **Reading requires (1) the `gmail.readonly` scope on the connected credential
> AND (2) the Gmail API enabled in the Google Cloud project.** Sending and reading
> both hit `gmail.googleapis.com`, so if the API is disabled every call 403s
> (`SERVICE_DISABLED`). Quick end-to-end check with the diagnostic script:
>
> ```bash
> bun --cwd apps/engine scripts/diag-gmail.ts
> ```
> It prints each team's credential scope, daemon runtimes, provider keys, the
> Inbox Triage agent runtime, then performs a **real** `listGmailMessages` call.

### Reading/sending from chat/Telegram — deterministic Gmail skills

The default runtime is `echo` (a no-op that replays the prompt) and there is **no
LLM key** in dev, so an agent on `echo` can't read mail on its own. To make
"donne moi les 5 derniers emails" return the real inbox, the **Inbox Triage**
agent declares a deterministic, engine-side skill `gmail.read`
(`config.skills: ["gmail.read"]`).

Agents that expose the existing `gmail.send` tool can also send a real email from
Telegram/chat through the same deterministic path, but only when the request
contains all required fields explicitly:

```text
Envoie un email à operator@example.test avec le sujet "Test" et le message "Hello depuis Telegram."
```

If the prompt only says "envoie un email à ..." without a subject and body, the
engine replies with the missing fields and does **not** send anything.

```
Telegram/chat turn ─▶ sendChatMessage (domains/chat/repo.ts)
     │ agent has tool/skill "gmail.send" AND text has recipient+subject+body?
     ├─ yes ─▶ tryBuiltinSkill (domains/chat/skills.ts)
     │           deliverEmail() ─▶ Gmail API when connected, Mailpit fallback otherwise
     │           onRunCompleted() ─▶ assistant turn + Telegram notify
     │ agent has skill "gmail.read" AND text matches an inbox-read intent?
     ├─ yes ─▶ tryBuiltinSkill (domains/chat/skills.ts)
     │           run created `running` (daemon's claim needs `queued` → it skips it)
     │           listGmailMessages() ─▶ format ─▶ run `succeeded`
     │           onRunCompleted() ─▶ assistant turn + Telegram notify
     └─ no  ─▶ normal `queued` daemon run (echo / real runtime)
```

- New seeds get the skill automatically (`jobs/seed-smb.ts`). Backfill an
  already-seeded agent with `bun --cwd apps/engine scripts/enable-gmail-skill.ts`
  (also runs a real end-to-end turn as proof).
- This is intentionally scoped to two explicit intents: inbox read and fully
  specified email send. Arbitrary requests ("draft a reply", "summarise thread X")
  still need a tool-capable runtime (BYOK LLM key + richer Gmail tools).

> **No env vars needed.** You supply your Google OAuth client id/secret + scopes in the
> app (Settings → Connections) and connect via an in-app popup. Once a team has a
> connected Google account, its agent email sends through real Gmail; otherwise Mailpit.

- Credential type `googleOAuth2`, secrets encrypted at rest (AES-256-GCM).
- `GET /api/v1/credentials/:id/authorize` → Google consent.
- `GET /api/v1/oauth/google/callback` → exchanges the code, stores access + refresh tokens.
- The worker / `resolveGmailAccessToken` auto-refresh the access token (60s skew).
- Simulated seeded runs still use `requireApproval:true`, so those external-write
  runs halt at `waiting_approval` until you approve.
- Deterministic Telegram/chat sends use `MAIL_FROM`, then `SEED_OPERATOR_EMAIL`,
  then `assistant@agentik.dev` as the raw `From:` header. For real Gmail delivery,
  set it to the connected account or an allowed Gmail send-as address.

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

## Troubleshooting

### `Erreur 403: access_denied` — "L'appli est en cours de test / seuls les testeurs approuvés y ont accès"

Your OAuth consent screen is in **Testing** publishing status, and the Google account
you're signing in with is **not in the test-users list** (the project owner is NOT added
automatically). Fix:

1. Google Cloud Console → **APIs & Services → OAuth consent screen** (new UI: **Audience**).
2. **Test users → + ADD USERS** → add the exact address you authorize with
   (`kev.aubree@gmail.com`, plus any other). **Save**.
3. Retry the connect, and **pick that exact account** on the Google screen (a different
   logged-in Google account → same 403).

Notes:
- In Testing mode, refresh tokens expire after ~7 days → you'll re-consent weekly.
- For long-lived/external use, publish the app — but `gmail.readonly` is a *restricted*
  scope (needs Google verification). If you only send, drop `gmail.readonly` and keep
  just `gmail.send` (sensitive only) to ease a future verification.

### `403 ... Gmail API has not been used in project NNN before or it is disabled`

The OAuth token is fine, but the **Gmail API itself is not enabled** in the Google
Cloud project (distinct from the consent screen / scopes). `listGmailMessages`
surfaces this as `gmail_api_disabled` (not a scope error). Fix:

1. Open the link from the error, e.g.
   `https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=NNN`
   (or **APIs & Services → Library → "Gmail API" → Enable**).
2. Wait ~1–2 min for propagation, then re-run `scripts/diag-gmail.ts`.

### `gmail_scope_missing` (403/401 with insufficient scope)

The credential was connected **without** `gmail.readonly` (e.g. send-only). Reconnect
in Settings → Connections keeping both `gmail.send gmail.readonly` scopes, re-consent,
and pick the same account. Verify the granted scope with `scripts/diag-gmail.ts`.

## Guardrails / notes

- **Approval-gated**: the seeded `gmail.send` tool has `requireApproval:true` — the
  first real send waits for an explicit approval before anything leaves the inbox.
- **Never** reuse the Codex OAuth client id for Gmail — separate client, separate CGU.
- While the consent screen is in "Testing", only listed test users can authorize, and
  refresh tokens may expire after 7 days. Publish the app (or keep re-consenting) for
  long-lived use.
- `CREDENTIALS_ENCRYPTION_KEY` must be set to a real value before storing tokens,
  otherwise they're encrypted with an insecure dev key.
