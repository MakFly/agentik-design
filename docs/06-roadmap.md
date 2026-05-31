# 06 · Suggested Implementation Roadmap

Sequenced to deliver a usable slice early, de-risk the hard realtime/canvas pieces, and build on a stable foundation. Estimates assume a senior squad of **3–4 FE engineers + 1 designer**; phases are ~2-week sprints. Adjust to team size — the *ordering* and *exit criteria* matter more than the weeks.

```
P0 Foundation ─▶ P1 Read-only core ─▶ P2 Live runs ─▶ P3 Authoring ─▶ P4 Canvas
                                                                          │
        P7 Hardening ◀─ P6 Evals + Memory ◀─ P5 Tools + Observability ◀──┘
```

---

## Phase 0 — Foundation & design system (Sprint 1)

**Goal:** a buildable skeleton the rest of the team can move fast on.

- Next.js App Router + TS strict + Tailwind v4 + shadcn/ui init; **design tokens** (doc 02 §6) wired (light/dark, density).
- `AppShell`, `Sidebar`, `Topbar`, `PageHeader`, command palette skeleton, theme + density toggles.
- `lib/api` typed client + zod boundary + **error normalizer**; **MSW** mock server covering the full contract (doc 04 §9) so FE is unblocked from BE.
- TanStack Query + Zustand providers; query-key factory; RBAC primitives (`useRbac`, `RbacGate`) with a mocked session.
- Tier-3 shared kit stubs in **Storybook**: `DataTable`, `StatusBadge`, `EmptyState`, `ErrorState`, `StatCard`, `CostMeter`. CI: lint, typecheck, a11y lint, size-limit, Vitest, Playwright skeleton.

**Exit:** app boots, navigates the full route map against mocks, dark/light + density work, Storybook live, CI green.

---

## Phase 1 — Read-only core (Sprints 2–3)

**Goal:** the observe surface, no realtime yet.

- **Dashboard** (cards, activity, performance — polling, not SSE).
- **Agent Registry** (DataTable, faceted filters, health badges, agent overview page).
- **Runs list** + **Task Execution View in replay mode** (completed runs from REST: timeline, focus panel, tool calls, logs, cost, errors).
- Full **empty/loading/error** triad on every screen; skeletons with zero CLS.

**Exit:** a user can browse agents, runs, and fully inspect a completed run. A11y pass on these screens.

---

## Phase 2 — Live runs (Sprints 4–5) — *highest-risk, do early*

**Goal:** realtime execution — the product's beating heart.

- SSE client (`useRunStream`), `runStream.store`, event reducer (doc 04 §10), rAF-coalesced deltas, reconnect + `Last-Event-ID` replay.
- WS control channel: **pause/resume/cancel**, **retry step**, with optimistic + ack reconciliation.
- **Approvals**: inline `ApprovalCard` + global approvals tray + live badges, RBAC-gated.
- Dashboard "Live runs" + status bar go realtime.

**Exit:** watch a live run end-to-end, intervene (pause/cancel/retry), approve a gate; reconnect survives a dropped connection without data loss. Load-test the stream (many concurrent runs).

---

## Phase 3 — Authoring: Agent Builder (Sprints 6–7)

**Goal:** create/edit/publish agents with confidence.

- Two-pane builder: all sections (identity → guardrails), autosave draft, validation, prompt editor (lazy Monaco/CodeMirror) with variables + token count.
- **Versioning + publish** (diff + changelog), version history.
- **Test harness** reusing Phase-2 run components (sandbox run with live trace).

**Exit:** author an agent from scratch, test it live, publish v1, run it, see it in the registry. Eval-gate hook stubbed for Phase 6.

---

## Phase 4 — Workflow Builder canvas (Sprints 8–10) — *second-highest risk*

**Goal:** visual orchestration.

- React Flow (lazy): palette, all node types, typed handles, inspector, IO mapping.
- Continuous **graph validation**; undo/redo (`canvas.store`); autosave; versioning/publish.
- **Test overlay**: nodes light up live (reuse SSE), failing node → inspect + retry-from-here.
- Keyboard/list a11y fallback for the canvas; mobile read-only mode.

