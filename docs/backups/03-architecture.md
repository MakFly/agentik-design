# 03 · Recommended Frontend Architecture

Covers: folder structure · state management · API integration · WebSocket/SSE strategy · error handling · loading/skeletons · RBAC handling · security.

---

## 7.1 High-level architecture

```
╔══════════════════════════════ BROWSER (Next.js App Router) ══════════════════════════════╗
║                                                                                           ║
║  ┌──────────────┐   ┌──────────────────────────────┐   ┌───────────────────────────────┐ ║
║  │ Server Comps │   │ Client Components             │   │ Realtime layer                │ ║
║  │ (RSC)        │   │ features/* (interactive)      │   │ SSE (runs, logs, costs)       │ ║
║  │ static shell │   │                               │   │ WS  (control + workflow live) │ ║
║  │ initial data │   │  ┌─ TanStack Query ────────┐  │   │  └─ event bus → query cache + │ ║
║  └──────┬───────┘   │  │ server state cache      │◀─┼───┼──── zustand stream stores     │ ║
║         │           │  └─────────┬───────────────┘  │   └───────────────────────────────┘ ║
║         │           │  ┌─ Zustand ───────────────┐  │                                     ║
║         │ hydrate   │  │ UI + ephemeral + stream │  │                                     ║
║         ▼           │  └─────────────────────────┘  │                                     ║
║  ┌──────────────────┴───────────────────────────────┴──────────────────────────────────┐ ║
║  │ api client (typed fetch + zod) · authFetch · errorNormalizer · rbac helpers          │ ║
║  └──────────────────────────────────────┬───────────────────────────────────────────────┘ ║
╚═════════════════════════════════════════│════════════════════════════════════════════════╝
                                           │ HTTPS (REST/JSON) · SSE · WSS
                                           ▼
                        ┌──────────────────────────────────────────┐
                        │ BFF / API Gateway (Next route handlers or │
                        │ separate service) — auth, rate-limit,     │
                        │ aggregation, SSE/WS fan-out               │
                        └────────────────┬─────────────────────────┘
                                         ▼
                        Agentik backend (agents · runs · tools · vector · billing)
```

- **RSC for the shell & first paint** (nav, page chrome, initial above-the-fold data via server fetch), **client components for interactivity** (builders, canvas, run view).
- A **thin BFF** (Next route handlers under `app/api/*`, or a dedicated gateway) owns auth cookie ↔ token exchange, request shaping, and SSE/WS fan-out, so the browser never holds long-lived provider secrets.

### Why this split of state libraries
- **TanStack Query** = *server state* (anything that lives in the backend; cached, invalidated, refetched).
- **Zustand** = *client state* (UI prefs, transient selections, and high-frequency **stream buffers** that would thrash the Query cache if written per-token).
- **URL** = *shareable state* (filters, selected entity, tab).

---

## 7.2 Folder structure

```
agentik-web/
├─ app/                                   # Next App Router (routing + RSC)
│  ├─ (auth)/login/ accept-invite/ onboarding/
│  ├─ (app)/[team]/
│  │  ├─ layout.tsx                       # AppShell, team guard, providers
│  │  ├─ dashboard/page.tsx
│  │  ├─ agents/ (page, new, [agentId]/...)
│  │  ├─ workflows/ (page, new, [wfId]/edit)
│  │  ├─ runs/ (page, [runId]/page.tsx)
│  │  ├─ tools/ memory/ observability/ evals/ settings/
│  ├─ api/                                # BFF route handlers
│  │  ├─ auth/ stream/[runId]/  ws/  proxy/[...path]/
│  ├─ layout.tsx  globals.css
│
├─ features/                              # Tier-4 domain modules (self-contained)
│  ├─ dashboard/  agent-builder/  workflow-canvas/  run-view/
│  ├─ agent-registry/  tools/  memory/  observability/  evals/  settings/
│  │   └─ (each) components/ hooks/ api/ store/ types.ts index.ts
│
├─ components/                            # Tier-3 composed + Tier-2 ui
│  ├─ ui/                                 # shadcn primitives (button, sheet, dialog…)
│  ├─ shared/                             # DataTable, EntityDrawer, MetricChart, CostMeter…
│  └─ layout/                             # AppShell, Sidebar, Topbar, PageHeader
│
├─ lib/
│  ├─ api/  client.ts queryKeys.ts errors.ts  (typed fetch + zod + normalizer)
│  ├─ realtime/  sse.ts ws.ts eventBus.ts  reconnect.ts
│  ├─ auth/  session.ts rbac.ts permissions.ts
│  ├─ stores/  ui.store.ts  command.store.ts
│  ├─ hooks/  useDebounce useVirtualizer useHotkeys useRbac …
│  └─ utils/  cn.ts format.ts (cost, tokens, duration, dates) zod-helpers.ts
│
├─ types/                                 # shared domain models + generated API types
│  ├─ domain.ts  (Agent, Run, Step, Tool…)   api.ts (generated from OpenAPI)  events.ts
│
├─ config/  nav.ts  models.ts  tool-catalog.ts  permissions.ts
├─ styles/  tokens.css
└─ tests/   e2e (Playwright) · unit (Vitest) · msw handlers
```

