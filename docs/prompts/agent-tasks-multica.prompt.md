# prompt.md — Agent Tasks (multica-parity) + Hermes Bundle Manager

## Mission

Implement, in the `agentik-design` monorepo, two tightly-scoped capabilities on top of the **already-existing** agent-execution harness: **(A)** a multica-style *agent tasks* experience (task-centric runs, chat-spawns-task, real-time transcript, explicit state machine with cancel/retry/timeout, a runtime-selection UI gated on detection, and optionally an issues board + autopilots), and **(B)** a *Hermes bundle manager* — a daemon control-plane that can probe, install, upgrade and uninstall the Hermes CLI (and, by the same contract, its sibling CLIs) end-to-end from the web Settings UI, with no shell access, no sudo, idempotent and isolated. Both parts reuse the existing engine/daemon HTTP+JSON protocol, the encrypted provider-key path, and the RBAC matrix. **Do not invent APIs that contradict the codebase.**

> Verify every code reference below against the live tree before relying on it. Symbol names were confirmed at authoring time; **line numbers are approximate and rot quickly — navigate by symbol, treat any `:NN` as a hint, not a contract.**

---

## Locked decisions (v1 scope — these are settled, do NOT re-ask)

These resolve every prior open question. They are the **definition of done for v1**. Anything marked deferred is explicitly out of scope until a follow-up decision.

1. **Surfaces = task-centric only.** Build chat-spawns-task, live transcript, cancel/retry, and the runtime picker. **No Kanban/issues board** (A.5 issues part is DEFERRED — multica-inferred schema is risky and not needed to prove value).
2. **No autopilots in v1** (neither cron/webhook nor "Run now"). DEFERRED entirely.
3. **Remote `curl | bash` is allowed**, but gated behind a daemon env flag `AGENTIK_ALLOW_BUNDLE_NETWORK_INSTALL` (default **`true`** for local single-tenant dev). Do NOT reimplement the git/uv install by hand. If the flag is `false`, install/upgrade return a clear "network installs disabled" error.
4. **Daemon stays manual** (`make daemon/start`). No launchd. Ops must be idempotent + re-drivable from the probe postcondition.
5. **Uninstall = keep-data only in the UI.** The irreversible `--full` purge is NOT exposed in v1 (implement the `--yes` keep-data path only; no `--full` button, no full-purge confirm flow).
6. **No session resumption.** All retries (auto + manual) start a FRESH run. Do not add `session_id`/`--resume`/real-`work_dir` plumbing.
7. **Bundle ops stay owner-only.** Gate them on the existing `settings:update` (owner-only today). Do NOT widen the `rbac.ts` matrix.
8. **Retrofit the cancel guard.** Add `run:control` to `POST /runs/:id/cancel` (and the WS control path) at the same time as adding retry — it is currently unguarded; this is a one-line consistency fix, do it.

---

## Context & constraints

### Monorepo layout (verified)
```
apps/
  web/      Next.js 16 (App Router). Routes under app/[team]/(app)/<segment>. Also has its own API proxy routes under app/api/v1/*.
  engine/   Bun + Hono API + realtime WS. src/*.ts. Drizzle ORM. migrations in apps/engine/drizzle.
  daemon/   Go module `agentik/daemon`. Builds to bin/agentik-daemon. Manual lifecycle via Makefile.
packages/
  workflow-schema/  Shared contracts: rbac.ts (RBAC matrix), runtime.ts, agent.ts, …
  workflow-engine/
Makefile    `make dev` (web+engine+worker via -j3, NOT daemon). Daemon: make daemon/{start,stop,status,restart,logs,foreground}, make build/daemon.
```

