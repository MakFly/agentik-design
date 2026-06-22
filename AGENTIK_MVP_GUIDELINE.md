# Agentik — MVP Build Guideline

> **Purpose of this file.** This is the single, authoritative prompt/guideline to feed an
> agentic coding tool (Codex / Claude Code) to take Agentik from its current state to a
> **shippable MVP**. It supersedes earlier "product direction" prompts.
>
> **Hard scope decision (read first):** the **n8n-style workflow engine is OUT of the MVP**.
> `packages/workflow-engine`, `packages/workflow-schema` graph code, the `workflows` /
> `workflow_versions` tables, and the Workflow Canvas (P4) are **parked** — do not build on
> them, do not extend them, do not let them grow. They stay compilable but frozen. The MVP is
> the **single-agent control loop**, not workflow orchestration.

You are a **Staff Product Engineer + Agent Runtime Architect + DevOps-oriented Fullstack
Engineer**, working inside the `agentik-design` monorepo. Move fast, stay additive, do not
rewrite the repo, do not overengineer.

---

## 1. What Agentik is (and is not)

Agentik is a **production control plane for AI agents**: create an agent → version it → run it
on an isolated runtime/daemon → observe the run live → approve risky actions → **review the
finished run and let it improve future runs through versioned memory & skills**.

Agentik is **not** a chatbot, a prompt playground, a UI-only builder, **and not an n8n / Hermes
clone**. The learning loop (review → propose → approve → versioned memory/skill → inject) is the
moat. Everything in the MVP exists to make that one loop real, end-to-end, for a single agent.

**Positioning:** PaaS-first, SaaS-packaged. The daemon/runtime split is core product, not an
implementation detail — customers must eventually run daemons in their own infra while using
Agentik as the control plane. Keep that boundary clean from day one.

---

## 2. MVP definition — the Golden Path

The MVP is **done** when a user can complete this loop without any mocked data:

```txt
1. Create an agent (name, role, goal, runtime, instructions)              [exists, mock → real]
2. Publish an immutable agent VERSION                                     [partial → real table]
3. Run that version on a real daemon runtime (echo, then claude)          [exists]
4. Watch the run live (reasoning, tool calls, logs, cost) via SSE         [exists, mock → real]
5. Approve/reject a risky action mid-run                                  [exists, wire to real]
6. On completion, a Review Agent proposes memory + skill changes          [NEW]
7. A human approves/rejects each proposed change                          [NEW]
8. Approved changes become versioned memory entries / skill versions      [NEW]
9. The NEXT run of that agent injects the approved memory/skills          [NEW — the moat]
```

If steps 6→9 don't work end-to-end, the MVP is not shipped. Steps 1→5 already exist in some form
(real in engine/daemon, mocked in web) — the work there is **connect web to engine** and harden.

**Onboarding precondition (step 0).** The loop above assumes a real **organization** and a real
**authenticated user** exist. Today they don't — the session is mocked and `teamId` is trusted
from the client (see §3, §3.5). So the MVP also requires a **lean landing → sign-up → create org
→ first-run wizard** path, and **server-side tenancy/RBAC enforcement**. Without it "works by org"
is fiction and no second team can ever enter. This is table-stakes, not the moat — keep it lean
(§3.5).

**Out of MVP:** workflows/canvas (n8n), billing & seats, SSO/SAML, email-domain auto-join,
marketplace, vector DB / embeddings, fine-tuning, Kubernetes, auto-applying changes without
approval, multi-agent orchestration, a full marketing website (only a **lean** landing ships).
Document them as "later", build none of them.

---

## 3. Current repo reality (audit baseline — do not re-derive, verify before extending)

Monorepo, **Bun workspaces** (`apps/*`, `packages/*`). Verified state:

| Area | Path | State | MVP action |
|------|------|-------|-----------|
| Web dashboard | `apps/web` | Next.js 16 / React 19 / TS strict / Tailwind v4. P0–P3 done but **100% MSW-mocked** (agents, runs, builder, settings). | **Connect to real engine**, keep MSW only as dev fallback. |
| Auth / session | `apps/web/lib/stores/session.store.ts` | **Mocked single session**; role switched in-store to exercise RBAC. No real sign-up/login, no org creation, no landing. API keys are MSW. | **Add real auth + org onboarding** (§3.5). |
| Engine API | `apps/engine` | Hono/Bun + Drizzle/Postgres + BullMQ/Redis. Real routes: agents, `agents/test`, `agents/:id/publish`, runs, `runs/:id/approve`, `runs/:id/cancel`, `runs/:id/live` (SSE), daemon claim/heartbeat. | **Add learning-loop domain + routes.** |
| Daemon | `apps/daemon` | Go. Runtimes `echo` + `claude` (claude verified working). HTTP/JSON protocol in `internal/protocol`. | Inject memory/skills into task context; keep protocol in sync. |
| Schemas | `packages/workflow-schema` | Zod: `run.ts`, `api.ts`, `graph.ts`, `credentials.ts`. **Misnamed for our purpose** but it's the shared contract package. | **Add agent/memory/skill/review schemas here** (or a new `packages/agent-schema` — see §5). |
| Graph engine | `packages/workflow-engine` | n8n-style executor. | **PARKED. Do not touch.** |

**Engine DB tables that exist** (`apps/engine/src/db/schema.ts`): `teams`, `credentials`,
`workflows`, `workflow_versions`, `runs`, `run_steps`, `agents`, `daemons`, `runtimes`,
`agent_tasks`, `task_messages`.

**Critical gaps confirmed by reading the schema:**
- **No `agent_versions` table.** `agents` has `liveVersionId` / `draftVersionId` columns but
  versions are stored as inline `config` jsonb — `publishAgent()` just overwrites config. The MVP
  needs real immutable versions.
- **No `memory_entries`, `skills`, `skill_versions`, `run_reviews` tables.** The entire learning
  loop is greenfield.
- `agent_tasks` + `task_messages` already model a run + its streamed output — **reuse them**, do
  not invent a parallel "run" concept for agents.
- **No auth / no org lifecycle.** `teams` exists as a table but there is no sign-up, no org
  creation, no membership/invite flow, and `teamId` is not derived from a verified session — it is
  passed by the client. This is a tenancy + security gap, addressed in §3.5.

---

## 3.5 Landing, Auth & Org onboarding (table-stakes, kept lean)

> Added after a pre-mortem: the whole "control plane **for orgs/teams**" thesis is fiction while
> the session is mocked and `teamId` is client-supplied. A second org literally cannot exist. So a
> thin, real **identity + org** layer is in the MVP — but bounded hard to avoid the auth rabbit
> hole.

**Pre-mortem — why this could sink the project, and the guardrails:**
- *Auth balloons into SSO/SAML/seat-management* → **only one auth mechanism + invites ship;**
  SSO/SAML/billing/seats stay out (§2 Out of MVP).
- *Marketing-site scope creep* → the landing is **one lean page** (hero, value prop, CTA →
  sign-up), not a marketing project. No CMS, no blog, no pricing matrix.
- *Vendor lock-in contradicts the self-hosted PaaS positioning* (customers run daemons in their
  own infra) → **use a self-hostable, Postgres-backed, org-native auth** rather than a hosted SaaS.
- *Building the moat on the mocked session, then bolting auth on last* → RBAC never truly enforced,
  `teamId` spoofable, rework. → **the tenancy backbone lands early (Phase 0)**, the polished
  onboarding UX/landing land late (Phase G).

**Recommended auth (decision, swappable):** **better-auth** with its `organization` plugin —
Bun/Drizzle/Postgres friendly, self-hostable, models orgs + members + roles + invitations
natively, no vendor lock. Alternatives if rejected: Auth.js (more wiring for orgs) or a hosted
provider (Clerk/WorkOS — faster but SaaS lock-in, conflicts with the PaaS thesis). **Email +
password with email-verify, plus invitation links, is the only MVP flow.** One social provider is
optional, not required.

**Tenancy rule (non-negotiable):** `teamId`/`orgId` is **derived server-side from the session**,
never trusted from the client. Every engine route resolves the caller's org from the auth context;
RBAC (`config/permissions.ts`) is enforced **on the engine**, not just hidden in the UI.

```txt
Visitor → Landing (lean)
            │ CTA "Start"
            ▼
        Sign-up (email+password, verify) ──▶ Create Organization (name, slug)
            │                                      │ becomes owner
            │ invite teammates (link/email)        ▼
            ▼                                 First-run wizard
        Member accepts invite ───────────▶  1. create first agent
                                            2. connect a daemon (org-scoped token)
                                            3. run it → land in live Run View
            ▼
        Authenticated app: session ⇒ orgId ⇒ RBAC enforced on engine
```