**Import rules (enforced via eslint `no-restricted-imports` / boundaries):**
- `app/*` → may import `features/*` (public index only), `components/*`, `lib/*`, `types/*`.
- `features/A` → **must not** import `features/B`. Shared needs go to `components/shared` or `lib`.
- `components/ui` → only `lib/utils`. No domain imports.

---

## 7.3 State management strategy

### Server state — TanStack Query
- **Query key factory** (`lib/api/queryKeys.ts`) — hierarchical, team-scoped:
  ```ts
  qk.agents.list(team, filters) // ['team', team, 'agents', 'list', filters]
  qk.agents.detail(team, id)
  qk.runs.detail(team, runId)
  ```
- **Defaults:** `staleTime` tuned per resource (lists 15s, detail 5s, static catalog 5m); `gcTime` 5m; `retry` 2 with backoff except 4xx; `refetchOnWindowFocus` on for dashboards/lists, off inside builders.
- **Mutations** are optimistic where safe (rename, toggle, reorder) with rollback `onError`; server-confirmed for create/publish/delete. After a mutation, **invalidate by key prefix**, never refetch-all.
- **Realtime ↔ cache bridge:** stream events patch the Query cache via `queryClient.setQueryData` for *structural* changes (step added, status changed, cost updated). High-frequency *token deltas* go to Zustand (below), not the cache.

### Client state — Zustand (slices)
- `ui.store` — sidebar collapsed, density, theme, command-palette open, active EntityDrawer entity.
- `command.store` — palette query + results.
- **`runStream.store`** — per-run buffers keyed by `runId`: `{ steps, reasoningByStep, logsByStep, status, cost }`. The SSE handler writes here at high frequency; components subscribe with selectors so only the focused step re-renders. On run completion, the authoritative snapshot is reconciled into the Query cache and the buffer is dropped.
- **`canvas.store`** (workflow builder) — nodes, edges, selection, undo/redo history, validation problems. Local-first; persisted as draft via debounced mutation.

> Selector discipline: components subscribe to the **narrowest** slice (`useRunStream(s => s.steps[id])`) to avoid re-rendering the whole timeline on every token.

### URL state
- `nuqs` (or manual `useSearchParams`) for filters/sort/tab/`drawer` id. Parsed with zod so a malformed shared link degrades gracefully to defaults.

---

## 7.4 API integration strategy

- **Typed client** generated from the backend **OpenAPI** spec (`openapi-typescript` → `types/api.ts`); a thin `apiFetch<T>()` wraps `fetch` with: base URL, auth (httpOnly cookie + CSRF header), `team` scoping, `AbortSignal`, JSON parse, and **zod validation at the boundary** for hand-written/critical responses.
- **One fetcher per resource**, colocated in `features/*/api`. Hooks (`useAgents`, `useAgent`, `useCreateAgent`) wrap Query/Mutation; pages never call `fetch` directly.
- **Pagination:** cursor-based (`useInfiniteQuery`) for runs/logs/audit; offset for small bounded lists. Server returns `{ items, nextCursor, total? }`.
- **Idempotency:** create/publish/run mutations send an `Idempotency-Key` (uuid) so retries don't double-fire (critical for "Run in prod").
- **Cancellation:** every query/mutation passes the request's `AbortSignal`; navigating away or re-querying cancels in-flight requests.
- **MSW** mocks the full contract for dev/test/Storybook so the frontend is buildable before the backend ships.

