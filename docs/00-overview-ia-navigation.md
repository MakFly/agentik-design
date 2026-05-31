# 00 · Product Overview · Information Architecture · Navigation

---

## 1. Product overview

### 1.1 What Agentik is

Agentik is the **operations control plane** for an agentic AI platform. The backend runs agents; Agentik is the surface where humans **author, govern, observe, and intervene**. It is not a chat app — chat is one narrow view inside it. The center of gravity is the *execution*: a long-running, branching, tool-using, money-spending process that a human must be able to understand and steer.

### 1.2 Product pillars

```
╔══════════════ AGENTIK CONTROL PLANE ══════════════════════════════════════════════╗
║                                                                                    ║
║   AUTHOR            ORCHESTRATE         OBSERVE              GOVERN                 ║
║   ┌──────────┐      ┌────────────┐      ┌────────────┐      ┌────────────┐         ║
║   │ Agent    │      │ Workflow   │      │ Task / Run │      │ Settings   │         ║
║   │ Builder  │─────▶│ Builder    │─────▶│ Execution  │◀────▶│ RBAC       │         ║
║   │ Tools    │      │ (canvas)   │      │ Observ.    │      │ Billing    │         ║
║   │ Memory   │      │            │      │ Eval       │      │ Audit      │         ║
║   └──────────┘      └────────────┘      └────────────┘      └────────────┘         ║
║        │                  │                   ▲                   │                ║
║        └──────────────────┴───────────────────┴───────────────────┘               ║
║                         shared registry + design tokens                            ║
╚════════════════════════════════════════════════════════════════════════════════════╝
```

- **Author** — define *what* an agent is (role, goal, prompt, model, tools, memory, guardrails).
- **Orchestrate** — compose agents + tools + decisions + human gates into runnable workflows.
- **Observe** — watch executions live; trace every decision, tool call, token, and dollar.
- **Govern** — keys, providers, teams, RBAC, billing, audit, security policy.

### 1.3 Primary personas and their first screen

| Persona | Primary job | Lands on | Cares most about |
|---------|-------------|----------|------------------|
| AI engineer | Build & tune agents | Agent Builder | Prompt/version control, eval scores, token cost |
| Developer | Integrate tools, wire workflows | Workflow Builder | Tool contracts, error handling, retries |
| Automation team | Run & schedule workflows | Dashboard → Runs | Throughput, failures, approvals queue |
| Product operator | Supervise & approve | Task Execution | Live reasoning, approvals, "what failed?" |
| DevOps | Keep it healthy & cheap | Observability | Latency, error rate, cost monitoring, audit |

### 1.4 Design philosophy

- **Dense, not cramped.** This is an enterprise tool for power users. We optimize for information per screen with strong hierarchy, not whitespace for its own sake. Default to compact density; offer a comfortable toggle.
- **Streaming-first.** Most valuable state is *in motion*. Components are built to render partial, appending data without layout thrash.
- **Inspectable everything.** Any agent, run, step, tool call, or cost figure is a clickable entity that opens a detail panel. No dead ends.
- **Reversible & safe.** Destructive and outward-facing actions (delete agent, run in prod, rotate key) always confirm and are always audited.
- **Keyboard-native.** Command palette (`⌘K`), `j/k` list nav, `g`-prefixed go-to, focus-visible everywhere.

---

## 2. Information architecture

### 2.1 Entity model (the nouns)

Everything in the UI maps to these core entities. They recur across modules, so they get **one canonical card/detail representation each** (see doc 02).

```
Organization
 └─ Team(s)                         RBAC boundary, billing unit
     ├─ Agent                       authored unit: role+goal+prompt+model+tools+memory+guardrails
     │   └─ AgentVersion            immutable snapshot of an Agent's config (prompt versioning)
     ├─ Workflow                    DAG of nodes (agent/tool/decision/approval/api)
     │   └─ WorkflowVersion         immutable snapshot of a Workflow graph
     ├─ Tool (Connection)           external integration instance (GitHub acct, Stripe key, REST endpoint)
     ├─ ToolDefinition              the *type* (GitHub, Slack, REST, DB…) + its scopes
     ├─ MemoryStore                 vector store / knowledge base + policy
     │   └─ Document / Chunk        ingested sources + embeddings + citations
     ├─ Run (Execution)             one invocation of an Agent or Workflow
     │   ├─ Step                    a node-level or reasoning-level unit of a Run
     │   ├─ ToolCall                request/response to a Tool within a Step
     │   └─ TraceSpan               OpenTelemetry-style span for Observability
     ├─ EvalSuite                   dataset + scorers
     │   └─ EvalRun                 a benchmark execution + results
     └─ Member / Role / ApiKey / Provider / AuditEvent / Invoice
```