**Exit:** build, validate, test, publish, and run a multi-node workflow (incl. decision + approval + tool nodes) end-to-end.

---

## Phase 5 — Tools & Observability (Sprints 11–12)

**Goal:** integrations + system-of-record.

- **Tool Management**: catalog, connect flows per auth type, least-priv scopes, first-class **test-connection**, usage/dependents, write-only secrets.
- **Observability**: traces list + waterfall + span detail; metrics dashboards; log explorer (virtualized, live-tail); **cost** breakdowns; failure analysis; prompt-version overlay.

**Exit:** connect & test all core tool types; trace a run to span level; attribute a cost/quality change to a version.

---

## Phase 6 — Evaluation Center & Memory (Sprints 13–14)

**Goal:** quality loop + knowledge.

- **Memory & KB**: stores, source ingestion pipeline (upload/crawl/connector) with per-stage progress, retrieval search/inspect, citations, retention policy.
- **Evaluation Center**: datasets, scorers (exact/regex/llm-judge/human/code), eval runs, **A/B compare with significance + regression list**, human-feedback queue, **publish-gate on eval pass** (wire the Phase-3 hook).

**Exit:** ingest sources + debug retrieval; run an A/B eval, see regressions, gate a publish on results.

---

## Phase 7 — Governance, hardening & launch (Sprints 15–16)

**Goal:** enterprise-ready.

- **Settings**: API keys, providers (+fallback/ceiling), team/SSO/SCIM, **RBAC matrix + custom roles**, billing, security policies, **audit log**.
- Security pass: CSP, cookie/CSRF, secret handling, output sanitization, `bun audit`.
- Performance pass to budgets (bundle splitting, virtualization audit, Web-Vitals); full a11y audit (axe + screen-reader) on all flows.
- **Onboarding** wizard; docs/help; error-reporting (Sentry) + Web-Vitals telemetry live.

**Exit:** RBAC enforced UX + server; audit log complete; meets perf/a11y budgets; onboarding turns an empty team into a first successful run.

---

## Cross-cutting tracks (run continuously, every phase)

| Track | Practice |
|-------|----------|
| **Testing** | Vitest (units/hooks/reducers) · Playwright e2e per flow (doc 11) with `axe` · MSW for deterministic data · visual regression on Storybook |
| **Type safety** | OpenAPI → `types/api.ts` regenerated in CI; zod at boundaries; branded IDs |
| **Design system** | every new component lands in Storybook with all states (loading/empty/error/rtl/dark) before use |
| **Perf budget** | `size-limit` per route in CI; Lighthouse synthetic on PRs |
| **A11y** | `jsx-a11y` lint + `axe` e2e gate; manual SR pass on run view + canvas each release |
| **Docs** | keep these `docs/` specs in sync; ADRs for deviations |

---

## Sequencing rationale (why this order)

1. **Realtime (P2) before authoring (P3)** — it's the riskiest, most differentiating piece and everything authoring *tests against* it (the test harness reuses run components). De-risk it while the team is fresh.
2. **Read-only (P1) before live (P2)** — a static snapshot is the fallback the live view degrades to; building it first means the live view is never blank.
3. **Canvas (P4) after the builder** — it composes the same primitives (inspector, validation, versioning, test overlay) the agent builder establishes; reuse, don't reinvent.
4. **Observability (P5) before Evals (P6)** — evals link to traces; you need the trace UI first.
5. **Governance last (P7)** — RBAC *primitives* exist from P0 (so gating is correct throughout), but the full settings/audit/billing surface is the final hardening layer.

## Definition of done (per feature)

A feature ships only when it has: ✅ all three states (loading/empty/error) · ✅ RBAC gating · ✅ keyboard + screen-reader pass · ✅ Storybook entry · ✅ e2e covering the primary flow · ✅ within route bundle budget · ✅ realtime reconnection handled (where applicable).
