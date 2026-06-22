# 01 · Page-by-page UI design

Each module below specifies: **purpose → layout (ASCII wireframe) → key components → interactions → states**. Wireframes are desktop unless noted; responsive collapse rules are in doc 00 §3.4. Component names map to doc 02.

Conventions in wireframes: `[Button]` `(toggle)` `▾ dropdown` `◉ status dot` `▸ row` `█ filled bar` `░ track`.

---

## 4.1 Dashboard — `/{team}/dashboard`

**Purpose:** answer "is the system healthy, busy, and within budget — and does anything need me?" in under 3 seconds.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Dashboard                                  [Last 24h ▾] [env: prod ▾]   [↻ live]  [Export]  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ System status ─────────────────────────────────────────────────────────────────────┐  │
│ │ ◉ Operational   ·  3 active runs  ·  12 agents online  ·  p95 latency 4.2s  ·  0 incidents │
│ └──────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                            │
│ ┌─ Active agents ─┐ ┌─ Running tasks ─┐ ┌─ Failed (24h) ──┐ ┌─ Spend (24h) ──────────────┐ │
│ │     12          │ │      3          │ │     7  ▲2       │ │  $48.20  /  $200 budget     │ │
│ │ ▁▂▅▇▆▅▃ trend   │ │ ▂▃▅▇ trend      │ │ ▅▃▂▁ trend  red │ │  ████████░░░░░░░  24%        │ │
│ │ 9 idle · 3 busy │ │ 2 wf · 1 agent  │ │ →View failures  │ │  1.2M tok in · 340k out     │ │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────────────────┘ │
│                                                                                            │
│ ┌─ Live runs ───────────────────────────────────┐ ┌─ Approvals waiting (2) ─────────────┐ │
│ │ ◉ run_8f2  Triage workflow   step 4/7  $0.12   │ │ ▸ Refund > $500  · run_7a1 · 3m ago  │ │
│ │   ▶ "Searching knowledge base…"  ████░░ 57%    │ │   [Review]                           │ │
│ │ ◉ run_7a1  Support agent      ⏸ paused @approve │ │ ▸ Send email to customer · run_9c4   │ │
│ │ ◉ run_9c4  Data sync          step 2/3  $0.04   │ │   [Review]                           │ │
│ │   → Open Task Execution                         │ └─────────────────────────────────────┘ │
│ └─────────────────────────────────────────────────┘ ┌─ Performance ───────────────────────┐ │
│ ┌─ Recent activity ──────────────────────────────┐ │  Success rate   97.1%  ▲0.4          │ │
│ │ ✓ run_8e0 Invoice agent      done   12s  $0.03 │ │  Avg latency    3.8s   ▼0.2          │ │
│ │ ✗ run_8d9 Scraper            failed  4s   rate │ │  Tool error %   1.2%                 │ │
│ │ ✓ run_8d2 Triage workflow    done   1m9  $0.21 │ │  ┌ latency p50/p95/p99 sparkline ──┐ │ │
│ │ → View all runs                                 │ │  └──────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────┘ └─────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Key components:** `StatCard` (value + sparkline + delta + drill-link), `SystemStatusBar`, `LiveRunList` (subscribes to realtime), `ApprovalsPanel`, `ActivityFeed`, `MetricChart` (Recharts/visx line+area).

**Interactions:**
- Every card is a **drill target** (click "Failed" → Runs list pre-filtered `status=failed`).
- Time-range (`24h / 7d / 30d / custom`) and `env` filters drive the whole page; persisted in URL.
- `[↻ live]` toggles realtime updates (default on for ≤24h ranges; off for historical).
- Live runs and approvals update **without refetch** via SSE; the rest poll on `staleTime` and refetch on window focus.

**States:**
- *Loading:* skeleton cards keep the grid shape (no layout shift).
- *Empty (new team):* hero empty state → "Create your first agent" / "Import a template" with a 3-step checklist.
- *Degraded:* status bar turns amber/red with the incident reason + link to Observability.

---

## 4.2 Agent Builder — `/{team}/agents/new` · `/{team}/agents/[id]/edit`