### Hard rules
- **AGENTS.md — "This is NOT the Next.js you know."** Before writing ANY Next.js code, read the relevant guide in `node_modules/next/dist/docs/`. APIs and conventions may differ from training data. Heed deprecation notices. This applies in particular to the web API route at `apps/web/app/api/v1/runs/[runId]/live/route.ts` (see A.3).
- **Karpathy discipline.** *Think before coding* (state assumptions; ask if ambiguous). *Simplicity first* (minimal, nothing speculative). *Surgical changes* (touch only what's needed; match surrounding style). *Goal-driven* (verifiable success criteria; test-first where possible; loop until verified).
- **Plan mode + ASCII diagram.** For each non-trivial phase, produce a short plan with an ASCII architecture/data-flow diagram and get approval before implementing.
- **Browser verification.** After any UI change use Playwright MCP (`browser_navigate`, `browser_snapshot`, console-error check). The web port is **auto-picked by `make dev`** — read the actual port from the dev output; do not hardcode a port number for Playwright.
- **Code search.** Prefer a trigram indexer (`ig`) if present. **`ig` is NOT installed on this machine** — if `command -v ig` is empty, use `grep`/`rg`/`find` instead. Do not block on a tool that does not exist here.
- **Tenancy & RBAC are server-side truth.** `apps/engine/src/auth.ts` derives `teamId`/`role`; `requirePermission` enforces. The daemon protocol is mounted OUTSIDE the org middleware (`apps/engine/src/server.ts`, daemon mount approx `:469`) and authenticates with an org-scoped token (`teams.daemonToken`) or the shared `DAEMON_AUTH_TOKEN`.

### RBAC matrix — exact current state (verified, read it yourself before gating anything)
`packages/workflow-schema/src/rbac.ts`. Roles are **`owner | admin | engineer | operator | viewer`** (NOT "member"). Key facts that constrain this work:
- `owner: "*"` (wildcard — owner can do everything).
- **No role except owner has `settings:update`, `settings:create`, or `settings:delete`.** `admin` has only `settings:read` (plus broad agent/workflow/run perms). So the existing `PUT /settings/provider-keys` (requires `settings:update`) is **owner-only today**.
- `run:control` IS granted to `admin`, `engineer`, `operator` (and owner). `run:run` likewise.
- Consequence for this prompt: any feature gated on `settings:update` (bundle install/upgrade/uninstall, runtime picker writes) is **owner-only unless you deliberately widen the matrix**. See cross-cutting RBAC section for the required decision.

### What ALREADY exists (do not rebuild — extend)
- **Task primitive:** `agent_tasks` table (`apps/engine/src/db/schema.ts`, approx `:175`) with status machine `queued|dispatched|running|completed|failed|cancelled` (status enum approx `:35-41`), `priority`, `kind` (`chat|direct`, default `chat`, approx `:183`), `input` jsonb, `workDir`, `result`, `error`, step counters, timestamps. **`agent_tasks` has NO `attempt`, NO `session_id`, NO `error_reason` column** (confirmed). Beware: an `attempt` column already exists on the **`runs`** workflow table (`schema.ts` approx `:122`) — that is a DIFFERENT table; grep hits for `attempt` will match it. Anything you add to `agent_tasks` is genuinely new there.
- **Streamed transcript:** `task_messages` (`schema.ts` approx `:198`), unique on `(task_id, seq)`, types `text|thinking|tool_use|tool_result|error` (approx `:42`).
- **Daemon protocol (engine side):** `apps/engine/src/daemon-routes.ts` → `/daemon/register`, `/heartbeat`, `/runtimes/:id/tasks/claim`, `/tasks/:id/{start,messages,complete,fail}`; repo in `daemon-repo.ts`. **`claimTask` sets `work_dir = '/work/' || t.id` SERVER-SIDE at claim time** (engine-assigned logical path), uses `FOR UPDATE SKIP LOCKED`; `appendMessages` returns `{cancel}`; `completeTask`/`failTask` finalize.
- **Daemon protocol (Go side):** `apps/daemon/internal/{client,loop,protocol,runtime,probe,config}`. Loop = register→heartbeat→claim→execute. **Real intervals (verified `loop/loop.go`): claim/idle poll = `idlePoll = 1s`; heartbeat = `heartbeatEvery = 5s`.** Runtimes registered in `main.go` (approx `:28`): `echo`, `claude`, `hermes`. Probe of known CLIs in `probe/probe.go` (approx `:22`): **6 CLIs** — `claude, hermes, codex, aider, goose, gemini`.
- **Hermes runtime (run path):** `apps/daemon/internal/runtime/hermes.go` — **single-shot** `chat -q <prompt> -Q --yolo --max-turns 30` (no `--resume` wired), isolated work dir under `WORK_ROOT` (`/tmp/agentik-work`), env allowlist (`hermesEnv()`), process-group kill, throwaway `HERMES_HOME` built from injected keys (`writeHermesHome`). **`-Q` quiet mode emits NO token usage** → cost is a genuine zero.
- **Secrets:** `provider_keys` (`schema.ts` approx `:370`, AES-256-GCM via `crypto.ts`), `providers-repo.ts` (`resolveProviderEnv` injects `{ENV_VAR:value}` into the claim).
- **Live stream to web:** Engine SSE `/runs/:id/live` (`server.ts` approx `:441`) maps `task_messages`→typed `RunEvent`s (`agents-repo.ts` approx `:203`). **There is ALSO a Next.js web API route** `apps/web/app/api/v1/runs/[runId]/live/route.ts` that handles/proxies the live stream — the transcript spans BOTH the engine and this web route. WS realtime hub publishes run lifecycle (`hub.ts`); control channel handles `run.cancel` (`control.ts`).
- **System view:** `/system` (`server.ts` approx `:225`) returns `daemonEnabled`, `providers` presence, `daemons[]` (with `meta.tools` = probe output) and `runtimes[]`. **It does NOT currently expose `availableRuntimes`** (confirmed). Rendered by `apps/web/features/settings/tabs/runtimes-tab.tsx` ("Detected CLIs" cards).
- **RBAC:** `packages/workflow-schema/src/rbac.ts` — resources include `settings`, `run`, `agent`; actions `read|create|update|delete|run|approve|control`. Settings tabs in `apps/web/features/settings/settings-hub.tsx` (currently `Runtimes`, `Providers`).
- **Cancel route (verified):** `POST /runs/:id/cancel` (`server.ts` approx `:382`) calls `cancelAgentTask(teamId, id)` and has **NO `requirePermission` guard** — it relies only on org middleware + `teamId`. The WS control path (`control.ts`) likewise does not check `run:control`. So "cancel is gated on `run:control`" is currently FALSE.
- **Runtime selection:** **Confirmed NONE in the agent builder.** `agents.runtime_kind` defaults to `echo` (`schema.ts` approx `:141`). On publish, `configToVersionInput` (`agents-repo.ts` approx `:466`) DOES read `cfg.runtimeKind` (parsed via `runtimeKindSchema`, falls back to `echo`) → `agent.runtime_kind`. There is no UI picker. Part A adds one, gated on detection.

---

## PART A — Agent Tasks (multica-parity)

> **Research provenance.** The multica behaviors below are reconstructed from multica's docs + SQL migrations (`github.com/multica-ai/multica`). Some are inferred-not-read (autopilot/squads/skills schemas, exact one-pending-task index). Treat multica numbers (3s poll, 15s heartbeat, migration 022/037) as the **comparison column, NOT agentik's behavior**, and verify before building anything derived from inferred schema.

### A.0 Target model (mapped onto agentik seams)

Multica's "task" = the unit of every agent run, produced by four triggers (issue-assignment, @-mention, chat, autopilot), all converging on one queue with `queued→dispatched→running→completed|failed|cancelled`. Agentik already has that queue (`agent_tasks`) and that exact status enum. Parity work = the **surfaces and lifecycle policy** around it. Of the four triggers, **only chat is in default scope**; issue-assign and @-mention are gated (A.5 / Open Questions).

```
                          ┌──────────────────────── apps/web (Next 16) ───────────────────────┐
  TRIGGERS                │  [Board(issues)]  Chat(agent)   Task detail (live transcript)       │
  ───────                 │      ┊ assign        │ message      │ cancel / retry / runtime pick │
  1 chat message ─────────┼──────┊───────────────┘──────────────┼───────────────────────────────┘
  2 issue assign ┄┄(gated)┘      ┊ HTTP          │ HTTP          │ WS control / HTTP
  3 @mention   ┄┄(gated)         ┊
  4 autopilot  ┄┄(gated)──► engine (Hono) ───────────────────────────────────────────────────────
                              │ INSERT agent_tasks(status='queued')          ▲ hub.publish (WS) + SSE /runs/:id/live
                              ▼                                              │ (engine SSE + web api/v1 route)
                       ┌── agent_tasks (queue) ──┐   scanner: timeout + retry classification
                       │ queued→dispatched→…     │
                       └──────────┬──────────────┘
                                  │ /daemon claim  (agentik poll = idlePoll 1s, heartbeat 5s)
                                  ▼                                    [multica, for contrast: 3s/15s]
                       ┌──────── daemon (Go) ────────┐  runtime adapter under WORK_ROOT,
                       │ loop: claim→start→stream→done│  streams task_messages back
                       └──────────────┬──────────────┘
                                      ▼  exec.LookPath(<runtime CLI>) e.g. hermes/claude
                                AI coding CLI (does the work)

  (┄ dashed = scope-gated, do not build unprompted; ┊ = chat is the live default path)
```

### A.1 State-machine & lifecycle policy (engine)

The status enum already matches multica. Add the **policy layer** agentik lacks.

1. **Timeout scanner.** Add a periodic scan that every 30s flips stale tasks:
   - `dispatched` with `dispatched_at` older than **5 min** → fail with reason `timeout` (retryable).
   - `running` with `started_at` older than **2.5 h** → fail with reason `timeout` (retryable).
   Use SQL `UPDATE … WHERE status=… AND <ts> < now()-interval` and publish each resulting run event via `hub.publish`.
   - **Where it runs / double-fire guard (be precise).** `make dev` runs engine AND worker as **separate processes** (`worker.ts` is a BullMQ `Worker`, not a cron host). A naive `setInterval` in both → double-scan. **Decision required (do not guess):** host the scanner in exactly ONE process. Recommended: a BullMQ repeatable job registered in `worker.ts` (BullMQ guarantees single delivery), OR a single `setInterval` in the engine `main.ts` guarded by a Postgres advisory lock (`pg_try_advisory_lock`) so only one holder scans. State which you chose and why; the SQL `UPDATE … WHERE` is already idempotent so a stray double-run is safe but wasteful — still pick one owner.
2. **Retry classification.** Add to `agent_tasks` (NEW columns on this table — note `attempt` already exists on the unrelated `runs` table, do not be misled): `error_reason text` nullable (`runtime_offline|runtime_recovery|timeout|agent_error`) and `attempt int not null default 1`. On `failTask`, derive `error_reason` (`timeout` from the scanner; `agent_error` for runtime-reported failures; `runtime_offline` when no runtime claimed). **Retryable** = `runtime_offline|runtime_recovery|timeout`; **auto-retry** re-queues by resetting the same row to `queued` with `attempt+1` (or inserts a fresh row) **only when** `attempt < 2` and the task is chat-triggered (NOT autopilot). `agent_error` is terminal. **Auto-retry starts a FRESH run — it does NOT preserve or resume any session** (session resumption does not exist yet; see A.1.4 and Open Question #6). Do not import multica's "preserves session_id" language here.
3. **Manual rerun.** `POST /runs/:id/retry`. Cancel any queued/running task for the same subject, enqueue a FRESH task (`attempt=1`, no session inheritance), publish `run.created`. No attempt ceiling. **RBAC: gate on `run:run`** (held by admin/engineer/operator/owner). **Per Locked decision #8, also retrofit `run:control`** onto `POST /runs/:id/cancel` AND the WS control path (`control.ts`) in the same change — it is unguarded today.
4. **Session resumption — DEFERRED, not in default scope (Open Question #6).** It does not exist today: the Hermes run path is single-shot `-q` with no `--resume`, and `agent_tasks.work_dir` is an **engine-assigned logical path** (`'/work/' || id`, set in `claimTask`), NOT the daemon's real isolated dir (the daemon uses `WORK_ROOT`). So a real resume requires: deciding who owns the resumable real path, persisting a daemon-reported `session_id` + real `work_dir` back via the complete/fail calls, and wiring `--resume <session_id>` in the runtime adapters (skip Gemini). All of this is net-new daemon+protocol work — **do NOT build it unless Open Question #6 is confirmed.** Until then, all retries (auto and manual) are fresh sessions.

Write every migration by editing `apps/engine/src/db/schema.ts` then `bunx drizzle-kit generate` (output lands in `apps/engine/drizzle`). Never hand-write SQL migrations.

### A.2 Chat-spawns-task (canonical non-issue, default-scope path)

Multica's chat path: each user message → enqueue a task → assistant reply written back. Agentik already supports a `kind:"chat"` task (`runAgent` sets `kind:"chat"`; the sandbox/test path uses `kind:"direct"`). **Keep `kind` strictly `chat|direct` — do NOT introduce a third kind.** The chat-spawns-task path reuses the existing `"chat"` kind; the only schema addition for chat is the session FK.

- New tables (`schema.ts`): `chat_sessions(id, teamId, agentId, creatorId, title default '', sessionId text, workDir text, status active|archived, createdAt, updatedAt)` and `chat_messages(id, chatSessionId fk cascade, role user|assistant, content, taskId, createdAt)`. Add `chat_session_id text` (nullable FK) to `agent_tasks` — this is the only new `agent_tasks` column for chat.
- Engine routes (in `server.ts` under the `api` group; **RBAC `run:run` to send**): `POST /chat/sessions`, `GET /chat/sessions`, `GET /chat/sessions/:id` (with messages), `POST /chat/sessions/:id/messages` → insert `chat_message(role=user)`, enqueue `agent_tasks(kind='chat', chat_session_id=…)`, return `{taskId}`. On `completeTask`, if the task has a `chat_session_id`, write the result back as `chat_message(role=assistant)` and `hub.publish`.
- There is an existing "Hermes Lite" chat UI (`apps/web/features/hermes-lite`, nav segment `thechat`). **Decision:** prefer **extending** that surface to spawn real tasks over duplicating a chat shell.

### A.3 Per-task live transcript (mostly built — finish across BOTH boundaries)

The engine SSE (`server.ts` approx `:441`) and reducer (`agents-repo.ts` approx `:203`) exist. **But the transcript also flows through the Next.js web route `apps/web/app/api/v1/runs/[runId]/live/route.ts` — read that route (per AGENTS.md, App-Router conventions differ from training data) before claiming the transcript is done.** Wire/verify both: do not assume the engine endpoint is the only boundary.

- Verify the Task detail page at `app/[team]/(app)/runs/[runId]` renders the live `task_messages` timeline, shows status transitions, and exposes **Cancel** (existing WS `run.cancel` → `control.ts`) and the new **Retry** button (`POST /runs/:id/retry`).
- Surface `error_reason` and `attempt` in the UI.
- Cost for Hermes `-Q` runs is a genuine `0` (the mapper already yields zero, `agents-repo.ts` approx `:28`). Render **"no usage reported"** rather than a fabricated number.

### A.4 Runtime-selection UI (NEW — gated on detection)

Today the agent builder has no runtime picker. Add one:

- **Detection source.** `/system` returns `daemons[].meta.tools` (probe output: `{name, path, version, available}`) plus `runtimes[]` (registered kinds). **Add a derived `availableRuntimes: string[]` to `/system`** (it is absent today) = the registered runtime kinds whose corresponding CLI is `available:true` on at least one online daemon, with `echo` ALWAYS included (it needs no CLI). Implement this inside `getSystemInfo` so the route shape change is additive.
- **Builder picker.** In `apps/web/features/agent-builder`, add a Runtime select bound to `config.runtimeKind`, **constrained to `availableRuntimes`**. Disabled options show "not detected — install in Settings → Runtimes".
- **Publish path.** `configToVersionInput` (`agents-repo.ts` approx `:466`) already parses `cfg.runtimeKind` → `agent.runtime_kind`, so no engine change is needed beyond exposing `availableRuntimes`. **Confirm this by reading `configToVersionInput` before asserting "no engine change"** — the builder has no picker today, so verify `runtimeKind` is actually plumbed from config (it is, with an `echo` fallback) and not hardcoded.
- **RBAC.** Writing an agent's runtime is part of agent publish (`agent:create`/`agent:update`, held by admin+), **not** `settings:update`. Gate the picker accordingly — do NOT require `settings:update` for the picker.
- Closes the loop with Part B: a runtime becomes selectable only once its bundle is installed and detected.
- **Test:** unit-test `getSystemInfo` → `availableRuntimes` always contains `echo`, and contains a CLI kind iff a probe reports it `available:true`.

### A.5 Issues board + Autopilots — DEFERRED (locked out of v1)

Per Locked decisions #1 and #2, the Kanban issues board and Autopilots are **out of scope for v1**. Do not build `issues`, `autopilots`, or `autopilot_runs`. Kept here only as a forward pointer: if a follow-up reopens this, the issue model would enqueue `agent_tasks` atomically with a "one pending task per issue" partial index (verify multica's final shape, migration 022→037, before copying). Until then, the only task triggers in v1 are **chat** (A.2) and **manual retry** (A.1.3).

---

## PART B — Hermes Bundle Manager

### B.0 Concept

Model `hermes` as a declarative **runtime bundle** the daemon owns A-to-Z. Four idempotent, no-sudo, `$HOME`-scoped operations — **probe, install, upgrade, uninstall** — exposed over the existing `/daemon` protocol and driven from a new Settings → Runtimes "Bundles" section. **Naming caution:** hermes' OWN `bundles` subcommand means *skill bundles* — keep our concept named **runtime bundle** in code/UI to avoid collision. Agentik today probes **6** CLIs and registers **3** runtimes (`echo/claude/hermes`); the bundle contract is reusable by the sibling CLIs (claude, codex, aider, goose, gemini) but **only hermes is wired** in this work — do not echo multica's "12 providers" as agentik capability.

Ground truth about Hermes on this machine (from research):
- Install method = **git** checkout at `~/.hermes/hermes-agent`, uv-managed CPython 3.11 venv, editable install; wrapper at `~/.local/bin/hermes` (4-line bash, `unset PYTHONPATH/PYTHONHOME` then exec venv entrypoint). Marker `~/.hermes/hermes-agent/.install_method` = `"git"`.
- Only host prereq = **uv** (`~/.local/bin/uv`). Go is NOT needed by hermes.
- `HERMES_HOME` = `~/.hermes` (config.yaml, .env, auth.json, state.db, sessions/, skills/, `.update_check` JSON `{ts,behind,rev,ver}`).
- This checkout carries **+1 local commit over origin/main** and is a grafted/shallow clone → `hermes update` may stash/rebase and could discard it. Surface this before upgrading.
- Bundle ops act on the **REAL** `~/.hermes`; the per-RUN throwaway `HERMES_HOME` (`hermes.go writeHermesHome`) is untouched.

```
 Settings ▸ Runtimes ▸ Bundles (web)
        │  GET status / POST install|upgrade|uninstall  (RBAC: see decision in cross-cutting)
        ▼
 engine  /daemon/bundles/* (new)  ── relays command to the owning daemon ──►  daemon bundle pkg
        ▲  status persisted on daemons.meta.bundles[] ; progress polled via GET /bundles/commands/:id
        │                                                     │
        └─────────── re-probe postcondition (source of truth) ┘
 daemon (Go) internal/bundle:
   PROBE   exec.LookPath("hermes") + `hermes --version` + read ~/.hermes/{hermes-agent/.install_method,.update_check}
   INSTALL ensure uv → HERMES_HOME=… PATH=$HOME/.local/bin:$PATH  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
   UPGRADE `hermes update --yes --backup`   (honors git install_method; --backup REQUIRED due to carried commit)
   UNINST  `hermes uninstall --gui-summary` (inventory) → `hermes uninstall --yes` | `--full --yes`
           fallback: rm -rf ~/.hermes/hermes-agent ; rm -f ~/.local/bin/hermes [; rm -rf ~/.hermes]
```

### B.1 Daemon — `internal/bundle` package

Create `apps/daemon/internal/bundle/bundle.go` with a `Bundle` descriptor and four operations. Reuse the hardening already in `runtime/hermes.go`: env allowlist (extend `hermesEnv()`), per-op timeout, `syscall.SysProcAttr{Setpgid:true}` + group-kill, dedicated workdir, **single-flight lock per bundle id** (no concurrent install+uninstall, no install concurrent with a task run that uses the venv).

- **Status struct** (extend the probe `Tool` shape, `probe/probe.go` approx `:14`): `{id, installed, path, version, python, installMethod, updateAvailable, healthy, carriedCommits int}`.
- **PROBE** (read-only, pollable, the source of truth):
  - `exec.LookPath("hermes")` + `hermes --version` (reuse `probe.version`).
  - `installMethod` = read `~/.hermes/hermes-agent/.install_method`.
  - `updateAvailable` = read `~/.hermes/.update_check` JSON `behind>0`, or `hermes update --check`.
  - `carriedCommits` = parse `hermes version` ("… local <sha> (+N carried commit)") → surface as upgrade warning (this machine carries +1).
  - Never trust cached `LookPath`; re-probe after any mutating op.
- **INSTALL** (idempotent): if PROBE installed → no-op return. Else ensure `uv` (`LookPath uv`; if missing, `curl -LsSf https://astral.sh/uv/install.sh | sh`), then run the official installer with controlled env:
  `HERMES_HOME=<home> PATH=$HOME/.local/bin:$PATH bash -c 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'`. Stream stdout/stderr lines back as progress. Postcondition: PROBE shows installed+version. After install, **re-probe — do NOT cache `LookPath`** (daemon PATH must include `~/.local/bin`; see B.4). **Both remote-exec calls (hermes installer AND the uv bootstrap) are gated by the SAME network-policy decision (Open Question #3).**
- **UPGRADE** (idempotent): PROBE; if `!updateAvailable` → no-op. Else surface the carried-commit warning first, then `hermes update --yes --backup` (**`--backup` is mandatory, not optional**, because of the carried local commit). Re-probe.
- **UNINSTALL** (idempotent): `hermes uninstall --gui-summary` (JSON inventory for the confirm screen) → `hermes uninstall --yes` (keep data) or `--full --yes` (purge ~/.hermes — irreversible). Fallback if CLI broken: `rm -rf ~/.hermes/hermes-agent && rm -f ~/.local/bin/hermes` (+ `rm -rf ~/.hermes` ONLY on full). **Postcondition by mode:** keep-data success = `binary absent AND ~/.hermes/hermes-agent absent` (do NOT assert `~/.hermes` is gone, or idempotency fails — config is intentionally retained); full-purge success = the above AND `~/.hermes` absent.

All ops emit structured progress through the daemon's existing streaming/batch-flush pattern.

### B.2 Daemon — control-plane in the loop

The loop today only does the data-plane (claim/run). Add a control-plane:
- Extend the protocol (`protocol/protocol.go`) with bundle command structs and add daemon client methods (`client/client.go`): in the heartbeat/idle cycle, the daemon polls `POST /daemon/bundles/poll` for pending bundle commands targeting this daemon, executes via `internal/bundle`, reports status + progress to `POST /daemon/bundles/status`. Same single process, same manual lifecycle.
- **Register the bundle control-plane as a SEPARATE capability — NOT a runtime kind.** `RUNTIME_KINDS`/`main.go` registers runtimes (`echo/claude/hermes`); a bundle is a control-plane, not a runtime, and must NOT leak into `availableRuntimes` (A.4). Wire it as its own registration alongside, not inside, the runtime registry.

### B.3 Engine — bundle routes + persistence

- **Schema (`schema.ts`):** add `bundle_commands(id, teamId, daemonId, bundleId text, op install|upgrade|uninstall, args jsonb, status pending|running|succeeded|failed, progress jsonb, error, createdAt, updatedAt)`. Persist last-known bundle status on `daemons.meta.bundles[]` (already flexible jsonb) so `/system` can render it without a live daemon round-trip.
- **Daemon-protocol routes (`daemon-routes.ts`, OUTSIDE org middleware, daemon-token auth like existing `/daemon/*`):** `POST /daemon/bundles/poll` (claim next pending command for this daemon), `POST /daemon/bundles/status` (update command status + write `daemons.meta.bundles`).
- **User-facing routes (`server.ts` `api` group):** `GET /bundles` (status per daemon, from `/system` data), `POST /bundles/:bundleId/install|upgrade|uninstall` (insert `bundle_commands` row → `hub.publish`), `GET /bundles/commands/:id` (status for progress polling). Uninstall body carries `mode: keep|full`. **RBAC per the cross-cutting decision below** (currently `settings:update` is owner-only).

### B.4 Daemon PATH coupling (critical)

The daemon execs **bare** `"hermes"` (`probe/probe.go`, `runtime/hermes.go`). A correctly-installed bundle reads as NotInstalled if the daemon's PATH lacks `~/.local/bin`. Fix in `Makefile` `daemon/start` and `internal/config` defaults: ensure `PATH` includes `$HOME/.local/bin` for the daemon process. After any install op, the daemon must **re-probe** (fresh `LookPath`) rather than trust a cached result. Never re-inject `PYTHONPATH`/`PYTHONHOME` (the wrapper unsets them deliberately).

### B.5 Web — Settings ▸ Runtimes ▸ Bundles

In `apps/web/features/settings/tabs/runtimes-tab.tsx` (or a new `bundles-section.tsx` mounted there), add a Bundles card per daemon:
- Status badge (NotInstalled / Installed healthy|degraded / Upgrade available / Installing / Uninstalling) from `GET /bundles`.
- Buttons **Install**, **Upgrade** (only when `updateAvailable`; show carried-commit warning first), **Uninstall** (confirm dialog that first calls the `--gui-summary` inventory and clearly distinguishes **keep data** vs **full purge**).
- **Live progress: poll `GET /bundles/commands/:id`** (single chosen mechanism). Do NOT reuse the *run* WS channel for bundle progress — bundles are not runs; conflating them is a category error.
- RBAC-gate the mutating buttons via `useRbac().can(...)` matching the engine guard.
- This section is the single place that makes a runtime "appear" in the A.4 agent-builder picker (install → detect → selectable).

### B.6 Go-daemon lifecycle

Keep the existing **manual** lifecycle (`make daemon/{start,stop,status,restart}`, `bin/agentik-daemon`, pid/log in `/tmp`). Because pid/log live in `/tmp` and the daemon is not reboot-persistent, long-running install/upgrade ops MUST be idempotent and re-drivable from the probe postcondition (no resumable in-memory state). Graduating to a launchd user-agent is **out of scope unless requested** (Open Question #4).

---

## Cross-cutting

- **RBAC — explicit decision required (do not assume admin works).** Today only `owner` has `settings:update`; `admin` has only `settings:read`. For bundle install/upgrade/uninstall you must pick ONE and state it:
  - (a) **Widen the matrix:** add `settings:update` (and any of `settings:create/delete` you need) to `admin` in `rbac.ts` as a deliberate, called-out change; OR
  - (b) **Keep owner-only:** gate bundle ops on `settings:update` and document "owner-only; admin currently lacks `settings:update`" — raise as Open Question #7.
  The **runtime picker** (A.4) is gated on `agent:create`/`agent:update` (admin has these), NOT `settings:update`. **Task retry** (A.1.3) is `run:run` (admin/engineer/operator have it). **Task cancel** currently has NO guard — decide whether to retrofit `run:control`. Prefer reusing existing permissions; add new ones only if none fit. Engine enforces via `requirePermission`; web gates UX via `useRbac().can`.
- **Secrets.** Reuse `crypto.ts` (AES-256-GCM) and `provider_keys`/`resolveProviderEnv` for any new keys. Bundle ops need NO provider key (hermes authenticates from its own `~/.hermes` or per-run injected config).
- **Error states.** Every new surface has explicit empty/loading/error states (mirror `runtimes-tab.tsx` patterns). Bundle failures surface `error` + last progress lines; task failures surface `error_reason` + `attempt`.
- **Observability / cost.** Hermes `-Q` emits **no token usage** → keep cost a genuine zero and label "no usage reported" (never fabricate). Runs that DO report usage keep using `costFromTaskResult` (`agents-repo.ts` approx `:28`). Emit structured logs for the timeout scanner and each bundle op.

---

## Phased execution plan (ordered, test-first, verifiable)

> For each phase: plan-mode + ASCII diagram first; implement surgically; then run the listed checks. UI phases end with a Playwright pass (read the port from `make dev` output).

**Phase 0 — Recon & guardrails (no behavior change).**
- Read `node_modules/next/dist/docs/` for the App-Router conventions you'll touch (incl. the `app/api/v1/runs/[runId]/live/route.ts` pattern). Read `rbac.ts`, `loop/loop.go`, `daemon-repo.ts::claimTask`, `agents-repo.ts::configToVersionInput`, and the web live route end-to-end before changing them.
- Confirm `make dev` boots web+engine+worker; `make build/daemon` succeeds; `make daemon/start` registers a daemon in Settings ▸ Runtimes.
- Success: `/system` returns the local daemon with `meta.tools` including `hermes` (available on this machine).

**Phase 1 — Lifecycle policy (engine, test-first).**
- Add `attempt`, `error_reason` (and the chat `chat_session_id` if pairing with Phase 2) to `agent_tasks` via schema edit + `drizzle-kit generate` + migrate. Confirm these are NEW on `agent_tasks` (the existing `attempt` is on `runs`).
- Implement timeout scanner (single owner, see A.1.1) + retry classification + `POST /runs/:id/retry` (`run:run`). Decide cancel-guard retrofit.
- Tests (Bun, alongside `daemon-repo`/`agents-repo` tests): dispatched > 5m → failed `timeout`; chat-triggered retryable failure with `attempt<2` re-queues fresh (no session); `agent_error` does not retry; manual retry cancels+re-enqueues `attempt=1`; scanner does not double-fire (assert single owner).
- Success: `bun test` green in apps/engine; no regressions.

**Phase 2 — Chat-spawns-task (engine + web).**
- Add `chat_sessions`/`chat_messages`, routes (`run:run`), assistant-reply-on-complete. Reuse `kind="chat"`; add only `chat_session_id` FK.
- Wire into the existing Hermes Lite / `thechat` surface (extend, don't duplicate).
- Success (engine test-first): posting a message creates a queued chat task; completing it writes an assistant `chat_message`. Playwright: open chat, send a message, observe the streamed reply (running daemon + key configured).

**Phase 3 — Task detail + Cancel/Retry UI.**
- Finish the live transcript on `runs/[runId]` across BOTH the engine SSE and the web `api/v1/runs/[runId]/live` route; add Retry; surface `error_reason`/`attempt`; "no usage reported" label.
- Success: Playwright — start a task, watch transcript stream, cancel mid-run, retry a failed run; no console errors.

**Phase 4 — Runtime-selection UI (gated on detection).**
- Add `availableRuntimes` to `/system` (`getSystemInfo`); add the builder picker constrained to it; gate on `agent:create/update`.
- Tests: unit-test `availableRuntimes` (echo always; CLI iff probed available). Playwright: with only `echo` detected, claude/hermes disabled with install hint; after Phase 6 installs hermes it becomes selectable.

**Phase 5 — Bundle manager: PROBE + read-only UI.**
- `internal/bundle` PROBE; engine `/daemon/bundles/{poll,status}` + `GET /bundles`; Settings Bundles card (status only).
- Success (Go test for parsing `hermes version`/`.update_check`): status reflects the real machine (installed, v0.17.0, method=git, +1 carried commit). Playwright: Bundles card shows status.

**Phase 6 — Bundle manager: INSTALL / UPGRADE / UNINSTALL.**
- Implement the three ops with single-flight lock, streamed progress, idempotent pre/postconditions, fallbacks. Gate BOTH remote `curl|bash` calls behind the network-policy decision (Open Question #3) and the RBAC decision.
- **SAFETY RAIL (mandatory):** do NOT execute real install/upgrade/uninstall against the user's real `~/.hermes` during development — it holds `auth.json`/`sessions/`/`state.db`. During dev test **PROBE only** against the real home; exercise INSTALL/UPGRADE/UNINSTALL against a **throwaway `HERMES_HOME`** (temp dir) or mocks. The `--full` purge path is **unit-tested with a mocked/throwaway HERMES_HOME, never against the user's home**. No test or Playwright run may trigger `--full` on the real home.
- Tests: idempotent no-op when already installed; keep-data uninstall then re-install (postcondition: binary+checkout gone, config retained); full-purge confirm flow uses `--gui-summary` inventory (throwaway home). Verify daemon re-probes after install (PATH includes `~/.local/bin`).
- Success: from the UI, against a throwaway home, uninstall (keep data) then re-install end-to-end; runtime picker (Phase 4) reflects the change. Playwright through the confirm dialog distinguishing keep vs full.

**Phase 7 — (Conditional) Issues board + Autopilots.** Only if Open Questions #1/#2 confirm scope. Board assign→enqueue with the one-pending-task partial index (verify final multica shape, 022→037); issue rollback on unrecovered failure; manual "Run now" autopilot first.

---

## Out of scope / non-goals
- Cloud runtimes (multica's "coming soon"); only the local daemon.
- Squads, reusable structured skills authoring, full-text search, inbox/notifications beyond what already exists.
- Session resumption (`session_id`/`--resume`) unless Open Question #6 confirms.
- Reboot-persistent daemon (launchd) unless explicitly requested.
- Reimplementing hermes' git/uv install steps by hand — always delegate to the official installer / `hermes update` / `hermes uninstall`.
- Cron/webhook autopilot triggers unless confirmed (manual "Run now" only by default).
- Generic multi-bundle catalog UI — only hermes is wired.
- Executing real bundle mutations against the user's `~/.hermes` during development.

## Open Questions (confirm before executing the gated parts)
1. Full issues/Kanban board, or task-centric surfaces only (chat/transcript/retry/picker)?
2. Autopilots: full cron+webhook+manual now, or manual "Run now" + data model only?
3. Is remote `curl | bash` (hermes installer AND uv bootstrap on nousresearch.com / astral.sh) acceptable from the daemon, or must installs be offline/pinned (gating BOTH behind a flag)?
4. Graduate the daemon to a reboot-persistent launchd service now, or keep manual `make daemon/start`?
5. Expose the irreversible `hermes uninstall --full` purge in the UI, or keep-data uninstall only?
6. Implement session resumption (`session_id`/`--resume`) now, or defer (Hermes run path is single-shot; `work_dir` is engine-assigned, not the real isolated dir)?
7. RBAC for bundle ops: widen `admin` to include `settings:update` in `rbac.ts`, or keep bundle management owner-only?
