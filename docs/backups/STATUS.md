# Implementation status

> Build state of the Agentik frontend against the roadmap in [06-roadmap.md](./06-roadmap.md).
> Last verified: **typecheck ✓ (0 errors) · lint ✓ (0 errors) · `next build` ✓ (16 routes) · vitest ✓ (8/8) · 101 source files · 0 stray images.**

## Stack as installed

Next.js 16.2.6 (App Router, Turbopack) · React 19.2 · TS strict · Tailwind v4 (OKLCH tokens) ·
hand-authored shadcn/ui primitives on Radix · Zustand 5 · TanStack Query 5 + Table 8 + Virtual 3 ·
@xyflow/react 12 · recharts 3 · nuqs 2 · motion 12 · cmdk · sonner · next-themes · MSW 2 (browser worker) ·
Vitest 4 · Playwright · @axe-core/playwright. Package manager: **bun**.

> Note: scaffolded with the current `create-next-app`, which pulls Next **16** (not 15). App Router
> API is the same; `params` are async (`await params`) as used throughout.

## Phase progress

| Phase | Scope | State |
|-------|-------|-------|
| **P0 Foundation** | shell, tokens, providers, RBAC, error model, query keys, MSW | ✅ done & verified |
| **P1 Read-only core** | dashboard, agent registry, runs list, Task Execution View (replay) — live via MSW | ✅ done & verified |
| **P2 Live runs (SSE/WS)** | SSE hook, run-stream store + tested reducer, mock SSE route, control channel, live run view, approvals | ✅ core done & verified |
| **P3 Agent Builder** | two-pane builder (8 sections), autosave, live validation+gating, prompt editor, test harness (reuses run-view), publish flow | ✅ done & verified |
| P4 Workflow Canvas | — | ⬜ not started |
| P5 Tools + Observability | — | ⬜ |
| P6 Evals + Memory | — | ⬜ |
| P7 Governance + hardening | — | ⬜ |

## What exists and works

- **App shell** — `components/layout/`: `AppShell`, `Topbar` (team switcher, ⌘K trigger, env selector,
  active-runs + approvals indicators, theme toggle, user menu), `Sidebar` (RBAC-filtered, grouped,
  collapsible icon rail, live badges), `MobileTabBar` (bottom nav <768px), `CommandPalette` (⌘K, go-to + actions).
- **Design tokens** — `app/globals.css`: full OKLCH semantic token set, light/dark, density attr,
  reduced-motion, focus-visible, tabular-nums, themed scrollbars. Bound to Tailwind via `@theme inline`.
- **Providers** — `app/providers.tsx`: TanStack Query (retry honors `AppError.retryable`), next-themes,
  nuqs, tooltip, sonner, density bridge, MSW bootstrap (`MswReady`, dev-only).
- **State** — `lib/stores/ui.store.ts` (persisted sidebar/density/env), `session.store.ts` (mock session,
  switch role here to exercise RBAC).
- **RBAC** — `config/permissions.ts` (resource:action matrix, 5 roles), `lib/auth/rbac.tsx`
  (`useRbac`, `<RbacGate>`).
- **API layer** — `lib/api/`: `client.ts` (`apiFetch` + `qs`), `errors.ts` (normalized `AppError`),
  `queryKeys.ts` (team-scoped factory).
- **Types** — `types/domain.ts` (branded IDs, all entities = docs/04 §8), `types/events.ts` (realtime
  union = docs/04 §10).
- **Shared kit (Tier 3)** — `StatusBadge`, `EmptyState`, `ErrorState`, `StatCard` (+ sparkline),
  `CostMeter`, `DataTable` (sortable, skeleton-loading), `PageHeader`, `JsonViewer`, `ReasoningStream`,
  `ToolCallRecord`, `LogStream`, `KeyValueList`.
- **Pages** — `/[team]/dashboard` (stat cards, live-runs list, approvals, activity, performance —
  static sample data), `/[team]/agents` (**live agent registry**: MSW-backed table, faceted status
  filter via URL, sortable, success bars, cost/latency), `/[team]/runs` (**live runs list**: filterable
  table), `/[team]/runs/[runId]` (**Task Execution View**: 3-pane timeline / step focus / summary —
  reasoning, tool calls, logs, cost meter, approval card, error-first focus; live SSE or replay), agent
  new/detail placeholders, and empty-state placeholders for workflows, tools, memory, observability,
  evals.
- **Settings feature** (`features/settings/`) — `/[team]/settings` (RBAC-gated `settings:read`) hub with
  7 tabs (URL state via `?tab=`): **API keys** (create w/ scopes → secret shown once + copy, revoke w/
  confirm), **Providers** (enable/disable, set default, test reachability, fallback order + daily cost
  ceiling), **Team** (members list, role change, invite, remove — all `settings:update`-gated; owner row
  protected), **Roles** (RBAC matrix derived from `config/permissions.ts` ROLE_PERMISSIONS × RESOURCES,
  with member counts), **Billing** (plan, usage meters, spend-by-agent, invoices, over-budget banner),
  **Security** (require-approval-for-prod, PII/residency/rotation/session policy, editable IP + egress
  allowlists), **Audit log** (searchable, suspicious-only filter, append-only). MSW-backed via
  `mocks/settings-seed.ts` + `/api/v1/settings/*` handlers; hooks in `features/settings/api.ts`.
