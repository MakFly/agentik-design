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
  - [ ] **NEXT:** repos in `apps/engine/src/` per entity (mirror `agents-repo.ts`)
- [ ] **Phase 0** — better-auth org tenancy backbone (server-derived orgId, RBAC, daemon token)
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