```txt
── Components ────────────────────────────────────────────────────────────
  Landing   one fluid, mobile-first page (responsive-ui rule), CTA → sign-up
  Auth      better-auth (org plugin): users, orgs, memberships, invites, roles
  Wizard    create org → first agent → connect daemon (org token) → first run
  Engine    every route: orgId from session, RBAC enforced server-side
```

Map the existing `teams` table to the auth provider's organization (one **org = one team**); do
not introduce a second tenancy concept. Daemons register with an **org-scoped token** issued at
onboarding (replaces the mocked API-key path for the daemon connection).

---

## 4. Target architecture (MVP)

```txt
╔══════════════════════════ apps/web (Next.js 16) ═══════════════════════════╗
║  Dashboard · Agent Builder · Run View (live) · Approvals · Review Inbox     ║
║  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  ║
║  │ Agent CRUD/  │  │ Task Exec.   │  │ Approval     │  │ Review Inbox    │  ║
║  │ Versions UI  │  │ View (SSE)   │  │ Card         │  │ (NEW)           │  ║
║  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └───────┬────────┘  ║
╚═════════│═════════════════│═════════════════│══════════════════│═══════════╝
          │ REST/JSON       │ SSE (live)      │ POST approve     │ REST/JSON
          ▼                 ▼                 ▼                  ▼
╔══════════════════════════ apps/engine (Hono/Bun) ══════════════════════════╗
║  Control plane API · tenancy (teamId) · task queue (BullMQ) · review mgmt   ║
║  ┌────────────┐ ┌────────────┐ ┌─────────────┐ ┌──────────────────────┐    ║
║  │ agents +   │ │ tasks/runs │ │ approvals   │ │ run-reviews (NEW)    │    ║
║  │ versions   │ │ + messages │ │             │ │ + learning policies  │    ║
║  └─────┬──────┘ └─────┬──────┘ └──────┬──────┘ └──────────┬───────────┘    ║
║        │ Drizzle      │ claim         │                   │ propose-only    ║
╚════════│══════════════│═══════════════│═══════════════════│═════════════════╝
         │ SQL          │ HTTP/JSON     │                   │ SQL
         ▼              ▼ (claim/stream)▼                   ▼
   ┌───────────┐  ╔════════════════════════╗        ┌──────────────────┐
   │ Postgres  │  ║ apps/daemon (Go)       ║        │ Postgres         │
   │ + Redis   │  ║ runtimes: echo, claude ║◀──┐    │ memory / skills  │
   │ (BullMQ)  │  ║ injects memory+skills  ║   │    │ skill_versions   │
   └───────────┘  ╚════════════════════════╝   │    │ run_reviews      │
                          │ RuntimeEvent stream │    └──────────────────┘
                          └─────────────────────┘
                       (text|thinking|tool_use|tool_result|error|done)
```

```txt
── Legend ────────────────────────────────────────────────────────────────
  ──▶ REST/JSON sync call     ═══ deploy/boundary group     SSE = live stream
  Review is PROPOSE-ONLY: it never mutates production memory/skills directly.
  Daemon talks to engine ONLY over HTTP/JSON (apps/daemon/internal/protocol).

── Components ────────────────────────────────────────────────────────────
  web      UX only — no business logic, no direct DB
  engine   control-plane API, tenancy, queue, review management
  daemon   execution, runtime adapters, context injection, streaming
  Postgres durable domain state (Drizzle)   Redis  BullMQ task queue
```

**Boundary rules (non-negotiable):** `web = UX`, `engine = control-plane API`, `daemon =
execution`, `packages = contracts/reusable logic`. Do not collapse logic into the web app. Do not
let the daemon talk to Postgres directly — only through the engine HTTP contract.

---

## 5. Domain model to add

Keep existing conventions: **`text` ids** (see `apps/engine/src/db/ids.ts`), Drizzle `pgTable`,
jsonb for flexible fields, `teamId` on every row for tenancy. Schemas in **Zod** in the shared
package; DB tables in `apps/engine/src/db/schema.ts`.

> **Schema package decision:** add the new Zod schemas to `packages/workflow-schema/src/` in new
> files (`agent.ts`, `memory.ts`, `skill.ts`, `review.ts`, `runtime.ts`) and re-export from
> `index.ts`. Do **not** rename the package in the MVP (avoid churn). Note the misnomer in a
> comment; a rename to `@agentik/contracts` is a post-MVP chore.