**Purpose:** author a complete, valid, *safe* agent. Two-pane: form on the left, **live preview + test harness** on the right so you never edit blind.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Agents   New agent · draft                          ◐ unsaved   [Test ▷]  [Save draft] [Publish ▾] │
├──────────────────────────────────────────┬─────────────────────────────────────────────────┤
│ STEP NAV (sticky)        │ FORM           │ PREVIEW & TEST                                   │
│ ① Identity   ✓           │ Name  [Support Triage Agent        ]                              │
│ ② Model      ✓           │ Role  [Tier-1 support triage       ]    ┌─ Resolved config ─────┐ │
│ ③ Prompt     ●           │ Goal  [Classify & route tickets,   ]    │ model claude-opus-4    │ │
│ ④ Tools                  │       [escalate billing issues     ]    │ tools 3 · memory: KB-1 │ │
│ ⑤ Memory                 │                                          │ guardrails: 4 active   │ │
│ ⑥ Limits & retries       │ ─ System prompt ─────────────  [⤢ expand]│ est. cost ~$0.04/run   │ │
│ ⑦ Guardrails             │ ┌──────────────────────────────────────┐│ └────────────────────────┘ │
│ ⑧ Review                 │ │ You are a support triage agent…      ││                            │ │
│                          │ │ {{memory.recent_tickets}}            ││ ┌─ Test run ────────────┐ │ │
│ ─ versions ─             │ │ ▮ variables: 2 · tokens ~480         ││ │ Input:                │ │ │
│ v3 (live)                │ └──────────────────────────────────────┘│ │ [My card was charged…]│ │ │
│ v2  v1   [diff]          │  Prompt version: editing draft (from v3) ││ │            [Run ▷]    │ │ │
│                          │                                          ││ │ ─ trace ────────────  │ │ │
│                          │ ─ Tools (3) ──────────────  [+ Add tool] ││ │ ◉ reasoning…          │ │ │
│                          │ ▸ ◉ GitHub (read)      scopes ▾  [⋯]     ││ │ ▸ tool: search_kb     │ │ │
│                          │ ▸ ◉ Slack (post)       scopes ▾  [⋯]     ││ │ ▸ output: "Route→Bill"│ │ │
│                          │ ▸ ◉ search_kb (KB-1)   scopes ▾  [⋯]     ││ │ $0.038 · 2.1s · 1.2k t│ │ │
│                          │                                          ││ └───────────────────────┘ │ │
└──────────────────────────┴─────────────────────────────────────────┴─────────────────────────────┘
```

**Section detail (the form):**

| Section | Fields & controls |
|---------|-------------------|
| ① Identity | name, role, goal, description, owner, tags, avatar/color |
| ② Model | provider+model `Combobox` (grouped by provider), temperature, max tokens, top-p, stop sequences, `reasoning_effort` if supported. Shows per-model price/1k tokens inline. |
| ③ Prompt | system prompt editor (Monaco or CodeMirror) with `{{variable}}` highlighting, token counter, variable inspector, prompt-version selector + diff |
| ④ Tools | list of granted tools, each with **scope chips** (read/write/admin) and per-tool rate caps; add from connected Tools; warning icon if a tool grants write to prod |
| ⑤ Memory | attach `MemoryStore`(s), set read/write mode, top-k retrieval, recency window, citation on/off |
| ⑥ Limits & retries | requests/min, concurrent runs, max tokens/run, **max cost/run** (hard stop), timeout, retry policy (max attempts, backoff strategy, retry-on conditions) |
| ⑦ Guardrails | allowed/blocked tool actions, PII redaction toggle, output schema/JSON-mode, content filters, require-approval-for (list of sensitive actions), network egress allowlist |
| ⑧ Review | resolved-config diff vs live version + validation summary before publish |

**Interactions:**
- **Autosave draft** (debounced) → optimistic; "unsaved" → "saved" indicator.
- **Test harness** runs the *draft* against a sandbox; streams a real trace (reuses Task Execution components) so you see reasoning/tool calls/cost before publishing.
- **Publish** creates a new immutable `AgentVersion`; modal shows the diff and asks for a changelog note. Optionally "publish + run eval suite".
- **Validation** is inline per field and aggregated in ⑧; Publish is disabled until valid (e.g., a tool with write scope but no approval gate triggers a warning, not a block).

**States:**
- *Loading edit:* form skeleton with section nav intact.
- *Validation error:* field-level `aria-describedby` error + section-nav badge.
- *Test failure:* the test panel shows the same first-class error UI as Task Execution (failing step + retry).
- *Empty (no tools/memory connected):* inline prompts linking to Tool Management / Memory.

---

## 4.3 Workflow Builder — `/{team}/workflows/[id]/edit`

**Purpose:** visually compose a runnable DAG of agents, tools, decisions, human gates, and API calls. Built on **React Flow (@xyflow/react)**.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Workflows  Support Triage Flow · draft        [Validate] [Test ▷] [Save] [Publish ▾]  ◐   │
├──────────┬───────────────────────────────────────────────────────────┬─────────────────────┤
│ PALETTE  │ CANVAS  (pan/zoom · grid snap · minimap)                   │ INSPECTOR (selected) │
│          │                                                            │  Node: Triage Agent  │
│ Triggers │   ┌─────────┐                                              │  ─ Config ─────────  │
│ ▸ Manual │   │ ⚡ Start │                                              │  Agent  [Triage ▾]   │
│ ▸ Webhook│   └────┬────┘                                              │  Input  map ▾        │
│ ▸ Sched. │        │ event                                            │   ticket ← trigger   │
│          │        ▼                                                   │  On error: retry 2   │
│ Nodes    │   ┌──────────────┐  classify                              │  Timeout 60s         │
│ ▸ Agent  │   │ 🤖 Triage     │──────┐                                 │  ─ Output ─────────  │
│ ▸ Tool   │   │   Agent       │      │                                 │  category, priority  │
│ ▸ API    │   └──────────────┘      ▼                                 │                      │
│ ▸ Decision│                  ┌─────────────┐  billing                │  [Open agent ↗]      │
│ ▸ Approval│                  │ ◆ Decision  │───────┐                  │                      │
│ ▸ Code   │                  │ category==? │       │ other            │  ─ Validation ─────  │
│ ▸ Loop   │                  └──────┬──────┘       ▼                  │  ✓ inputs mapped     │
│          │              refund>500 │        ┌──────────┐             │  ! no error handler  │
│ Sub-flow │                         ▼        │ 🤖 Resolve│             │    on "Resolve"      │
│ ▸ …      │                  ┌────────────┐  └────┬─────┘             │                      │
│          │                  │ ✋ Approval │       ▼                   │                      │
│          │                  │ Refund gate│  ┌──────────┐             │                      │
│          │                  └─────┬──────┘  │ 🔧 Slack │ post         │                      │
│          │            approve     │ reject  │  notify  │             │                      │
│          │                  ┌─────▼─────┐   └────┬─────┘             │                      │
│          │                  │ 🔌 Stripe │        ▼                   │                      │
│          │                  │  refund   │   ┌──────┐                 │                      │
│          │                  └───────────┘   │ ✔ End│                 │                      │
│          │                                  └──────┘                 │                      │
│  [minimap ▭]                                                         │                      │
└──────────┴───────────────────────────────────────────────────────────┴─────────────────────┘
```

