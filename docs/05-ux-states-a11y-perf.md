# 05 · UX Flows · States · Accessibility · Performance

---

## 11. UX flows

Each flow is the happy path + the critical branches, expressed as the screens/components touched. These are the journeys the design is optimized for.

### 11.1 Author → ship an agent

```
Registry ─[+ New]─▶ Agent Builder (draft autosaves)
   │                   │ fill identity/model/prompt/tools/memory/limits/guardrails
   │                   ▼
   │              Test ▷ ── sandbox run ──▶ live trace in right panel
   │                   │   pass?                          fail? → fix → Test ▷ (loop)
   │                   ▼
   │              Publish ▾ ── diff + changelog modal ──▶ AgentVersion v(n)
   │                   │   [optional] "publish + run eval suite"
   ▼                   ▼
Registry (agent now healthy, v(n) live) ──▶ optionally wire into a Workflow
```
**Success criteria:** valid config, test run succeeded, version published with changelog. **Verify:** registry shows new version live; eval (if gated) passed.

### 11.2 Compose & run a workflow

```
Workflows ─[+ New]─▶ Canvas: drag Trigger→Agent→Decision→Approval→Tool→End, map IO
   │                   │ continuous validation (badges) → fix problems
   │                   ▼
   │              Test ▷ ── canvas overlay lights up nodes live ──▶ inspect failing node → retry
   │                   ▼
   │              Publish ▾ ─▶ WorkflowVersion
   ▼                   ▼
   └────────────▶ Run (manual/webhook/schedule) ─▶ Task Execution View (live)
```

### 11.3 Supervise a live run + approve (the operator flow)

```
Dashboard (Live runs) / Approvals tray ─▶ Task Execution View (run_X)
   │  watch timeline append · read reasoning · expand tool calls · track cost meter
   ▼
Step ✋ waiting_approval ─▶ ApprovalCard (context: refund $520, customer cus_…)
   │   RBAC: run:approve + matching role
   ├─ Approve (reason) ─▶ run resumes ─▶ Stripe refund step runs ─▶ End ✓
   └─ Reject (reason)  ─▶ run routes to "reject" branch / ends
```
**Always answerable on this screen:** what it's doing (current step) · why (reasoning) · which tools (tool calls) · what failed (error-first focus panel) · cost (meter) · what's retryable/approvable (inline controls).

### 11.4 Diagnose a failure

```
Dashboard "Failed (7)" ─▶ Runs list (status=failed) ─▶ Run (failed step auto-selected, red)
   │  read StepError (kind, code, message) + tool call response + logs
   ├─ Retry step (attempt 2)  ── transient (rate_limit/provider) → likely fixes
   ├─ Open trace ─▶ Observability waterfall ─▶ span detail (input/output/attrs)
   └─ Edit agent/workflow version ─▶ Builder pre-loaded ─▶ fix → publish → re-run
        └─ Observability: prompt-version overlay confirms the fix lowered error rate
```

### 11.5 Connect a tool

```
Tools ─[+ Connect]─▶ Catalog ─▶ pick (e.g. Stripe) ─▶ auth (OAuth/key) + select least-priv scopes
   ▼
Test connection ── per-scope checks ──▶ all green? Save : show failing check + remedy → fix → re-test
   ▼
Tool connected (shows "used by" once agents/workflows grant it)
```

### 11.6 Evaluate before promoting

```
Evals ─▶ Suite ─[Run]─▶ pick targets (v4 vs v3 / opus vs sonnet) ─▶ live progress
   ▼
A/B compare ─▶ metric deltas + significance + regression list
   ├─ better & no PII regressions ─▶ promote v4 to live (or set as default)
   └─ regressions found ─▶ inspect failing cases (input/expected/got + traces) ─▶ back to Builder
```

### 11.7 First-run onboarding

```
Accept invite ─▶ Onboarding wizard:
  1. Connect a model provider (key)  →  2. Connect first tool  →  3. Create agent from template
  →  4. Run it once (guided)  →  Dashboard (now populated, empty states resolved)
```

---

## 12. Error / loading / empty states

A consistent triad for every async surface. Components: `ErrorState`, `EmptyState`, skeletons.

### 12.1 Loading

| Surface | Loading treatment |
|---------|-------------------|
| Route change | `loading.tsx`: shell + page-shaped skeleton (no spinner-on-blank) |
| Tables/lists | N skeleton rows matching page size + column widths (tabular) |
| Cards/charts | shimmer block at final dimensions (zero CLS) |
| Builders | section skeletons with step-nav intact |
| Run/logs/reasoning | render REST snapshot instantly, then stream; "live" pulse, never a blocking spinner |
| Buttons | inline spinner + disabled, label → "Saving…" (preserve width) |

### 12.2 Empty

