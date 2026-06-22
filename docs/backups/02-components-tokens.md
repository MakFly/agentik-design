# 02 · Component Hierarchy · Design System Tokens

---

## 5. Component hierarchy

### 5.1 Layering model

Five tiers, strict dependency direction (a tier may only import from tiers below it):

```
╔═══════════════════════════════════════════════════════════════════════════════════╗
║ Tier 5 · PAGES            route components (app/**/page.tsx) — compose features      ║
║          ▲ depends on                                                                ║
║ Tier 4 · FEATURES         domain modules: agent-builder, workflow-canvas, run-view…  ║
║          ▲                 (own their queries, mutations, local stores)              ║
║ Tier 3 · COMPOSED         cross-domain shared: DataTable, EntityDrawer, MetricChart, ║
║          ▲                 CodeEditor, JsonViewer, FilterBar, StatusBadge            ║
║ Tier 2 · PRIMITIVES       shadcn/ui wrappers: Button, Input, Sheet, Dialog, Tabs…    ║
║          ▲                 (Radix under the hood, themed via tokens)                 ║
║ Tier 1 · TOKENS+UTILS     design tokens (CSS vars), cn(), hooks, formatters          ║
╚═══════════════════════════════════════════════════════════════════════════════════╝
```

> Rule: features never import from other features. Cross-feature reuse is promoted down to Tier 3. This keeps the workflow-canvas from secretly depending on agent-builder internals.

### 5.2 Shared composed components (Tier 3) — the reusable kit

These are the high-leverage components that recur across modules. Each is documented in Storybook with all states.

| Component | Purpose | Props (essence) | Used by |
|-----------|---------|-----------------|---------|
| `AppShell` | topbar + sidebar + content + drawer slot | `nav`, `children` | every page |
| `PageHeader` | title, breadcrumbs, actions, tabs | `title`, `actions`, `tabs` | every page |
| `DataTable<T>` | sortable/filterable/virtualized table | `columns`, `data`, `density`, `onRowClick`, `rowActions` | Registry, Runs, Audit, Evals |
| `FilterBar` | faceted + free-text filters, URL-synced | `facets`, `value`, `onChange` | Registry, Runs, Observability |
| `EntityDrawer` | right `Sheet` for any entity detail | `entity`, `tabs` | global |
| `StatCard` | metric + sparkline + delta + drill | `label`, `value`, `delta`, `series`, `href` | Dashboard, Observability |
| `MetricChart` | line/area/bar time-series | `series`, `kind`, `range`, `onBrush` | Dashboard, Observability, Evals |
| `StatusBadge` | unified status pill (run/agent/tool) | `status`, `size` | everywhere |
| `CostMeter` | tokens/$ vs cap, with bar | `spent`, `cap`, `tokensIn/out` | Run view, Dashboard, Builder |
| `Timeline` | ordered step list w/ live append | `steps`, `selectedId`, `onSelect` | Run view |
| `ReasoningStream` | streamed model reasoning block | `text`, `streaming` | Run view, Agent test |
| `ToolCallRecord` | expandable req/resp + latency | `call` | Run view, Observability |
| `JsonViewer` | collapsible, copyable JSON | `value`, `maxDepth` | tool calls, API nodes |
| `CodeEditor` | Monaco/CodeMirror wrapper | `language`, `value`, `vars` | prompt, code node, API node |
| `LogStream` | virtualized, follow-tail logs | `lines`, `follow` | Run view, Logs |
| `TraceWaterfall` | OTel span waterfall | `spans`, `onSelect` | Observability |
| `EmptyState` | icon + copy + CTA | `icon`, `title`, `cta` | everywhere |
| `ErrorState` | error class + message + retry | `error`, `onRetry` | everywhere |
| `ConfirmDialog` | destructive-action gate | `title`, `body`, `confirmLabel` | deletes, prod runs |
| `KeyValueList` | dense metadata display | `items` | drawers, detail panels |
| `RbacGate` | render-if-permitted wrapper | `permission`, `fallback` | actions everywhere |

### 5.3 Feature module anatomy (Tier 4)

Every feature folder is self-contained and mirrors the same shape:

```
features/agent-builder/
  components/        # AgentForm, ModelSection, ToolGrantList, GuardrailsPanel, TestHarness…
  hooks/            # useAgentDraft, useAgentMutations, useAgentTestRun
  api/              # query keys + fetchers + zod schemas for this domain
  store/            # builderStore.ts (Zustand slice: draft, dirty, active section)
  types.ts          # feature-local types (re-export shared domain types)
  index.ts          # public surface (only what pages may import)
```

### 5.4 Example composition tree — Task Execution View

