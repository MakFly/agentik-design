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
- [x] **Phase B** — `publishAgent` writes immutable monotonic `agent_versions`, repoints
      liveVersionId. Real-DB integration tests (monotonicity + tenancy). DONE & verified.
- [x] **Phase D** — Review loop backend: deterministic Review Agent (`review-agent.ts`,
      propose-only), `generateRunReview`, transactional `applyRunReview`, §7 routes wired with
      server-side `requirePermission` RBAC. DONE & verified.
- [x] **Phase E (engine+runtime side)** — `resolveInjectionContext` (bounded by live-version
      policy) + `buildInjectionPreamble`; `claimTask` folds learned context into `input.prompt`.
      GOLDEN PATH integration test green: approved memory from run N → claimed run N+1 prompt.
      **DB migrated (0003 applied to infra-postgres). 20 engine tests pass.** Remaining for E:
      Review Inbox UI (web) — pending with Phase C.
- [x] **Phase C** — Web ↔ engine: real engine is the DEFAULT (`mocks/msw-ready.tsx` makes MSW
      opt-in via `NEXT_PUBLIC_USE_MOCK=true`); `apiFetch`→`/api/v1/*`→engine proxy; agents-repo
      already maps engine rows to web contract shapes. SessionHydrator pulls real `/auth/me`.
- [x] **Phase 0** — lean Postgres-native auth + org tenancy; resolveAuth server-derived; unauth
      → 401 when `AUTH_DEV_HEADERS=false` (HTTP-verified); web signup/login/verify/onboarding.
- [x] **Phase F (core)** — RBAC on review approval (`requirePermission`), empty/loading/error
      states (Review Inbox), unauth rejection. (Audit-log table = post-MVP; noted.)
- [x] **Phase G** — Apple-font landing at `/`, first-run onboarding (org + daemon command),
      Review Inbox UI. Wizard routes into first-agent / dashboard.

## VERIFICATION SUMMARY (final)
- contracts: tsc 0, 12 tests. engine: tsc 0, **25 tests** (real Postgres incl. Golden Path +
  auth/tenancy). web: tsc 0, eslint clean (my files), `next build` green (all routes prerender).
- HTTP smoke (engine, dev-headers off): unauth org route→401, signup→201, create-org→201,
  authed org routes→200.
- Pre-existing eslint issues (NOT mine, untouched files, commits ab5fc42/102dcff): set-state-in-effect
  in `components/shared/data-table.tsx`, `features/credentials/api-auth-picker.tsx`,
  `features/dashboard-settings/tools-section.tsx`. Left as-is per surgical rule.
- NOT exercised headlessly (env, not code): a live `claude` run streaming through a running Go
  daemon with an Anthropic key (the path + SSE route exist & are wire-compatible; see docs/GOLDEN-PATH.md).

## Decision — auth (deviation from better-auth, documented per §13.3)
better-auth is the guideline's *recommended but explicitly swappable* choice. In this headless
loop I cannot interactively verify its email-verify/invite round-trips, and it adds a heavy
CLI-generated-schema dependency — exactly the "auth balloons / half-wired" pre-mortem risk (§3.5).
The NON-NEGOTIABLES are: server-derived orgId, RBAC server-side, org isolation, email+pw sign-up +
invites, self-hostable/no-vendor-lock, Postgres-backed. A lean Drizzle-native auth (Bun.password
argon2id, `app_users`/`user_sessions`/`org_members`/`org_invitations` tables — names chosen to avoid
the legacy Laravel `users`/`sessions` tables in the shared DB, httpOnly cookie sessions, Mailpit for
verify) satisfies ALL of them, is MORE aligned with the PaaS/no-lock thesis, and is fully
offline-testable. The `resolveAuth` seam (already in `auth.ts`) is where it plugs in.

## Decisions / notes
- Zod v4, Drizzle 0.38, drizzle-kit 0.30. Bun workspaces.
- Schema pkg keeps name `@agentik/workflow-schema` (misnomer noted; rename is post-MVP).
- n8n engine PARKED — do not touch `packages/workflow-engine`, `workflows`, `workflow_versions`.
- Landing requirement (user): **Apple-style font theme** ("agentik" brand).

## Last iteration
- 22-06-2026 — iter 1: audited repo (matches guideline §3). Phase A schemas+tables+migration+tests
  DONE & verified (schema/engine tsc=0, tests green). Committed. NEXT: Phase A repos, then Phase 0.