| Context | Empty state |
|---------|-------------|
| New team / no agents | Hero: "Build your first agent" + template gallery + 3-step checklist |
| Filtered list, no match | "No results for these filters" + **Clear filters** (don't show the generic create CTA) |
| No tools connected | Inline in builder: "Connect a tool to grant capabilities" → Catalog |
| No memory sources | "Add a source to enable retrieval" → upload/crawl/connect |
| No runs yet | "Run an agent or workflow to see executions here" + Run CTA |
| Search no hits | "Nothing matched. Try broader terms / lower the score threshold." |
| No eval baseline | "Run a baseline version first to enable comparison." |

> Empty ≠ error ≠ loading. They look different and offer different next actions. Empty is an *invitation*; error is a *recovery*; loading is *patience*.

### 12.3 Error (by kind → treatment)

| Kind | Where | Treatment |
|------|-------|-----------|
| `validation` | forms/builders | inline field error (`aria-describedby`) + section badge; no toast |
| `forbidden` | any gated action/route | informative panel/tooltip ("needs `run:approve`"), never blank/dead button |
| `not_found` | detail routes | "This {entity} doesn't exist or was deleted" + back link |
| `rate_limit` / `provider` | runs, mutations | retryable banner with countdown (`Retry-After`) + Retry |
| `network` / offline | global | offline chip; queries auto-retry; toast on mutation failure |
| `conflict` (409) | publish/edit | "Updated by someone else" + reload-diff option |
| `budget_exceeded` | run | terminal banner: cost cap hit; partial cost shown; "raise cap & re-run" |
| `server` / `unknown` | boundaries | `ErrorState`: friendly message + `traceId` + Report + Retry |
| stream fatal | run view | reconnect chip + backoff; last snapshot retained |

Every error carries a `traceId` linking to Observability for support. Errors are logged to Sentry (PII-scrubbed).

---

## 13. Accessibility (WCAG 2.2 AA target)

- **Semantics & landmarks:** one `<main>`, `<nav aria-label>` for primary/secondary, `<header>`; headings strictly ordered (no skipped levels). Tables use real `<table>` semantics (`scope`, `<caption>` sr-only).
- **Keyboard:** every interactive element reachable & operable; **command palette `⌘K`**, `g`-prefixed go-to (g d/a/w/r/t/m/o/e/s), `j/k` row nav, `/` focus search, `?` shortcuts cheatsheet, `Esc` closes overlays. No keyboard traps; logical focus order; **focus returns** to the trigger when a Dialog/Sheet closes.
- **Focus visibility:** `:focus-visible` ring using `--ring` on every focusable; never `outline:none` without a replacement. Skip-to-content link.
- **Radix/shadcn** primitives give us correct roles/ARIA for Dialog, Sheet, Tabs, Combobox, Menu, Tooltip, Toast out of the box — we keep their semantics intact.
- **Color & contrast:** all text ≥ 4.5:1 (≥3:1 large); **status never encoded by color alone** — always paired with an icon/shape and text (e.g., failed = red + ✗ + "Failed"). Verified in both themes (OKLCH tokens chosen for AA).
- **Live regions:** run status changes, approvals, toasts use `aria-live="polite"` (assertive for failures). Streaming reasoning is in a labelled region announced as "agent reasoning, updating"; we throttle announcements (don't read every token).
- **Forms:** `<label>` for every field, `aria-invalid` + `aria-describedby` on errors, `aria-required`; error summary focuses first invalid field on submit.
- **Canvas (workflow):** React Flow is pointer-centric → we add a **keyboard/list fallback**: a node list with add/connect/configure via keyboard, and `aria` descriptions of connections, so the canvas isn't mouse-only.
- **Motion:** `prefers-reduced-motion` disables non-essential animation (pulses, slides become instant); streaming still works (text just appears).
- **Targets & zoom:** touch targets ≥44px; layout reflows to 320px and at 200% zoom with no horizontal scroll or loss of function.
- **Testing:** `eslint-plugin-jsx-a11y` in CI, `axe-core` in Playwright e2e on key screens, manual screen-reader pass (VoiceOver/NVDA) for the run view + builder before each release.

---

## 14. Performance optimization strategy

**Targets:** LCP < 2.5s, CLS < 0.1, INP < 200ms, TTI fast on mid-range laptops; smooth (60fps) streaming run view and canvas pan/zoom.

### 14.1 Loading & bundles
- **RSC-first**: shell + initial data server-rendered; ship minimal client JS. Route-level **code splitting** (App Router default) + `next/dynamic` for heavy, rarely-first-paint chunks: **Monaco/CodeMirror, React Flow canvas, Recharts/visx, JsonViewer** are lazy-loaded.
- **Per-route budgets** (CI-enforced via `size-limit`): shell+dashboard ≤ ~180KB gz initial; builder/canvas/observability lazy beyond that.
- Tree-shakeable icon imports (Lucide per-icon); self-hosted variable fonts with `font-display: swap` + preload (no external font requests → better CSP + LCP).
- `next/image` for any raster; prefer inline SVG/icons. Prefetch detail routes on row hover/intent.

### 14.2 Rendering & data
- **Virtualization** (`@tanstack/react-virtual`) for: runs/audit/agent tables, log streams, trace lists, memory chunks — render only visible rows.
- **TanStack Query** caching + prefetch + `staleTime` avoids redundant fetches; `placeholderData: keepPreviousData` for paginated/ filtered lists (no flash on filter change).
- **Selector-scoped Zustand** so a token delta re-renders only the focused step, not the timeline. `memo`/`useMemo` on row + chart components; stable keys.
- **Streaming throughput:** coalesce `reasoning.delta`/`log.line` and flush on `requestAnimationFrame`; cap retained log lines (virtualized window) with "load earlier" from REST; debounce cost-meter paints.

### 14.3 Canvas specifics
- React Flow with `onlyRenderVisibleElements`, memoized custom nodes, throttled `onNodesChange`; minimap on a separate layer; large graphs (>200 nodes) switch to simplified node rendering at low zoom (LOD).

### 14.4 Mobile/GPU
- No `backdrop-blur` on full-screen overlays; `transition-transform` (not `transition-all`) + `will-change-transform` on sliding sheets; `content-visibility: auto` on long off-screen sections; `min-h-dvh` to avoid mobile viewport reflow jank.

### 14.5 Network
- HTTP/2+, gzip/br; ETags + conditional requests on detail fetches; single multiplexed WS for control + multiple run subscriptions; SSE coalescing server-side; debounced autosave (builders) to cut write chatter.

### 14.6 Monitoring
- Web-Vitals (LCP/CLS/INP) reported to analytics; Sentry performance traces on builder/run/canvas; per-route bundle report in CI; synthetic Lighthouse budget check on PRs.