**Node types (palette):**

| Node | Icon | Purpose | Key config |
|------|------|---------|------------|
| Trigger | ⚡ | start (manual / webhook / schedule / event) | schema, auth, cron |
| Agent | 🤖 | invoke an Agent | agent+version, input map, error policy |
| Tool | 🔧 | call a connected tool action | tool, action, args map, scope |
| API call | 🔌 | raw REST/GraphQL call | method, url, headers, body, auth, timeout |
| Decision | ◆ | conditional branch | expression(s) → labeled outputs |
| Approval | ✋ | human-in-the-loop gate | approver role, message, timeout, on-timeout |
| Code | `{}` | small JS transform (sandboxed) | input→output mapping |
| Loop / Map | ↻ | iterate over a collection | collection ref, concurrency, max iters |
| Sub-flow | ▣ | embed another Workflow | workflow+version, input map |
| End | ✔ | terminal | output schema |

**Interactions:**
- **Drag** from palette to canvas; **connect** by dragging from a node's output handle to another's input. Handles are typed; incompatible connections are rejected with a tooltip.
- **Inspector** (right) edits the selected node/edge; multi-select for bulk align/delete.
- **Validation** (continuous): unmapped inputs, unreachable nodes, cycles without a loop node, missing error handlers, write-tool without an approval upstream → surfaced as node badges + a problems list.
- **Test ▷** runs the workflow in sandbox; the canvas becomes an **execution overlay** — nodes light up as they run (running=pulsing blue, done=green, failed=red, skipped=dim), edges animate the active path. Click a running node to open its live trace in the inspector.
- **Versioning & publish** identical pattern to agents (immutable `WorkflowVersion` + changelog).
- Autosave draft; keyboard: `Space`-drag pan, `⌘+scroll` zoom, `⌫` delete selection, `⌘D` duplicate, `⌘Z/⇧⌘Z` undo/redo (graph history in Zustand).