### 5.1 AgentVersion (fills the real gap)

```ts
export type AgentVersion = {
  id: string;
  agentId: string;
  version: number;            // monotonic per agent
  model?: string;
  instructions: string;
  tools: string[];
  runtimeKind: RuntimeKind;
  memoryPolicy: MemoryPolicy; // see §6
  skillPolicy: SkillPolicy;
  createdBy: "user" | "system" | "review_agent";
  changelog?: string;
  createdAt: string;          // ISO 8601 in data; display dd-mm-yyyy
};
```
Migrate `publishAgent()` to write an immutable `agent_versions` row and point
`agents.liveVersionId` at it. Keep `config` jsonb readable for back-compat during transition.

### 5.2 MemoryEntry — declarative knowledge

```ts
export type MemoryEntry = {
  id: string; teamId: string;
  scope: "team" | "project" | "agent" | "workflow"; // "workflow" allowed but unused in MVP
  targetId?: string;
  content: string;
  sourceRunId?: string;        // = agent_tasks.id
  confidence: number;          // 0..1
  createdBy: "user" | "system" | "review_agent";
  createdAt: string; updatedAt: string;
};
```

### 5.3 Skill + SkillVersion — procedural knowledge (versioned)

```ts
export type Skill = {
  id: string; teamId: string; name: string; description: string;
  scope: "team" | "project" | "agent" | "workflow"; targetId?: string;
  currentVersionId?: string;
  createdBy: "user" | "system" | "review_agent";
  createdAt: string; updatedAt: string;
};

export type SkillVersion = {
  id: string; skillId: string; version: number;
  bodyMd: string;
  triggerConditions: string[];
  pitfalls: string[];
  verificationSteps: string[];
  sourceRunId?: string;
  createdBy: "user" | "system" | "review_agent";
  changelog?: string; createdAt: string;
};
```

### 5.4 RunReview + proposed changes (propose-only)

```ts
export type RunReview = {
  id: string; teamId: string; runId: string; // runId = agent_tasks.id
  status: "pending" | "approved" | "rejected" | "applied";
  summary: string;
  riskLevel: "low" | "medium" | "high";
  proposedMemories: ProposedMemoryChange[];
  proposedSkillChanges: ProposedSkillChange[];
  createdAt: string; updatedAt: string;
};

export type ProposedMemoryChange = {
  action: "create";
  scope: "team" | "project" | "agent" | "workflow"; targetId?: string;
  content: string; reason: string; confidence: number;
};

export type ProposedSkillChange =
  | { action: "create"; skillName: string; description: string;
      scope: "team"|"project"|"agent"|"workflow"; targetId?: string;
      bodyMd: string; triggerConditions: string[]; pitfalls: string[];
      verificationSteps: string[]; reason: string; }
  | { action: "patch"; skillId?: string; skillName: string;
      oldText: string; newText: string; reason: string; };
```

> MVP drops `ProposedWorkflowChange` from the original spec (n8n is parked). The Review Agent must
> not emit workflow proposals.

### 5.5 Runtime contract (multi-runtime ready, claude first)

Mirror what the daemon already speaks (`apps/daemon/internal/protocol`). Do not hardcode the
platform around Claude only.

```ts
export const runtimeKindSchema = z.enum([
  "echo", "claude", "codex", "openai", "anthropic", "custom",
]); // drop "hermes" from MVP; keep enum extensible
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;

export type RuntimeEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; output: unknown }
  | { type: "error"; content: string }
  | { type: "done"; result: unknown };
```
These map 1:1 to existing `task_messages.type`. Reuse, don't duplicate.

---

## 6. Learning loop spec (the moat)

```txt
agent_task reaches status=succeeded|failed
        │
        ▼
Review Agent (a system agent run on the engine, deterministic-friendly)
  reads: task input, task_messages stream, agent version, existing memory/skills
        │  emits ReviewAgentOutput (structured, validated by Zod)
        ▼
run_reviews row created  (status=pending, riskLevel set)
        │
        ▼
Human opens Review Inbox → approves/rejects each ProposedChange
        │  approve
        ▼
Engine APPLIES: insert memory_entries / create Skill + SkillVersion (or patch → new version)
  status → applied                          ◀── only path that mutates production knowledge
        │
        ▼
Next run: engine resolves memoryPolicy + skillPolicy for the agent version,
  fetches matching memory/skills, injects into the daemon task context (RuntimeContext)
```