```
RunPage (Tier5)
└─ AppShell
   └─ RunView (Tier4 feature)
      ├─ PageHeader  · RunControls (Pause/Resume/Cancel/Retry, RbacGate)
      ├─ ResizablePanels
      │  ├─ Timeline (Tier3)                ← subscribes useRunStream()
      │  │   └─ TimelineStep[]  · StatusBadge · CostMeter(mini)
      │  ├─ StepFocusPanel (Tier4)
      │  │   ├─ ReasoningStream (Tier3)
      │  │   ├─ ToolCallRecord[] (Tier3) · JsonViewer
      │  │   ├─ ApprovalCard (RbacGate)     ← when step is pending-approval
      │  │   └─ LogStream (Tier3)
      │  └─ RunSummary (Tier4)
      │      ├─ CostMeter (Tier3) · KeyValueList · ErrorRollup
      │      └─ links: Open trace / Replay
      └─ EntityDrawer (global)
```

### 5.5 Status vocabulary (single source of truth)

One `Status` enum, one color mapping, used by `StatusBadge` everywhere — no per-module reinvention.

```
run:    queued · running · paused · waiting_approval · succeeded · failed · cancelled · timed_out
agent:  healthy · degraded · error · idle · disabled
tool:   connected · degraded · disconnected · auth_expired · testing
step:   pending · running · succeeded · failed · skipped · retrying
ingest: queued · extracting · chunking · embedding · indexed · failed
```

Color tokens per status are in §6.4.

---

## 6. Design system tokens

Tailwind **v4** (CSS-first config via `@theme`). All tokens are CSS variables so dark mode = swapping variable values, not class trees. Color is defined in **OKLCH** for perceptually consistent light/dark and accessible contrast.

### 6.1 Token philosophy

- **Semantic, not literal.** Components use `bg-surface`, `text-muted`, `border-default`, `text-success` — never `bg-zinc-900`. Re-theming/white-label = change the mapping once.
- **Two layers:** *primitive scale* (raw OKLCH ramps) → *semantic tokens* (role-based, theme-aware) → components consume only semantic.
- **Density-aware spacing** via a `--density` multiplier (compact vs comfortable).

### 6.2 Color — semantic tokens (`globals.css`)

```css
@layer base {
  :root {
    /* surfaces (elevation 0→3) */
    --background:        oklch(0.99 0.002 250);
    --surface:           oklch(1    0      0);
    --surface-2:         oklch(0.975 0.003 250);
    --surface-3:         oklch(0.955 0.004 250);
    --overlay:           oklch(0.20 0.01 250 / 0.45);

    /* text */
    --foreground:        oklch(0.21 0.01 250);
    --muted-foreground:  oklch(0.50 0.01 250);
    --subtle-foreground: oklch(0.62 0.01 250);

    /* borders / inputs / rings */
    --border:            oklch(0.92 0.004 250);
    --border-strong:     oklch(0.86 0.005 250);
    --input:             oklch(0.92 0.004 250);
    --ring:              oklch(0.62 0.17 264);

    /* brand / primary */
    --primary:           oklch(0.58 0.20 264);   /* indigo-violet */
    --primary-foreground:oklch(0.99 0.005 264);
    --accent:            oklch(0.96 0.02 264);
    --accent-foreground: oklch(0.40 0.12 264);

    /* status (semantic) */
    --success:           oklch(0.62 0.16 150);
    --warning:           oklch(0.75 0.16 75);
    --danger:            oklch(0.58 0.22 25);
    --info:              oklch(0.62 0.15 235);
    --running:           oklch(0.62 0.17 264);   /* same hue as brand = "active" */
    --neutral:           oklch(0.60 0.01 250);

    /* status surfaces (subtle bg for badges/rows) */
    --success-surface:   oklch(0.95 0.04 150);
    --warning-surface:   oklch(0.96 0.05 75);
    --danger-surface:    oklch(0.95 0.05 25);
    --info-surface:      oklch(0.95 0.04 235);

    /* data-viz categorical (color-blind-safe ramp) */
    --chart-1: oklch(0.62 0.19 264);
    --chart-2: oklch(0.66 0.15 195);
    --chart-3: oklch(0.70 0.16 140);
    --chart-4: oklch(0.74 0.15 75);
    --chart-5: oklch(0.64 0.20 25);
    --chart-6: oklch(0.58 0.16 320);

    --radius: 0.625rem;
    --navbar-h: 3.5rem;
    --density: 1;            /* compact=0.85, comfortable=1.0 */
  }

  .dark {
    --background:        oklch(0.16 0.005 250);
    --surface:           oklch(0.19 0.006 250);
    --surface-2:         oklch(0.22 0.007 250);
    --surface-3:         oklch(0.26 0.008 250);
    --overlay:           oklch(0.05 0.01 250 / 0.6);

    --foreground:        oklch(0.96 0.005 250);
    --muted-foreground:  oklch(0.70 0.01 250);
    --subtle-foreground: oklch(0.58 0.01 250);

    --border:            oklch(0.30 0.008 250);
    --border-strong:     oklch(0.38 0.01 250);
    --input:             oklch(0.30 0.008 250);
    --ring:              oklch(0.70 0.17 264);

    --primary:           oklch(0.70 0.18 264);
    --primary-foreground:oklch(0.16 0.01 264);
    --accent:            oklch(0.28 0.04 264);
    --accent-foreground: oklch(0.90 0.05 264);

    --success: oklch(0.72 0.16 150);  --success-surface: oklch(0.26 0.05 150);
    --warning: oklch(0.80 0.15 75);   --warning-surface: oklch(0.28 0.05 75);
    --danger:  oklch(0.68 0.20 25);   --danger-surface:  oklch(0.28 0.06 25);
    --info:    oklch(0.72 0.14 235);  --info-surface:    oklch(0.26 0.05 235);
    --running: oklch(0.72 0.17 264);
  }
}
```

