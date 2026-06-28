# Connect Codex & deploy on a VPS

This guide explains how an agent run authenticates the **Codex** runtime, how to
connect a **ChatGPT subscription** via OAuth, and what changes for the **daemon**
(the component that actually runs `codex exec`).

> ⚠️ **Terms-of-service note.** Subscription OAuth reuses the Codex CLI's OAuth
> client id. Driving a ChatGPT Plus/Pro plan from server automation is a grey area
> in OpenAI's terms — the account may be flagged. The **API-key path below is the
> safe, in-bounds default.** Use subscription OAuth opt-in and at your own risk.

---

## Two ways to authenticate Codex

| Mode | How | Best for |
|------|-----|----------|
| **API key (BYOK)** | Paste an `OPENAI_API_KEY` in **Settings → Providers** | Production, VPS, multi-tenant |
| **Subscription OAuth** | Run `agentik login codex` once | Personal use on a ChatGPT plan |

Both are stored **encrypted** on the engine and injected into a run only at claim
time. Nothing is written to the machine's global config.

---

## Prerequisites

1. The **`codex` CLI binary must be installed on the host that runs the daemon**
   (the run host). OAuth/keys authenticate it — they don't install it.
2. The daemon is connected to your org with an **org-scoped token**
   (`agentik setup --token dtkn_…`).

---

## Connect a ChatGPT subscription (OAuth)

The Codex OAuth client only allows a **loopback redirect** (`http://localhost:1455`),
so the browser step must happen on a machine **with a browser** — the engine can't
host the callback. You run it wherever you have a browser; the tokens land in the
engine and are used by any run host afterwards (including a headless VPS).

```bash
# On a machine with a browser (your laptop is fine, even for a VPS deployment):
agentik login codex
```

This will:

1. Bind a local loopback server on port `1455` (fallback `1457`).
2. Open your browser to the OpenAI authorization page (PKCE S256).
3. Capture the authorization code on the loopback callback.
4. Hand the code to the engine, which exchanges it for tokens and stores them
   **encrypted** for your org.

You can then see the connection in the web app under
**Settings → Providers → Connected accounts**, and disconnect it there.

---

## VPS deployment

### Option A — API key (recommended)

1. Install the `codex` CLI in the daemon's environment / image.
2. In **Settings → Providers**, paste your `OPENAI_API_KEY`.
3. Done — runs inject the key at claim time.

### Option B — Subscription OAuth

1. Install the `codex` CLI on the VPS (the run host).
2. On **your laptop**, run `agentik login codex` (it stores tokens in the engine).
3. The VPS daemon receives the (refreshed) tokens injected per-run — no browser
   needed on the VPS.

---

## What changes for the daemon

- At **claim time**, the engine resolves the org's credentials
  (`resolveRuntimeAuth`): provider API keys **plus** any connected Codex OAuth,
  refreshed automatically when near expiry.
- When OAuth is present, the engine injects an `AGENTIK_CODEX_AUTH` blob into the
  task environment.
- The **codex runtime** (`apps/daemon/internal/runtime/codex.go`) then
  materializes an **isolated `HOME`** with a `~/.codex/auth.json` built from that
  blob, and points the `codex exec` process at it. Without the blob, behavior is
  unchanged: the daemon uses the machine's own `~/.codex` session or
  `OPENAI_API_KEY`.
- Tokens are never logged and never written to the host's global config — each run
  gets a throwaway home that is cleaned up afterwards.

---

## Disconnect

**Settings → Providers → Connected accounts → Disconnect**, or:

```bash
# Removes the stored tokens for the org (engine side).
DELETE /settings/oauth/codex
```