### 2.2 Module → entity mapping

```
┌────────────────────┬──────────────────────────────────────────────────────────────┐
│ Module             │ Primary entities (read/write)                                  │
├────────────────────┼──────────────────────────────────────────────────────────────┤
│ Dashboard          │ Run, Agent, Workflow, cost rollups (read)                      │
│ Agent Builder      │ Agent, AgentVersion, Tool, MemoryStore (write)                 │
│ Workflow Builder   │ Workflow, WorkflowVersion, Agent, Tool (write)                 │
│ Task Execution     │ Run, Step, ToolCall (read + control: pause/resume/cancel)      │
│ Agent Registry     │ Agent, AgentVersion, Run rollups (read + lifecycle)            │
│ Tool Management    │ Tool, ToolDefinition (write + test)                            │
│ Memory & KB        │ MemoryStore, Document, Chunk (write + search)                  │
│ Observability      │ TraceSpan, Run, ToolCall, metrics, AgentVersion (read)         │
│ Evaluation Center  │ EvalSuite, EvalRun, AgentVersion (write + compare)             │
│ Settings           │ Member, Role, ApiKey, Provider, AuditEvent, Invoice (write)    │
└────────────────────┴──────────────────────────────────────────────────────────────┘
```

### 2.3 URL / route map (Next.js App Router)

Routing follows the IA exactly. Team is a path segment so deep links carry their RBAC context.

```
/                                        → redirect to /{team}/dashboard
/login · /accept-invite · /onboarding    → unauthenticated / first-run

/{team}/dashboard

/{team}/agents                           → Agent Registry (list)
/{team}/agents/new                       → Agent Builder (create)
/{team}/agents/[agentId]                 → Agent overview (versions, runs, health)
/{team}/agents/[agentId]/edit            → Agent Builder (edit draft)
/{team}/agents/[agentId]/versions/[v]    → AgentVersion detail (diff vs prev)

/{team}/workflows                        → Workflow list
/{team}/workflows/new                    → Workflow Builder (blank canvas)
/{team}/workflows/[wfId]                 → Workflow overview
/{team}/workflows/[wfId]/edit            → Workflow Builder (canvas)

/{team}/runs                             → Runs list (all executions, filterable)
/{team}/runs/[runId]                     → Task Execution View (live or replay)

/{team}/tools                            → Tool Management (connected integrations)
/{team}/tools/catalog                    → ToolDefinition catalog (connect new)
/{team}/tools/[toolId]                   → Tool detail + scopes + test console

/{team}/memory                           → Memory & KB (stores list)
/{team}/memory/[storeId]                 → Store detail (documents, search, policy)

/{team}/observability                    → Traces / metrics / logs explorer
/{team}/observability/traces/[traceId]   → Trace waterfall detail

/{team}/evals                            → Evaluation Center (suites)
/{team}/evals/[suiteId]                  → Suite detail (datasets, scorers)
/{team}/evals/[suiteId]/runs/[evalRunId] → Eval run results + A/B compare

/{team}/settings                         → Settings (nested tabs below)
/{team}/settings/{keys|providers|team|roles|billing|security|audit}
```

### 2.4 Cross-cutting surfaces (not routes — overlays)

These appear *over* any page and keep the user in flow:

- **Command palette** (`⌘K`) — fuzzy nav + actions ("Run workflow X", "Open agent Y", "Go to billing").
- **Entity drawer** — right-side `Sheet` that opens an Agent/Run/Tool/Step detail without leaving the current page.
- **Approvals tray** — global indicator + popover listing pending human-approval gates across all runs.
- **Notifications/activity** — run completed, run failed, budget threshold crossed, approval requested.
- **Global run status bar** — collapsed strip showing count of active runs; click to expand a live mini-list.

---

## 3. Main navigation structure

### 3.1 Shell layout (responsive)