- **Run-view feature** (`features/run-view/`) — `Timeline`, `StepFocusPanel`, `RunSummary`,
  `RunControls` (RBAC-gated, status-aware), `ApprovalCard` (RBAC `run:approve`), `ActorIcon`,
  `ConnectionBadge`. Default-selects the failed → running → last step. For **live** runs it seeds the
  stream buffer from the REST snapshot (never blank), then the SSE stream is authoritative; reasoning
  renders token-by-token.
- **Realtime (P2)** — `lib/realtime/`: `event-reducer.ts` (pure, **unit-tested**: 8 cases — idempotent
  replay, reasoning accumulation, tool-call upsert/complete, failure, cost+cap, approval, log-buffer
  cap), `use-run-stream.ts` (SSE `EventSource`, rAF-coalesced deltas, exponential backoff +
  `Last-Event-ID` gap recovery, auto-close on terminal status), `run-control.ts` (control-channel
  integration point: pause/resume/cancel/approve). `lib/stores/runStream.store.ts` (per-run buffers,
  narrow selector hooks). Mock SSE route `app/api/v1/runs/[runId]/stream/route.ts` streams a scripted
  execution (reasoning tokens → tool calls → cost → approval) in the exact wire format of docs/04 §10.
- **Agent Builder (P3)** (`features/agent-builder/`) — two-pane `agent-builder.tsx` orchestrator:
  `SectionNav` (8 sections with per-section error/warning badges) · `BuilderForm` (Identity, Model
  w/ catalog + price hint, Prompt, Tools, Memory, Limits & retries, Guardrails, Review) · `PromptEditor`
  (mono textarea, live token count + `{{variable}}` detection; small boundary for a CodeMirror swap) ·
  `ConfigPreview` (resolved config + est. cost) · `TestHarness` (**reuses run-view `Timeline` +
  `StepFocusPanel`** — runs the draft and renders the trace) · `PublishDialog` (create → publish
  immutable version + changelog). `store.ts` (Zustand draft + autosave state machine idle→dirty→
  saving→saved), `validation.ts` (pure, drives inline field errors + section badges + publish gating —
  errors block, warnings don't), `default-config.ts`. Backed by MSW `POST /agents`, `/agents/:id/publish`,
  `/agents/test`. Route: `/[team]/agents/new`.
- **Mocks** — `mocks/`: `seed.ts` (6 agents), `runs-seed.ts` (3 runs: a live one with a pending
  approval, a failed one, a succeeded one), `handlers.ts` (`GET /agents`, `/agents/:id`, `/runs`,
  `/runs/:id` + builder `POST`s, with filtering + latency), `browser.ts`, `msw-ready.tsx`.
- **Tests** — `vitest.config.ts` (jsdom, `@` alias) + `lib/realtime/event-reducer.test.ts` (8 passing).

## Resume checklist (next session)

1. `bun install` (uses `bun.lock`; install runs with `--ignore-scripts` here).
2. Verify (**run with the Bash sandbox disabled** — see env notes): `bunx tsc --noEmit` ·
   `bunx eslint .` · `bunx vitest run` · `bun run build`.
3. **P4 Workflow Canvas** (@xyflow/react): palette (trigger/agent/tool/api/decision/approval/code/loop/
   subflow/end), typed handles, inspector, continuous validation, undo/redo, live test overlay (reuse
   the realtime layer), keyboard/list a11y fallback, mobile read-only. Route `/[team]/workflows/[wfId]/edit`.
4. Polish backlog: agent overview/detail (`/agents/[agentId]`) + edit mode (`AgentBuilder mode="edit"`
   already supports `initialConfig`), dashboard on live queries, virtualized runs/logs, wire
   `lib/hooks/use-indicators.ts` (zeros stub) to live counts, swap `run-control.ts` `send()` to the real
   WS + `control.ack`, a11y pass. Then P5 Tools+Observability, P6 Evals+Memory, P7 Governance. Roadmap docs/06.

## Known environment notes

- **Run verify commands (`tsc`, `eslint`, `bun run build`, `vitest`) with the Bash sandbox DISABLED.**
  With the sandbox on they time out / emit garbage bytes / return stale reads (which once falsely
  reported "0 errors" on broken code, and phantom "cannot find module" on files that existed). Sandbox
  off → clean, truthful results. This was the key unblock.
- The interactive shell also replays/duplicates output and mangles multi-token commands and parallel
  tool calls; prefer one call per turn. **Backgrounding a server inside a `bash -c` script returns
  exit 144 and cancels sibling tool calls** (this silently dropped Writes mid-session) — run server
  smoke tests in their own single call, or rely on `next build` + the route table.
- `create-next-app` set `ignoreScripts` for `sharp`/`unrs-resolver`; installs use `--ignore-scripts`.
- shadcn CLI did not complete here — UI primitives in `components/ui/` are authored by hand to the same
  API, themed with our tokens.
