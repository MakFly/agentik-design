# Agentik MVP — Build Progress Checkpoint

> Loop-driven build against `AGENTIK_MVP_GUIDELINE.md`. Each `/loop` fire reads this file
> first to know where the last iteration stopped, does one bounded chunk, then updates it.
> Dates human-facing `dd-mm-yyyy`; data ISO.

## Status legend
`[ ]` not started · `[~]` in progress · `[x]` done & verified

## Phases
- [~] **Phase A** — Domain foundation: Zod schemas + Drizzle tables + tests
  - [x] Zod schemas in `packages/workflow-schema/src/` (runtime, agent, memory, skill, review) + re-export
  - [x] Drizzle tables `agent_versions`, `memory_entries`, `skills`, `skill_versions`, `run_reviews`
  - [x] id prefixes in `db/ids.ts` (aver, mem, skill, sver, rev)
  - [x] migration generated: `drizzle/0003_chemical_colonel_america.sql` (5 CREATE, 2 FK, 0 DROP)
  - [x] tests `packages/workflow-schema/src/learning.test.ts` (7 pass)
  - [x] verify: schema tsc=0, engine tsc=0, engine+schema `bun test` green
  - [x] repos: `apps/engine/src/learning-repo.ts` (agent versions, memory, skills, reviews)
        + pure helpers `nextVersion` / `selectMemoriesForInjection` / `selectSkillsForInjection`
        (offline-testable) + `learning-repo.test.ts` (engine 8 tests pass)
  - **Phase A DONE & verified.**
- [~] **Phase 0** — better-auth org tenancy backbone (server-derived orgId, RBAC, daemon token)
  - AUDIT (iter 2): the client-supplied tenancy is **one middleware** —
    `apps/engine/src/server.ts:52-58` `api.use("*")` reads `x-team` header (default "acme") →
    `resolveTeam(slug)` (in `repo.ts`) → `c.set("teamId", …)`. Every route reads `c.get("teamId")`.
    So replacing that single middleware with a session→orgId resolver flows everywhere (low blast radius).
  - RBAC config lives in `apps/web/config/permissions.ts` (currently web-only; must enforce on engine).
  - Mocked session: `apps/web/lib/stores/session.store.ts`. better-auth NOT yet a dependency.
  - iter 3 DONE (RBAC backbone + auth seam, all offline/green):
    - [x] RBAC model moved to shared `packages/workflow-schema/src/rbac.ts` (+ `skill`/`review`
          resources, `review:approve`); `apps/web/config/permissions.ts` re-exports it (8 web
          importers intact). Single source of truth — no web/engine drift.
    - [x] Engine auth seam `apps/engine/src/auth.ts`: `AuthContext{userId,orgId,role}`, `withAuth`
          middleware (dev resolver = x-team/x-role headers, the ONLY thing better-auth swaps),
          `requirePermission(p)` → 403. Wired into `server.ts` (replaced inline x-team middleware).
    - [x] tests `rbac.test.ts` (matrix); verify: schema/engine/**web** tsc=0, schema 12 + engine 8 pass.
  - REMAINING Phase 0 (needs a RUNNING stack to verify — code-only in loop, integration deferred):
    (1) add better-auth + org plugin dep + its Drizzle tables/migration + mount Hono handler;
    (2) swap `resolveAuth` to read the verified session; (3) email+pw+verify (Mailpit) + invites;
    (4) org-scoped daemon token; (5) web sign-up/login backing `session.store` with real data.
    Pre-mortem: ONE auth flow only (no SSO/seats); don't rewrite session.store shape — back it.
- [ ] **Phase B** — Agent versions real (`publishAgent` writes `agent_versions`)
- [ ] **Phase C** — Web ↔ engine core read path (agents/runs/Run View on real engine + SSE)
- [ ] **Phase D** — Review loop backend (deterministic reviewer → run_reviews → approve/reject apply)
- [ ] **Phase E** — Review Inbox UI + memory/skill injection into daemon RuntimeContext
- [ ] **Phase F** — Hardening (error/empty states, RBAC on approval, audit log, a11y)
- [ ] **Phase G** — Lean landing (Apple font theme) + first-run wizard

## Decisions / notes
- Zod v4, Drizzle 0.38, drizzle-kit 0.30. Bun workspaces.
- Schema pkg keeps name `@agentik/workflow-schema` (misnomer noted; rename is post-MVP).
- n8n engine PARKED — do not touch `packages/workflow-engine`, `workflows`, `workflow_versions`.
- Landing requirement (user): **Apple-style font theme** ("agentik" brand).

## Last iteration
- 22-06-2026 — iter 1: audited repo (matches guideline §3). Phase A schemas+tables+migration+tests
  DONE & verified (schema/engine tsc=0, tests green). Committed. NEXT: Phase A repos, then Phase 0.
