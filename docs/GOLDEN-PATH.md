# Golden Path — manual run (MVP acceptance)

Closes the loop end-to-end with **zero mocked data**: a brand-new visitor signs up, creates an
org, runs an agent, reviews the run, approves a learned memory, and sees it injected into the
next run. Automated proof lives in `apps/engine/src/moat-integration.test.ts`; this is the manual
walk-through.

## Prerequisites
Shared dev infra up (run `docker ps` — reuse `infra-postgres`, `infra-redis`, `infra-mailpit`):

```bash
# 1. apply migrations (creates learning + auth tables)
cd apps/engine && bun run db:migrate

# 2. engine (control plane). For real auth enforcement set AUTH_DEV_HEADERS=false.
AUTH_DEV_HEADERS=false bun run start          # :8787

# 3. daemon (execution) — runtimes echo + claude. Use the org-scoped token from onboarding.
cd apps/daemon && go run ./cmd/daemon --engine http://localhost:8787 --token <ORG_DAEMON_TOKEN>

# 4. web (UX) — real engine by default (MSW is opt-in via NEXT_PUBLIC_USE_MOCK=true)
cd apps/web && bun run dev                     # :3333
```

## Walk-through
1. Visit `/` → the landing page (Apple-font theme) → **Start free**.
2. **Sign up** (email + password). A session cookie is set; you land on **/onboarding**.
3. **Create organization** (name + slug) → you become `owner`. The success screen shows the
   **org-scoped daemon connect command** (copy the token into step 3 above).
4. **Create your first agent**, then **publish** it → writes an immutable `agent_versions` row.
5. **Run** the agent (echo first, then `claude`) → watch it live in the Run View (SSE).
6. When the run finishes, open **Reviews** (`/{org}/reviews`): a pending `run_review` lists the
   proposed memory/skill changes from the deterministic review agent.
7. **Approve** a memory change → it becomes a `memory_entries` row (status → `applied`). Nothing
   is mutated without this approval.
8. **Run the agent again** → the engine resolves the live version's memory/skill policy, and the
   daemon receives the approved memory folded into the task prompt. The loop has compounded.

## Tenancy / RBAC checks
- Unauthenticated request to any org route → **401** (with `AUTH_DEV_HEADERS=false`).
- A second org cannot see the first org's agents/runs (server-derived `orgId`).
- RBAC is enforced on the engine (`requirePermission`), not just hidden in the UI.

## What's deterministic & offline
The review agent is rule-based, so the loop is testable without an LLM. Swap it for an LLM
reviewer behind the same `ReviewAgentOutput` contract without touching the rest of the loop.