```
DESKTOP (≥1024px)                                   MOBILE (<768px)
┌──────────────────────────────────────────────┐   ┌──────────────────────────┐
│ TOPBAR: team switch · ⌘K search · env · ◔ runs │   │ ☰  Agentik   ⌘K  ◔  ◐  ⦿ │ fixed, --navbar-h
│        · approvals · theme · user              │   ├──────────────────────────┤
├───────────┬──────────────────────────────────┤   │                          │
│ SIDEBAR   │  PAGE CONTENT                      │   │   PAGE CONTENT           │
│ (rail or  │  ┌─ page header (title, actions) ─┐│   │   (single column)        │
│  expanded)│  │  ┌─ toolbar (filters, view) ─┐ ││   │                          │
│           │  │  │   content region          │ ││   │                          │
│ Dashboard │  │  └───────────────────────────┘ ││   │                          │
│ Agents    │  └────────────────────────────────┘│   ├──────────────────────────┤
│ Workflows │                                     │   │ BOTTOM TAB BAR (5 items) │ safe-area
│ Runs      │                                     │   │ Dash Agents Run Tools ⋯  │
│ Tools     │                                     │   └──────────────────────────┘
│ Memory    │                                     │
│ Observe   │   right EntityDrawer slides in ───▶│
│ Evals     │                                     │
│ ─────     │                                     │
│ Settings  │                                     │
└───────────┴──────────────────────────────────┘
```

### 3.2 Primary navigation (sidebar)

Grouped by the four pillars, ordered by daily-use frequency:

```
OBSERVE (default landing)
  ◉ Dashboard            g d
  ▸ Runs                 g r        ← live count badge
  ▸ Observability        g o

AUTHOR
  ▸ Agents               g a
  ▸ Workflows            g w
  ▸ Tools                g t
  ▸ Memory               g m

QUALITY
  ▸ Evals                g e

─────────────────
  ⚙ Settings             g s
  ? Help / Docs
```

- **Collapsible to an icon rail** (64px) for dense work; state persisted per user.
- Active item: left accent bar + filled icon + `bg-accent`. Badge counts (active runs, pending approvals) update live via the realtime channel.
- Sidebar is `<nav aria-label="Primary">`; items are real `<a>` (Next `<Link>`) for middle-click / open-in-new-tab.

### 3.3 Topbar

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [Team ▾]   [🔍 Search or run a command  ⌘K        ]   [env: prod ▾] [◔ 3 runs] [✓ 2]   │
│                                                          [☼/☾] [user ▾]                 │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Team switcher** — `Combobox`; switching rewrites the `/{team}` segment and refetches scoped data.
- **Command palette trigger** — also `⌘K` anywhere.
- **Env selector** — `dev / staging / prod`; gates which connections + providers are live. Prod is visually flagged (amber dot) so users always know the blast radius.
- **Active runs** (`◔ N`) — opens the live run mini-list popover.
- **Approvals** (`✓ N`) — opens the approvals tray; pulses when a new approval arrives.
- **Theme toggle** and **user menu** (profile, keyboard shortcuts, sign out).

### 3.4 Responsive behavior

| Breakpoint | Shell behavior |
|------------|----------------|
| **≥1280** | Sidebar expanded by default; EntityDrawer opens as a side panel (content shrinks). |
| **1024–1279** | Sidebar collapses to icon rail; EntityDrawer overlays content. |
| **768–1023** | Sidebar becomes a slide-over (`Sheet`) from `☰`; toolbars wrap. |
| **<768** | Bottom tab bar replaces sidebar (5 slots: Dashboard, Runs, Agents, Tools, More). Page headers collapse on scroll-down (`translate-y`), compact bar pins to `top-0`. Workflow Builder canvas switches to **read-only pan/zoom** with an "edit on desktop" notice (node editing is not a mobile task). |

All sticky offsets use `top-[var(--navbar-h)]`; bottom CTAs use `pb-[max(1rem,env(safe-area-inset-bottom))]`; viewport heights use `min-h-dvh` (never `vh`). Touch targets ≥44px. No hover-only affordances — every hover reveal has a tap/focus equivalent.

### 3.5 Navigation state ownership

- **Route** owns: which module/entity is in focus (source of truth, deep-linkable).
- **URL search params** own: list filters, sort, selected tab, drawer-open entity id (so a filtered/inspecting view is shareable).
- **Zustand (UI store)** owns: sidebar collapsed, density, theme, command-palette open, transient toasts.
- **TanStack Query** owns: all server entities (see doc 03 §state).

> Rule: anything a user would want to **share via link** lives in the URL; anything purely **personal/ephemeral** lives in Zustand.