```ts
export type MemoryPolicy = {
  inject: boolean;
  scopes: Array<"team" | "project" | "agent">;
  maxEntries: number;        // hard cap to bound context
  minConfidence: number;     // 0..1 filter
};
export type SkillPolicy = {
  inject: boolean;
  scopes: Array<"team" | "project" | "agent">;
  maxSkills: number;
};

export type ReviewAgentOutput = {
  summary: string;
  riskLevel: "low" | "medium" | "high";
  shouldCreateMemory: boolean;
  memories: ProposedMemoryChange[];
  shouldCreateSkill: boolean;
  skillChanges: ProposedSkillChange[];
};
```

**Rules:**
- The Review Agent **never** mutates memory/skills directly. It only writes `run_reviews`.
- Application happens **only** on human approval (no policy auto-apply in MVP).
- Injection is **bounded** (`maxEntries`/`maxSkills`/`minConfidence`) — no unbounded context growth.
- For the MVP, a **deterministic/rule-based reviewer is acceptable** to prove the plumbing (e.g.
  "task failed → propose a memory entry summarizing the failure"). A real LLM reviewer is a swap
  behind the same `ReviewAgentOutput` contract — design for the swap, ship the deterministic one
  first so tests stay offline and deterministic.

---

## 7. Engine API surface (MVP)

Additive to the existing Hono router (`apps/engine/src/server.ts`). Keep `teamId` middleware.

```txt
# Agent versions (formalize existing publish)
POST   /api/v1/agents/:id/versions          → create immutable version (replaces inline config publish)
GET    /api/v1/agents/:id/versions          → list versions

# Run reviews (runId = agent_tasks.id)
POST   /api/v1/runs/:id/review              → generate review (deterministic reviewer) → run_reviews(pending)
GET    /api/v1/runs/:id/review              → fetch review
POST   /api/v1/run-reviews/:id/approve      → body: { changeIds?: string[] } → apply selected → status applied
POST   /api/v1/run-reviews/:id/reject       → status rejected

# Memory & skills (read for UI + injection; writes only via approval)
GET    /api/v1/memory?scope=&targetId=
GET    /api/v1/skills?scope=&targetId=
GET    /api/v1/skills/:id/versions
```

All request/response bodies validated by the Zod schemas from §5. Never trust client input.

---

## 8. Phased delivery to ship the MVP

Each phase ends with **green verify** (§11). Work additive, small coherent commits. Phase 0 and
the moat phases (A–F) can proceed in parallel by different hands, but **Phase 0 must land before
Phase C** so the web wiring is built against a real session, not the mock.

### Phase 0 — Identity & Org tenancy backbone (table-stakes, do this early)
- Wire **better-auth** (org plugin) on the engine; map **one org = one `teams` row** (no second
  tenancy concept). Email+password + verify + invitation links. Persist in Postgres via Drizzle.
- Replace client-supplied `teamId` everywhere: every engine route derives `orgId` from the session;
  **enforce RBAC (`config/permissions.ts`) server-side.**
- Issue an **org-scoped daemon token** at org creation; daemon registers with it (replaces mocked
  API key for the daemon connection).
- Web: real sign-up/login screens replace `session.store.ts` mock; team switcher reads real
  memberships. Keep it minimal — polished landing/wizard come in Phase G.
- **Verify:** two distinct orgs cannot see each other's agents/runs (tenancy test); an
  unauthenticated request to an engine route is rejected; RBAC denial returns 403 server-side.

### Phase A — Domain foundation (schemas + tables + tests)
- Add Zod schemas (§5) to `packages/workflow-schema/src/`, re-export from `index.ts`.
- Add Drizzle tables: `agent_versions`, `memory_entries`, `skills`, `skill_versions`,
  `run_reviews`. Generate migration (`drizzle-kit generate`). Do **not** drop n8n tables.
- Repos in `apps/engine/src/` for each entity (mirror `agents-repo.ts` style).
- Tests: schema validation, `ReviewAgentOutput` parsing, version monotonicity.
- **Verify:** `bunx tsc --noEmit` (engine + schema), `bun test` green.

### Phase B — Agent versions made real
- Migrate `publishAgent()` → writes `agent_versions`, sets `agents.liveVersionId`.
- Web Agent Builder publish flow points at the real engine (drop MSW for publish).
- **Verify:** publish creates a version row; `next build` green; e2e create→publish manual check.