```ts
// lib/api/client.ts (essence)
export async function apiFetch<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/proxy${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", "x-team": opts.team, "x-csrf": csrf(), ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "include",
    signal: opts.signal,
  });
  if (!res.ok) throw await normalizeError(res);     // → AppError (see 7.6)
  const json = await res.json();
  return opts.schema ? opts.schema.parse(json) : (json as T);
}
```

---

## 7.5 WebSocket / SSE strategy

**Channel choice:** SSE for **server→client streams** (run timelines, logs, cost, metrics) — simpler, auto-reconnect, works through proxies. WebSocket only where the client must **send** mid-stream: run controls (pause/resume/cancel/approve) and the collaborative workflow-canvas test overlay. (Full event schema in doc 04 §10.)

```
┌─────────────┐  GET /api/stream/{runId}     ┌──────────────────────┐
│ RunView     │ ───────────────────────────▶ │ BFF SSE endpoint     │
│ useRunStream│  text/event-stream            │ (auth + authorize    │
│             │ ◀─────────────────────────── │  run access, fan-out) │
│             │  id: 412                       └──────────┬───────────┘
│             │  event: step.started                     │ subscribes
│             │  data: {...}                              ▼
│ controls →  │  WSS /api/ws  {type:"run.pause"}  backend run bus (Redis/NATS)
└─────────────┘
```

- **`useRunStream(runId)`** hook: opens `EventSource`, dispatches typed events into `runStream.store`, exposes `{ steps, status, cost, connection }`. Buffers token deltas and flushes on `requestAnimationFrame` to cap re-renders.
- **Reconnect & gap recovery:** track `lastEventId`; on reconnect send `Last-Event-ID` so the server replays missed events. Exponential backoff with jitter; show a non-blocking "reconnecting…" chip; never lose the last snapshot.
- **Backpressure:** if event rate is extreme, coalesce `token.delta`s and cap `LogStream` to the last N lines (virtualized) with a "load earlier" fetch from REST.
- **Lifecycle:** subscribe on mount of a *live* run only; completed runs read the static snapshot (replay scrubber, no socket). Always close on unmount/tab-hidden (`visibilitychange`) to free server connections.
- **Multiplexing:** a single shared WS carries control + multiple run subscriptions (channel field) to avoid connection sprawl when watching several runs.

---

## 7.6 Error handling strategy

**Normalized error model** — every failure becomes one shape so UI handles them uniformly:

```ts
type AppError = {
  kind: "network" | "auth" | "forbidden" | "not_found" | "validation"
      | "rate_limit" | "provider" | "conflict" | "server" | "unknown";
  status?: number;
  message: string;            // user-safe
  detail?: string;            // dev detail (shown in dev / on "details")
  fields?: Record<string,string>;  // validation → field map
  retryable: boolean;
  traceId?: string;           // for support / link to Observability
};
```

- **Boundaries:** Next `error.tsx` per route segment + a top-level `<ErrorBoundary>`; feature-level boundaries around builders/canvas so a crash in the inspector doesn't take down the page.
- **Surface by kind:**
  - `validation` → inline field errors (`aria-describedby`), no toast.
  - `forbidden` → `RbacGate` fallback / "you don't have access" panel (never a blank).
  - `rate_limit`/`provider` → retryable banner with countdown + "retry".
  - `network` → toast + offline indicator; queries auto-retry with backoff.
  - `server`/`unknown` → `ErrorState` with `traceId` + "report" link.