### 6.3 Tailwind v4 `@theme` binding

```css
@import "tailwindcss";

@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-foreground: var(--foreground);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-accent: var(--accent);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
  --color-info: var(--info);
  --color-running: var(--running);
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
}
```

Usage in components: `class="bg-surface text-foreground border border-border"`, `class="text-success"`, `class="bg-danger/10 text-danger"`. Never raw palette colors.

### 6.4 Status → token map

```
status        text/icon       surface (row/badge bg)
─────────────────────────────────────────────────────
succeeded     text-success    bg-success/10
running       text-running     bg-running/10  + pulse
paused        text-warning    bg-warning/10
waiting_appr. text-info       bg-info/10
failed        text-danger     bg-danger/10
cancelled     text-muted      bg-surface-2
queued/idle   text-muted      bg-surface-2
degraded      text-warning    bg-warning/10
```

### 6.5 Typography

```css
@theme inline {
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, "SF Mono", monospace;
}
```

Fluid type scale with `clamp()` (paired with a fixed compact scale for dense tables):

| Token | clamp() | Use |
|-------|---------|-----|
| `text-display` | `clamp(1.75rem, 1.2rem + 2vw, 2.5rem)` | page hero / empty states |
| `text-h1` | `clamp(1.375rem, 1.1rem + 1vw, 1.75rem)` | page titles |
| `text-h2` | `clamp(1.125rem, 1rem + 0.5vw, 1.375rem)` | section headers |
| `text-body` | `0.875rem` (14px) | default UI text |
| `text-sm` | `0.8125rem` (13px) | tables, dense rows |
| `text-xs` | `0.75rem` (12px) | metadata, captions |
| `text-mono` | `0.8125rem` mono | code, ids, JSON, logs |

Body/UI text stays at fixed sizes for density predictability; only headings and marketing/empty-state copy use fluid `clamp()`. Line-height 1.5 body, 1.3 headings, 1.45 logs.

### 6.6 Spacing, radius, density

- 4px base grid. Spacing scale `0,1,2,3,4,6,8,12,16,24` → `* var(--density)` for layout paddings.
- **Density toggle:** compact (`--density:0.85`, row height 32px) vs comfortable (`--density:1`, 40px). Tables and lists read it; persisted in UI store. Touch devices force ≥44px hit areas regardless via `min-h-[44px]` on interactive rows.
- Radius: `sm` inputs/badges, `md` buttons/cards, `lg` panels/sheets. Full pills for status badges.

### 6.7 Elevation & motion

- Elevation via surface tokens + subtle ring, not heavy shadows (enterprise/flat aesthetic): `shadow-xs` cards, `shadow-md` popovers, `shadow-lg` drawers/dialogs.
- Motion: Framer Motion, **150–200ms** ease-out for enter, 100ms exit. Reserved for: drawer/sheet slide, toast, node-run pulse, list reorder. **Respect `prefers-reduced-motion`** → all non-essential motion off; streaming text still appends (no animation needed).
- **No `backdrop-blur` on full-screen overlays** (mobile GPU rule); modals/drawers use solid `bg-overlay`. `will-change-transform` + `transition-transform` on sliding sheets.

### 6.8 Iconography & assets

- **Lucide** icon set (consistent 1.5px stroke). One icon per entity type, reused everywhere (agent=🤖/`bot`, tool=`wrench`, workflow=`workflow`, run=`play`, memory=`database`, decision=`git-branch`, approval=`shield-check`).
- Tabular numbers (`font-variant-numeric: tabular-nums`) for all metrics/costs/latency so columns align and don't jitter while streaming.