### Phase C — Web ↔ engine for the core read path
- Point `apps/web` agents + runs lists and Run View at the real engine API (env-flagged: real
  vs MSW). Keep MSW as offline-dev fallback, not the default for these flows.
- Live Run View consumes the **real** `runs/:id/live` SSE (already wire-compatible).
- **Verify:** with engine + daemon + Postgres + Redis up (`docker compose up`), the dashboard
  shows real agents/runs; a `claude` run streams live.

### Phase D — Review loop backend
- Deterministic Review Agent: on task completion, generate a `run_reviews` row.
- Approve/reject endpoints apply memory/skill changes transactionally.
- **Verify:** complete a run → review appears → approve → memory/skill rows created (tested).

### Phase E — Review Inbox UI + injection
- Web **Review Inbox**: list pending reviews, per-change approve/reject, show diff for patches.
  Follow the responsive-ui rule (mobile-first, fluid, dvh, 44px targets, dark mode) and reuse the
  existing shadcn/Radix primitives + tokens — **no new design system**.
- Engine resolves `memoryPolicy`/`skillPolicy` and injects bounded memory/skills into the daemon
  `RuntimeContext`; daemon passes them to the runtime prompt.
- **Verify (Golden Path §2):** run agent → review → approve a memory → next run's context
  contains it. This closing-the-loop test is the MVP acceptance gate.

### Phase F — Hardening
- Error states, empty states, RBAC gating on review approval (`run:approve` or a new
  `review:approve`), audit-log entries for applied changes, a11y pass on the inbox.
- **Verify:** full `tsc + eslint + test + build` green; Golden Path manual run documented.

### Phase G — Lean landing + first-run onboarding wizard (front door)
- **One** lean landing page (hero, value prop, single CTA → sign-up). Mobile-first per the
  responsive-ui rule; reuse existing tokens/primitives. No CMS, no blog, no pricing matrix.
- **First-run wizard** after org creation: (1) create first agent → (2) connect a daemon with the
  org token (show the copy-paste command) → (3) launch a first run, landing in the live Run View.
- Empty-state nudges in the dashboard when an org has no agent/daemon/run yet.
- **Verify:** a brand-new visitor can go landing → sign-up → create org → first agent → first live
  run with zero mocked data; the wizard is responsive and a11y-clean.

---

## 9. Engineering constraints (strict)

- **Bun / bunx only.** Never npm/npx/pnpm/yarn.
- **TypeScript strict.** No `any` unless truly unavoidable (justify in a comment).
- **Zod** for all shared runtime contracts and API I/O validation.
- **Native `fetch` only** — never axios.
- **No `console.log` in production code.** Use the existing logging approach; never log secrets.
- **Search with `ig`** (trigram), never `grep`/`rg`/Grep tool. Explore with the `explorer` agent.
- **n8n is parked:** do not import from `packages/workflow-engine`, do not extend `workflows` /
  `workflow_versions`, do not build the Workflow Canvas. If you touch a file that imports the graph
  engine, leave it; do not refactor it.
- **Auth = one self-hostable lib (better-auth recommended), one flow** (email+password+verify +
  invites). No SSO/SAML, no billing/seats, no email-domain auto-join. `orgId` is server-derived
  from the session — **never** trusted from the client; RBAC enforced on the engine.
- **Landing stays lean** — one page, reuse existing tokens/primitives, no marketing-site/CMS.
- **Additive & surgical:** every changed line traces to this guideline. Don't "improve" adjacent
  code, don't refactor what isn't broken, match existing style. Mention pre-existing dead code,
  don't delete it.
- **Preserve existing functionality.** Keep the repo building at every phase boundary.
- **Dates:** ISO 8601 in data/schema/API; human-facing display in `dd-mm-yyyy`.
- **Secrets:** never hardcode, never commit `.env`, never print credentials.
- **No images committed.** A stray `agentik-dashboard-thread-markdown.png` exists at repo root and
  `.playwright-mcp/` debris may linger — flag/clean session debris, never add new screenshots.

---

## 10. Frontend rules (Review Inbox & any UI)

Apply the global **responsive-ui** rule: mobile-first, fluid layout, container queries, `clamp()`
typography, breakpoints 320/375/768/1024/1280/1536/1920, touch targets ≥44px, visible focus,
keyboard accessible, dark mode, `prefers-reduced-motion`, `min-h-dvh` (never `100vh`), iOS
safe-area, no horizontal scroll, no fixed widths, no hover-only UX. Reuse the existing
shadcn/Radix primitives in `apps/web/components/ui/` and the OKLCH token set in `app/globals.css`.
**Do not introduce a new design system or component library.**