**States:**
- *Empty canvas:* ghost "Start" node + hint "Drag a trigger to begin, or start from a template ▾".
- *Invalid graph:* Publish disabled; problems panel lists each issue with a "focus node" link.
- *Test running:* canvas overlay + bottom-docked live log; *test failed:* failing node outlined red, inspector shows error + "retry from here".
- **Mobile:** read-only pan/zoom + node inspect; editing actions hidden with an "edit on a larger screen" banner.

---

## 4.4 Task Execution View — `/{team}/runs/[runId]`

**Purpose:** the flagship screen. Watch an agent/workflow *think* in real time (or replay a past run), understand every decision, and intervene. This is where the five UX guarantees live or die.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Runs  run_8f2 · Support Triage Flow · v4      ◉ RUNNING  step 4/7   ⏱ 00:38  $0.12        │
│                                                  [⏸ Pause] [■ Cancel] [↻ Retry step] [⋯]    │
├───────────────────────────────┬──────────────────────────────────┬─────────────────────────┤
│ TIMELINE (left, scrolls)      │ FOCUS PANEL (selected step)       │ SUMMARY (right, sticky) │
│                               │                                   │  ┌─ Cost & tokens ────┐ │
│ ◉ 00:00 Trigger  webhook      │  Step 4 · 🤖 Triage Agent         │  │ $0.12  ████░░ 60%   │ │
│ │       payload ▸             │  Status: ◉ running                │  │ of $0.20 cap        │ │
│ ✓ 00:02 🤖 Triage Agent       │  ─ Reasoning ──────────────────   │  │ in 8.2k · out 1.1k  │ │
│ │   "Classified as billing"   │  ▌The ticket mentions a duplicate │  │ model claude-opus-4 │ │
│ │   $0.03 · 2.1s              │  ▌charge. I should look up the    │  └─────────────────────┘ │
│ ◆ 00:04 Decision  →billing    │  ▌customer's recent transactions  │  ┌─ Run meta ─────────┐ │
│ ✓ 00:05 🤖 Resolve Agent      │  ▌before deciding on a refund…    │  │ trigger webhook     │ │
│ │   ▸ 2 tool calls            │  ▌ ▮ streaming…                   │  │ env prod            │ │
│ ●►00:38 🔧 search_kb (running) │  ─ Tool calls (2) ─────────────   │  │ workflow v4         │ │
│ │   ▶ "duplicate charge…"     │  ▸ ◉ search_kb  running  1.8s     │  │ started 14:22:01    │ │
│ ○ ──── ✋ Approval (pending)   │  │   req {query:"duplicate…"}     │  │ by  alice@team      │ │
│ ○ ──── 🔌 Stripe refund        │  │   resp ▮ streaming…            │  │ trace_id 9b…  [↗]   │ │
│ ○ ──── ✔ End                  │  ▸ ✓ get_customer  done  0.4s    │  └─────────────────────┘ │
│                               │  │   req {id:"cus_…"} resp {…} ▸  │  ┌─ Errors (0) ───────┐ │
│ [filter: all ▾] [⤓ logs]      │  ─ Raw logs ───────────  [follow]│  │ none                │ │
│                               │  14:22:39 DEBUG retrieved 5 docs  │  └─────────────────────┘ │
│                               │  14:22:39 INFO  scoring…          │  [Open trace] [Replay]  │
└───────────────────────────────┴──────────────────────────────────┴─────────────────────────┘
```

**Three regions:**
1. **Timeline (left)** — vertical, ordered list of steps. Each row: status dot, time offset, actor (agent/tool/decision/approval icon), one-line summary, cost/latency. The *running* step auto-scrolls into view (with a "jump to live" pill if the user scrolled away). Future/pending steps shown ghosted (`○`).
2. **Focus panel (center)** — detail of the selected step: **Reasoning** (streamed, with a clear "this is the model's summary" affordance), **Tool calls** (each expandable to request/response JSON with copy + latency + cost), **API requests/responses**, **raw logs** (virtualized, follow-tail toggle), and per-step error/retry history.
3. **Summary (right, sticky)** — cost & token meter vs cap, run metadata, errors rollup, links to full trace (Observability) and replay.

**Controls & interventions:**
- **Pause / Resume / Cancel** — optimistic with confirm on Cancel; state reflects backend ack via realtime (`run.control.ack`).
- **Approval gate** — when a step is `✋ pending`, an inline **Approve / Reject** card appears in the focus panel (and in the global approvals tray) with the context the approver needs (e.g., refund amount, customer) and a reason field. RBAC-gated.
- **Retry step / Retry from here** — re-run a failed (or any) step; spawns a child attempt shown nested under the step.
- **Edit & re-run** — open the run's agent/workflow version in the builder pre-loaded, or "fork run with changes".

**Realtime model:** subscribes to `run:{id}` channel; applies events (`step.started`, `token.delta`, `tool_call.*`, `step.completed`, `run.cost.updated`, `run.status.changed`) by appending/patching in place — no full refetch. On reconnect, replays missed events from `lastEventId`. See doc 04 §10.

**States:**
- *Connecting:* "Connecting to live stream…" with the last known snapshot from REST (so the page is never blank).
- *Replay (completed run):* same UI, controls become "Replay ▷" with a scrubber; no live socket.
- *Failed run:* failing step is red and auto-selected; focus panel leads with the error (class, message, stack/tool error), then the retry affordance and "what ran before this".
- *Cancelled / timed out:* terminal banner with reason; partial cost still shown.

---

## 4.5 Agent Registry — `/{team}/agents`

**Purpose:** the fleet view — find, compare, and manage all agents with their operational health.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Agents (24)            [🔍 filter]  Status▾ Model▾ Capability▾ Owner▾ Tag▾   [⊞|≣] [+ New]  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ◉ Name              Status   Model          Last run   Success  Latency  $/task   Owner     │
│ ─────────────────────────────────────────────────────────────────────────────────────────  │
│ ▸ ◉ Triage Agent    healthy  opus-4         2m ago     98.2% ██  3.1s     $0.04   alice  [⋯]│
│ ▸ ◉ Resolve Agent   healthy  opus-4         2m ago     96.0% ██  5.4s     $0.11   alice  [⋯]│
│ ▸ ◑ Scraper         degraded sonnet-4       4m ago     71.3% █░  2.2s     $0.02   bob    [⋯]│
│ ▸ ○ Invoice Agent   idle     haiku-4.5      1h ago     99.1% ██  1.2s     $0.01   carol  [⋯]│
│ ▸ ✗ Old Classifier  error    gpt-4o (ext)   3h ago     —          —       —       bob    [⋯]│
│   └ last error: provider 429 rate limit · 3 consecutive failures   [View runs] [Disable]    │
│                                                              [‹ 1 2 3 ›]  rows: 25 ▾         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Key components:** `DataTable` (TanStack Table — sortable, column-resizable, density-aware, virtualized for large fleets), `HealthBadge`, `SuccessBar`, faceted `FilterBar`, row `⋯` actions menu, expandable row for last-error/quick-stats.

**Interactions:**
- **Faceted filters** (status, model, capability/tool, owner, tag) + free-text; encoded in URL; saved-view chips.
- **Row click** → agent overview page; **`⋯`** → run now, edit, duplicate, view runs, pause/disable, delete (confirm).
- **Bulk select** → disable / re-tag / move team.
- **Grid view (⊞)** → card layout for visual scanning; **list view (≣)** → dense table (default for ops).
- Health (`healthy/degraded/error/idle`) is computed from recent run success + latency + provider status; degraded/error rows expand to show the reason inline.

**States:** loading→skeleton rows; empty→"Create your first agent" CTA + templates; filtered-empty→"No agents match" + clear-filters; error-loading→retry banner.

---

## 4.6 Tool Management — `/{team}/tools` · `/tools/catalog`

**Purpose:** connect, scope, and verify external integrations; make capability + blast-radius obvious.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Tools                                            [env: prod ▾]   [🔍]  [+ Connect tool]      │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Connected (7)                                                                               │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                        │
│ │  GitHub      │ │  Slack       │ │  Stripe      │ │  Postgres    │                         │
│ │  ◉ connected │ │  ◉ connected │ │  ◑ test fail │ │  ◉ connected │                        │
│ │  org/acme    │ │  #support    │ │  acct_live   │ │  prod-ro     │                         │
│ │  scopes: 4   │ │  scopes: 2   │ │  scopes: 3 ! │ │  scopes: 1   │                        │
│ │  [Test] [⋯]  │ │  [Test] [⋯]  │ │  [Test] [⋯]  │ │  [Test] [⋯]  │                        │
│ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘                        │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                                         │
│ │ REST: CRM API│ │ Webhook: Pager│ │ Gmail        │                                         │
│ │  ◉ connected │ │  ◉ active     │ │  ○ disabled  │                                         │
│ └──────────────┘ └──────────────┘ └──────────────┘                                         │
└──────────────────────────────────────────────────────────────────────────────────────────┘

Detail / connect drawer (right Sheet):
┌─ Connect: Stripe ───────────────────────────────┐   ┌─ Test connection ──────────────────┐
│ Name      [Acme live]                            │   │  ▸ Auth          ✓ 120ms           │
│ Auth      ( ) API key  (•) OAuth                 │   │  ▸ Read charges  ✓ 240ms           │
│ Key       [sk_live_••••••••  ] (write-only)      │   │  ▸ Create refund ✗ 401 no scope    │
│ Scopes    (✓) read charges (✓) read customers    │   │  ──────────────────────────────    │
│           (✓) create refunds  ( ) write subs     │   │  1 of 3 checks failed              │
│ Env       prod ▾   Rate cap [60/min]             │   │  → grant "refunds:write" in Stripe │
│ Used by   2 agents · 1 workflow  [view]          │   │      [Re-test]                     │
│           [Cancel]            [Test] [Save]       │   └────────────────────────────────────┘
└──────────────────────────────────────────────────┘
```