- **Mutations** never fail silently: error toast with the actionable message + rollback of the optimistic update.
- **Realtime errors** (`error` event / `step.failed`) render as first-class run UI (failing step), not as a generic toast.
- **Logging:** errors piped to Sentry with `traceId`, team, route, and the AppError kind (PII-scrubbed).

---

## 7.7 Loading & skeleton strategy

- **Three loading tiers:** (1) route-level RSC `loading.tsx` = shell + page skeleton (instant on nav); (2) component-level skeletons for async regions; (3) inline spinners only for button-scoped actions.
- **Skeletons mirror final layout** (same grid, same row count, tabular-num widths) → zero CLS. `DataTable` renders N skeleton rows matching page size.
- **Streaming UI:** for run/log/reasoning, never block on "loading" — render the REST snapshot immediately, then append stream events. A subtle "live" pulse indicates the stream is attached.
- **Suspense + prefetch:** hover/intent prefetch of detail routes (`router.prefetch`) and `queryClient.prefetchQuery` on row hover so drill-downs feel instant.
- **Optimistic transitions:** `useOptimistic`/Query optimistic updates for toggles and renames so the UI responds before the round-trip.

---

## 7.8 Permission / RBAC handling

**Model:** `permission = resource:action` (e.g., `agent:create`, `run:cancel`, `billing:read`, `settings:write`). Roles map to permission sets (doc 01 §4.10 matrix). The **frontend enforces UX, the backend enforces truth** — every gated action is also authorized server-side.

```ts
// lib/auth/permissions.ts
type Resource = "agent"|"workflow"|"run"|"tool"|"memory"|"eval"|"settings"|"billing"|"audit";
type Action   = "read"|"create"|"update"|"delete"|"run"|"approve"|"control";
type Permission = `${Resource}:${Action}`;

// session carries resolved permissions for the active team
useRbac(): { can: (p: Permission) => boolean; role: Role };
```

- **`<RbacGate permission="run:control">`** wraps controls → renders the action, a disabled+tooltip variant, or a fallback. Used for: run controls, approvals, publish, delete, settings tabs, provider/key management.
- **Route guards:** the `[team]/layout.tsx` checks team membership + redirects; settings sub-routes check `settings:read`. Server components read the session server-side; no flash of forbidden content.
- **Approvals** specifically gate on `run:approve` *and* the workflow's configured approver role — the frontend shows the Approve/Reject card only to eligible users; others see "awaiting approval by <role>".
- **Graceful degradation:** missing permission → informative panel/tooltip, never a dead button or blank screen. Bulk actions filter to the permitted subset.

---

## 7.9 Security considerations

- **Token handling:** access/refresh in **httpOnly, Secure, SameSite=Lax cookies**; no JWT in `localStorage`. CSRF via double-submit token header on mutating requests. The BFF holds provider/tool secrets — they never reach the browser.
- **Secrets in UI are write-only:** API keys, provider keys, connection strings are masked, never returned by `GET`. Display shows last-4 + created/last-used; "reveal" is not offered.
- **Output safety:** agent outputs, tool responses, logs, and RAG content are **untrusted** — render as text, never `dangerouslySetInnerHTML`. Markdown from agents is sanitized (allowlist) before render; JSON shown via `JsonViewer` (no eval).
- **CSP:** strict `Content-Security-Policy` (no inline scripts except nonce'd Next runtime, `connect-src` limited to API + SSE/WS origins, `frame-ancestors 'none'`). HSTS, `X-Content-Type-Options`, `Referrer-Policy: same-origin`.
- **PII/redaction:** PII redaction is a backend policy, but the UI honors `redacted` field markers (shows "▮ redacted" placeholders) and never logs raw payloads to the console in prod.
- **Prod blast-radius:** the `env` selector makes prod visually distinct; "Run in prod", key rotation, and member-removal require `ConfirmDialog` + are written to the audit log. Idempotency keys prevent accidental double-runs.
- **Dependency & supply chain:** pinned lockfile (`bun.lockb`), `bun audit` in CI, Subresource Integrity for any external assets (prefer self-hosted fonts/icons → none external).
- **Rate-limit feedback:** 429s surface as retryable banners with the reset time; the client respects `Retry-After`.