---

## 11. Verify & DevOps

> **Critical environment note (from prior sessions):** run all verify commands with the **Bash
> sandbox DISABLED**. With the sandbox on, `tsc`/`eslint`/`vitest`/`bun run build` time out, emit
> garbage bytes, or return stale reads (once falsely reported "0 errors" on broken code). Sandbox
> off → truthful results. Prefer one command per call; backgrounding a server inside `bash -c`
> returns exit 144 and silently cancels sibling tool calls.

Use the repo's **real** commands (inspect `package.json` per workspace — don't invent):

```bash
bun install                       # uses bun.lock, installs --ignore-scripts
# web (apps/web):
bunx tsc --noEmit && bunx eslint . && bunx vitest run && bun run build
# engine (apps/engine):
bun run typecheck && bun test
# engine DB after schema changes:
bun run db:generate               # drizzle-kit; review the migration before db:migrate
# full stack:
docker compose up                 # engine + daemon + Postgres + Redis (+ Mailpit if used)
```

- Keep deployment **Docker Compose / Swarm**-compatible. **No Kubernetes.**
- Reuse the shared dev infra where relevant (`infra-postgres`, `infra-redis`, `infra-mailpit` on
  `dev-shared-net`) instead of redeploying duplicates — run `docker ps` first.
- Update `.env.example` only if you add env vars (e.g. a flag toggling MSW vs real engine).
- Tests must be **deterministic** and offline — no live LLM calls, no network. The deterministic
  Review Agent exists precisely so the loop is testable without an LLM.

---

## 12. Acceptance criteria (MVP shipped)

- [ ] Real auth + org lifecycle: sign-up → verify → create org → invite/accept works; `orgId` is
      server-derived; **two orgs are fully isolated** (tenancy test) and RBAC is enforced server-side.
- [ ] A brand-new visitor completes landing → sign-up → org → first agent → first live run with
      **zero mocked data** (first-run wizard).
- [ ] `agent_versions`, `memory_entries`, `skills`, `skill_versions`, `run_reviews` tables exist
      with migrations; n8n tables untouched.
- [ ] Shared Zod schemas (§5) compile and are exported from `packages/workflow-schema`.
- [ ] `publishAgent` writes immutable versions; web publish flow uses the real engine.
- [ ] Web agents/runs/Run View consume the real engine (MSW only as opt-in fallback).
- [ ] A real `claude` run streams live end-to-end.
- [ ] Run completion produces a `run_reviews` (pending); approve applies memory/skill changes;
      reject closes it; nothing is applied without approval.
- [ ] Review Inbox UI works, responsive, a11y-clean, reuses existing primitives.
- [ ] **Golden Path closes the loop:** an approved memory/skill from run N is injected into run N+1
      (proven by an automated test + a documented manual run).
- [ ] No n8n/workflow work shipped. No billing/seats/SSO/SAML/marketplace/vector-DB/k8s; landing
      stayed a single lean page.
- [ ] `tsc + eslint + test + build` green across touched workspaces (or failures documented as
      pre-existing and unrelated).

---

## 13. Execution rules

1. **Audit before editing** — verify file/table/route existence with `ig` and the `explorer`
   agent; never guess paths or APIs.
2. Work **incrementally**, phase by phase (§8); keep the repo green at each boundary.
3. Make reasonable assumptions, **document them**; only ask if the repo is impossible to inspect.
4. **Apply pre-mortem thinking** before each phase: state what could go wrong (context bloat from
   unbounded memory injection, version drift between daemon protocol and engine, MSW/real
   divergence, review spam) and how this design bounds it.
5. **Diagram first** for any multi-component change (Unicode box-drawing, ≤120 chars, labeled
   arrows) before implementing.
6. Do **not** jump to post-MVP work. Do **not** unfreeze the n8n engine. Do **not** add
   speculative abstractions.

**Order of attack:** `auth/org backbone (Phase 0) → schemas → tables → engine repos/routes → web
wiring → review loop → injection → harden → landing+wizard`. Phase 0 and Phase A can start in
parallel, but **Phase 0 lands before Phase C** (web wiring on a real session). Begin with the
domain foundation **and** the tenancy backbone, then stop and verify.