**Catalog (`/tools/catalog`):** grid of `ToolDefinition`s grouped by category (Dev: GitHub, GitLab · Comms: Slack, Gmail · Payments: Stripe · Data: Postgres, MySQL, S3 · Generic: REST, GraphQL, Webhook, Internal service). Each has a description, required scopes, and a "Connect" flow tailored to its auth type (API key / OAuth / connection string / signed webhook).

**Interactions:**
- **Test connection** is a first-class, multi-check flow (auth + one probe per granted scope) with per-check latency and a precise remediation hint on failure. Never "it works/it doesn't" — always *which* capability and *why*.
- **Scopes** are explicit, least-privilege, and surfaced everywhere the tool is used (agent builder, workflow inspector). Write/admin scopes get a warning treatment.
- **Secrets** are write-only in the UI (masked, never returned by the API); rotate flow re-prompts.
- **Usage** shows which agents/workflows depend on a tool; disabling warns about dependents.

**States:** connecting→spinner with step labels; test-fail→red check rows + remediation; empty→catalog CTA; secret-expired→amber "re-authenticate" banner.

---

## 4.7 Memory & Knowledge Base — `/{team}/memory` · `/memory/[storeId]`

**Purpose:** manage vector stores and RAG sources; make retrieval and citations transparent; control retention.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Memory store: KB-1 · Support docs              [Policy] [Reindex] [+ Add source]            │
├───────────────────────────────┬────────────────────────────────────────────────────────────┤
│ SOURCES (134 docs · 9,210 chunks) │ SEARCH / INSPECT                                        │
│ ▸ 📄 refund-policy.pdf  ✓ indexed │  [🔍 "what is the refund window?"            ] [Search] │
│   42 chunks · v2 · 3d ago         │  ─ Results (top-k 5) ─────────────────────────────────  │
│ ▸ 🌐 docs.acme.com/*  ◑ crawling  │  1. refund-policy.pdf · p.3 · score 0.91               │
│   312/500 pages                   │     "…refunds are available within 30 days of…"  [open] │
│ ▸ 🗂 zendesk export   ✓ indexed   │  2. faq.md · §billing · score 0.88                      │
│   1,204 chunks                    │     "…you can request a refund from the billing…"      │
│ ▸ 🔌 Notion (live)   ◉ syncing    │  3. terms.pdf · p.12 · score 0.74                       │
│   2-way · last 1h ago             │  ─ embedding: text-embedding-3-large · dim 3072 ─       │
│                                   │  ─ chunking: 800 tok · 100 overlap ─                    │
│ ┌─ Retention policy ───────────┐  │  ┌─ Citation preview ──────────────────────────────┐   │
│ │ TTL  90 days                  │  │  │ When an agent retrieves this, it cites:          │   │
│ │ PII  redact on ingest         │  │  │  [refund-policy.pdf · p.3] ↗                      │   │
│ │ Access read: 3 agents         │  │  └──────────────────────────────────────────────────┘   │
│ │ Embeddings re-gen on policy ✎ │  │                                                        │
│ └───────────────────────────────┘  │                                                        │
└───────────────────────────────────┴────────────────────────────────────────────────────────┘
```

**Key components:** `SourceList` (per-source ingest status + progress), `RetrievalSearch` (query → ranked chunks with scores + source + page/section), `CitationPreview`, `PolicyEditor`, `ReindexProgress`.

**Interactions:**
- **Add source:** upload (PDF/MD/CSV/HTML), crawl URL, connect live source (Notion/Confluence/Drive), or push via API. Shows ingest pipeline: extract → chunk → embed → index, with per-stage progress and failures (e.g., "12 pages failed OCR").
- **Search/inspect:** the same retrieval an agent uses, exposed for debugging ("why did the agent cite X?"). Adjustable top-k, filters by source, shows similarity scores.
- **Policy:** retention/TTL, PII redaction, embedding model + chunking (changing them prompts a reindex with cost estimate), access (which agents can read/write).
- **Citations:** every chunk shows exactly how it will be cited so RAG answers are auditable end-to-end.

**States:** ingesting→progress per source; index-stale→"reindex recommended" banner; empty→"Add your first source"; search-empty→"no matches above threshold (lower top-k threshold?)".

---

## 4.8 Observability — `/{team}/observability`

**Purpose:** the system-of-record for what happened — traces, metrics, logs, decisions, failures, cost, and prompt-version history. Built for debugging at scale.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Observability   [Traces|Metrics|Logs|Costs]   [Last 24h ▾]  [filter: service, agent, status]│
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ TRACES                                                                                      │
│  trace_id     root            status  dur     spans  cost    started                        │
│  ▸ 9b2…  Support Triage Flow   ✓      2m9s    14     $0.21   14:22:01                       │
│  ▸ 9b1…  Resolve Agent         ✗      4.1s    6      $0.02   14:19:44   error: tool 500     │
│  ▸ 9af…  Data sync workflow    ✓      38s     9      $0.04   14:10:12                       │
│                                                                                            │
│ Trace waterfall (selected 9b2…):                                                            │
│  Triage Flow            ├████████████████████████████████████████████┤ 129.0s              │
│   ⮡ Triage Agent        ├███┤ 2.1s                                                          │
│      ⮡ llm.completion   ├██┤ 1.8s   $0.03  in 2.1k/out 0.4k                                 │
│   ⮡ Decision            │  ┤ 12ms                                                           │
│   ⮡ Resolve Agent       │  ├████████┤ 8.4s                                                  │
│      ⮡ tool.search_kb   │  │ ├██┤ 1.8s                                                      │
│      ⮡ tool.get_customer│  │ │ ┤ 0.4s                                                       │
│   ⮡ Approval (wait)     │        ├████████████████████████┤ 115s (human)                   │
│   ⮡ tool.stripe.refund  │                                ├█┤ 0.6s                            │
│  → click any span → detail (input/output/attrs/logs/cost) in drawer                         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Sub-tabs:**
- **Traces** — list + OTel-style waterfall; span detail drawer (attributes, input/output, events, cost). Spans include `llm.completion`, `tool.*`, `decision`, `approval.wait`, `retry`. Filter by status, agent, tool, latency, cost. "Compare with previous run" toggle.
- **Metrics** — time-series dashboards: throughput, success/error rate, latency p50/p95/p99 per agent/tool/model, tool latency leaderboard, queue depth. Brush-to-zoom; click a point → jump to traces in that window.
- **Logs** — virtualized, structured log explorer; filter by level/service/run; live-tail; jump to the trace/span a log belongs to.
- **Costs** — spend breakdown by agent / workflow / model / tool / team / day; budget vs actual; top spenders; cost-per-successful-task; anomaly flags.
- **Failure analysis** (cross-cutting view, surfaced from each tab) — group failures by error class, agent, tool, model; "top failing steps"; recent regressions; link to the runs.
- **Prompt/version history** — timeline of `AgentVersion`/`WorkflowVersion` deploys overlaid on metrics, so a quality/cost change is attributable to a specific version. Diff any two versions.

**States:** loading→shimmer charts + skeleton rows; empty→"no data in range"; sampling-note when volume is high ("showing sampled 10% — refine filters for full fidelity").

---

## 4.9 Evaluation Center — `/{team}/evals`

**Purpose:** prove an agent/prompt/model is *better*, not just different. Datasets, benchmarks, regression gates, scoring, human feedback, and A/B.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Eval suite: Triage Quality              [Run ▷] [+ Dataset] [+ Scorer]   [Compare ⇄]        │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Datasets (3)            │ Scorers (4)                  │ Latest results                      │
│ ▸ golden-100  (100)     │ ▸ exact-match (routing)      │  Version  Score  Pass  Latency $  │
│ ▸ edge-cases  (32)      │ ▸ llm-judge (helpfulness)    │  v4 ▶     0.91   91/100  3.1s $0.04 │
│ ▸ adversarial (45)      │ ▸ regex (no-PII-leak)        │  v3       0.87   87/100  3.4s $0.05 │
│                         │ ▸ human-rating               │  v2       0.79   79/100  3.0s $0.03 │
├─────────────────────────┴──────────────────────────────┴─────────────────────────────────┤
│ A/B compare:  v4  vs  v3                                                                    │
│  metric          v4        v3       Δ                                                        │
│  overall score   0.91      0.87    +0.04 ▲ (significant, n=100, p<0.05)                     │
│  routing acc.    0.95      0.90    +0.05 ▲                                                   │
│  helpfulness     0.88      0.86    +0.02 ▲                                                   │
│  PII leaks       0         2       −2   ▲                                                    │
│  avg cost        $0.04     $0.05   −20% ▲                                                    │
│  regressions     ▸ 3 cases got worse  [view diff]                                           │
│  ┌─ case #57 ─────────────────────────────────────────────────────────────────────────┐   │
│  │ input  "I was double charged"   expected route: billing                              │   │
│  │ v4 → billing ✓ (0.93)     v3 → general ✗ (0.51)        [open both traces]            │   │
│  └─────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Key components:** `DatasetTable`, `ScorerList` (built-in + custom code/LLM-judge scorers), `EvalRunResults`, `ABCompare` (side-by-side with significance), `RegressionList` (cases that got worse), `HumanFeedbackQueue` (rate/label outputs), `CaseDiff` (per-case input/expected/got + traces).

**Interactions:**
- **Run** a suite against one or more agent versions / models in parallel; live progress (n/total, running cost).
- **A/B compare** any two versions (or two models on the same version): metric deltas with significance, win/loss/tie counts, and the **regression list** (most important: what got *worse*).
- **Human feedback** queue: reviewers thumbs-up/down + tag outputs; feeds scorers and future datasets.
- **Gate** a publish on eval pass (CI-style): "block publish if overall < 0.85 or any PII leak".

**States:** running→progress + partial results stream in; no-baseline→"run a baseline first"; empty→dataset/scorer setup wizard.

---

## 4.10 Settings — `/{team}/settings/*`

**Purpose:** governance. Keys, providers, team, RBAC, billing, security, audit. Nested tabbed layout.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Settings   [API keys][Providers][Team][Roles][Billing][Security][Audit log]                │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ROLES (RBAC)                                                                                │
│  Role        Members  agents  workflows  runs   tools  memory  settings  billing           │
│  Owner       1        CRUD    CRUD       CRUD    CRUD   CRUD    CRUD      CRUD               │
│  Admin       2        CRUD    CRUD       CRUD    CRUD   CRUD    R         R                  │
│  Engineer    8        CRUD    CRUD       CRUD    R+test R+W     —         —                  │
│  Operator    4        R       R          run+    R      R       —         —                  │
│              approve  └ can pause/resume/cancel/approve runs                                │
│  Viewer      12       R       R          R       R      R       —         —                  │
│  [+ Custom role]   permissions are resource × action; least-privilege defaults             │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Example — PROVIDERS tab                                                                     │
│  ▸ Anthropic   ◉ active   key ••••  models: opus-4, sonnet-4, haiku-4.5   default ✓         │
│  ▸ OpenAI      ◉ active   key ••••  models: gpt-4o, o-series                                │
│  ▸ Self-hosted ○ off      base_url https://llm.internal  [Test]                             │
│  Fallback order: Anthropic → OpenAI    Cost ceiling/team/day: $200                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Tabs:**
- **API keys** — programmatic access keys (scoped, with last-used + rotate/revoke); never displayed after creation.
- **Providers** — model providers (Anthropic/OpenAI/self-hosted), keys (write-only), enabled models, default + fallback order, per-team cost ceiling.
- **Team** — members, invites, SSO/SCIM, default role on join.
- **Roles** — RBAC matrix (resource × action), custom roles, least-privilege defaults (table above).
- **Billing** — plan, usage vs included, invoices, spend by team/agent, budget alerts.
- **Security** — IP allowlist, egress allowlist, PII policy, data residency, secret rotation cadence, require-approval-for-prod toggles, session policy.
- **Audit log** — append-only, filterable record of every privileged action (who/what/when/where, before→after), exportable, with a "suspicious activity" filter.

**States:** permission-gated tabs hide/disable per role (with "you don't have access" rather than a blank); destructive actions (revoke key, remove member, change role) always confirm and audit; billing-overage→banner.
