/**
 * Observability projection — turns REAL runs into OpenTelemetry-style traces.
 * Zero mock: every trace is a real agent_task (or workflow run) and its real
 * task_messages / run_steps, re-viewed as a span tree. Cost/tokens come from the
 * runtime's own completion result (claude usage); span durations are derived from
 * the real message timestamps (a step lasts until the next event fires).
 *
 * The output matches apps/web/types/observability.ts exactly (the web UI is
 * unchanged). This reuses the same projections that already back /runs.
 */

import { listRunsUnion, getRunUnified, workflowDetailToWeb, type WebRunStatus } from "./agents-repo";
import { getRun } from "./repo";

/* ── Contract shapes (mirror apps/web/types/observability.ts) ─────────────── */

type SpanKind = "server" | "client" | "internal" | "producer" | "consumer";
type SpanStatusCode = "ok" | "error" | "unset";
type SpanCategory =
  | "agent" | "llm" | "tool" | "http" | "memory" | "decision" | "guardrail" | "workflow" | "approval";
type AttrValue = string | number | boolean;

interface TokenUsage { input: number; output: number; cached?: number; total: number }

interface Span {
  spanId: string;
  parentSpanId: string | null;
  traceId: string;
  name: string;
  service: string;
  kind: SpanKind;
  category: SpanCategory;
  status: SpanStatusCode;
  statusMessage?: string;
  startOffsetMs: number;
  durationMs: number;
  attributes: Record<string, AttrValue>;
  events: Array<{ name: string; timeOffsetMs: number; level?: "info" | "warn" | "error"; attributes?: Record<string, AttrValue> }>;
  io?: { request?: unknown; response?: unknown };
  tokens?: TokenUsage;
  costCents?: number;
}

interface TraceSummary {
  traceId: string;
  rootName: string;
  rootService: string;
  status: SpanStatusCode;
  env: "dev" | "staging" | "prod";
  startedAt: string;
  durationMs: number;
  spanCount: number;
  serviceCount: number;
  errorCount: number;
  tokens: number;
  costCents: number;
}

/* ── Loose structural views of the web {run, steps} contract ─────────────── */

interface PRun {
  id: string;
  teamId: string;
  env: "dev" | "staging" | "prod";
  subject: { kind: "agent" | "workflow"; agentId?: string; workflowId?: string; versionId: string };
  subjectName?: string;
  status: WebRunStatus;
  trigger: { kind: string };
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  cost: { tokens: TokenUsage; money: { amountCents: number; currency: "USD" } };
  traceId: string;
  error?: { message: string };
  stepCount: number;
  completedSteps: number;
}

interface PToolCall {
  id: string;
  toolId: string;
  action: string;
  request?: unknown;
  response?: unknown;
  status: "running" | "succeeded" | "failed";
  httpStatus?: number;
  latencyMs?: number;
  error?: { code?: string; message: string };
}

interface PStep {
  id: string;
  runId: string;
  index: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  attempt: number;
  actor: { kind: string; agentId?: string; toolId?: string; name: string };
  status: string;
  summary: string;
  reasoning?: string;
  nodeId?: string;
  toolCalls: PToolCall[];
  error?: { message: string };
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** Postgres emits "YYYY-MM-DD HH:MM:SS+00"; normalize for Date.parse → epoch ms. */
function parseTs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(t) ? null : t;
}

function runDuration(run: PRun): number {
  if (run.durationMs && run.durationMs > 0) return run.durationMs;
  const a = parseTs(run.startedAt);
  const b = parseTs(run.endedAt);
  if (a != null && b != null && b > a) return b - a;
  return 0;
}

function runStatusToSpan(s: WebRunStatus): SpanStatusCode {
  if (s === "succeeded") return "ok";
  if (s === "failed" || s === "timed_out") return "error";
  return "unset";
}

function stepStatusToSpan(s: string): SpanStatusCode {
  if (s === "succeeded") return "ok";
  if (s === "failed") return "error";
  return "unset";
}

function callStatusToSpan(s: string): SpanStatusCode {
  if (s === "succeeded") return "ok";
  if (s === "failed") return "error";
  return "unset";
}

const ACTOR_CATEGORY: Record<string, SpanCategory> = {
  tool: "tool", agent: "agent", decision: "decision", approval: "approval", api: "http", loop: "workflow", code: "workflow",
};

function clip(s: string, n = 240): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function getRunDetail(teamId: string, id: string): Promise<{ run: PRun; steps: PStep[] } | null> {
  if (id.startsWith("atask_")) {
    const d = await getRunUnified(teamId, id);
    return d ? (d as unknown as { run: PRun; steps: PStep[] }) : null;
  }
  const d = await getRun(id, teamId);
  if (!d) return null;
  return workflowDetailToWeb(d as never) as unknown as { run: PRun; steps: PStep[] };
}

/* ── Trace detail (real span tree) ───────────────────────────────────────── */

export async function getTrace(teamId: string, id: string): Promise<{ trace: TraceSummary; spans: Span[]; services: string[] } | null> {
  const detail = await getRunDetail(teamId, id);
  if (!detail) return null;
  const { run, steps } = detail;

  const t0 = parseTs(run.startedAt) ?? 0;
  const starts = steps.map((s) => Math.max(0, (parseTs(s.startedAt) ?? t0) - t0));
  const lastStart = starts.length ? starts[starts.length - 1] ?? 0 : 0;
  const totalMs = Math.max(runDuration(run), lastStart, 1);

  const rootService = run.subjectName || (run.subject.kind === "agent" ? "agent" : "workflow");
  const spans: Span[] = [];

  spans.push({
    spanId: run.id,
    parentSpanId: null,
    traceId: run.id,
    name: run.subject.kind === "agent" ? "agent.task" : "workflow.run",
    service: rootService,
    kind: "server",
    category: "agent",
    status: runStatusToSpan(run.status),
    statusMessage: run.error?.message,
    startOffsetMs: 0,
    durationMs: totalMs,
    attributes: {
      "run.id": run.id,
      env: run.env,
      trigger: run.trigger.kind,
      "run.status": run.status,
      steps: run.stepCount,
      completed: run.completedSteps,
      ...(run.subject.kind === "agent"
        ? { "agent.id": run.subject.agentId ?? "" }
        : { "workflow.id": run.subject.workflowId ?? "" }),
    },
    events: [],
    tokens: run.cost.tokens.total > 0 ? run.cost.tokens : undefined,
    costCents: run.cost.money.amountCents || undefined,
  });

  steps.forEach((s, i) => {
    const start = starts[i] ?? 0;
    const next = i + 1 < starts.length ? starts[i + 1] ?? totalMs : totalMs;
    const dur = s.durationMs && s.durationMs > 0 ? s.durationMs : Math.max(next - start, 1);
    const kind = s.actor.kind;
    const isTool = kind === "tool";
    const category = ACTOR_CATEGORY[kind] ?? "agent";
    const name = isTool
      ? `tool.${s.actor.toolId ?? s.actor.name}`
      : kind === "agent"
        ? s.reasoning
          ? "agent.reasoning"
          : "agent.message"
        : kind === "decision"
          ? "decision.branch"
          : kind === "approval"
            ? "approval.gate"
            : kind === "api"
              ? "http.request"
              : `step.${kind}`;

    const attributes: Record<string, AttrValue> = { "step.index": s.index, attempt: s.attempt, status: s.status };
    if (s.nodeId) attributes["node.id"] = s.nodeId;
    const message = s.reasoning || s.summary;
    if (message) attributes.message = clip(message);

    const call = s.toolCalls?.[0];
    if (isTool && call?.httpStatus) attributes["http.status_code"] = call.httpStatus;

    spans.push({
      spanId: s.id,
      parentSpanId: run.id,
      traceId: run.id,
      name,
      service: s.actor.name || rootService,
      kind: isTool ? "client" : "internal",
      category,
      status: stepStatusToSpan(s.status),
      statusMessage: s.error?.message,
      startOffsetMs: start,
      durationMs: dur,
      attributes,
      events: [],
      io: isTool && call ? { request: call.request, response: call.response } : undefined,
    });

    // A non-tool step that itself invoked tools (workflow agent step) → child tool spans.
    if (!isTool && s.toolCalls?.length) {
      for (const c of s.toolCalls) {
        spans.push({
          spanId: c.id,
          parentSpanId: s.id,
          traceId: run.id,
          name: `tool.${c.action ?? c.toolId}`,
          service: c.toolId ?? "tool",
          kind: "client",
          category: c.httpStatus ? "http" : "tool",
          status: callStatusToSpan(c.status),
          statusMessage: c.error?.message,
          startOffsetMs: start,
          durationMs: Math.max(c.latencyMs ?? 1, 1),
          attributes: {
            "tool.action": c.action ?? "",
            ...(c.httpStatus ? { "http.status_code": c.httpStatus } : {}),
          },
          events: [],
          io: { request: c.request, response: c.response },
        });
      }
    }
  });

  const services = [...new Set(spans.map((s) => s.service))];
  const trace: TraceSummary = {
    traceId: run.id,
    rootName: run.subjectName || (run.subject.kind === "agent" ? "agent.task" : "workflow.run"),
    rootService,
    status: runStatusToSpan(run.status),
    env: run.env,
    startedAt: run.startedAt,
    durationMs: totalMs,
    spanCount: spans.length,
    serviceCount: services.length,
    errorCount: spans.filter((s) => s.status === "error").length,
    tokens: run.cost.tokens.total,
    costCents: run.cost.money.amountCents,
  };

  return { trace, spans, services };
}

/* ── Trace list + aggregated metrics (real runs) ─────────────────────────── */

function percentile(sortedAsc: number[], q: number): number {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(q * (sortedAsc.length - 1)));
  return Math.round(sortedAsc[idx] ?? 0);
}

function shallowSummary(run: PRun): TraceSummary {
  const status = runStatusToSpan(run.status);
  return {
    traceId: run.id,
    rootName: run.subjectName || (run.subject.kind === "agent" ? "agent.task" : "workflow.run"),
    rootService: run.subjectName || run.subject.kind,
    status,
    env: run.env,
    startedAt: run.startedAt,
    durationMs: runDuration(run),
    // stepCount is the real persisted message/step count; +1 for the root span.
    spanCount: run.stepCount + 1,
    // serviceCount needs the step tree; not shown in the list UI → reported as the
    // run's own service only. The detail view computes the true count from spans.
    serviceCount: 1,
    // a failed run has ≥1 error span; exact per-span count is resolved in the detail view.
    errorCount: status === "error" ? 1 : 0,
    tokens: run.cost.tokens.total,
    costCents: run.cost.money.amountCents,
  };
}

function buildSeries(runs: PRun[], now: number) {
  const HOUR = 3_600_000;
  const buckets = 24;
  const startBucket = (i: number) => now - (buckets - 1 - i) * HOUR;
  return Array.from({ length: buckets }, (_, i) => {
    const lo = startBucket(i);
    const hi = lo + HOUR;
    const inBucket = runs.filter((r) => {
      const ts = parseTs(r.startedAt);
      return ts != null && ts >= lo && ts < hi;
    });
    const durs = inBucket.map(runDuration).filter((d) => d > 0).sort((a, b) => a - b);
    const d = new Date(lo);
    return {
      t: `${String(d.getHours()).padStart(2, "0")}:00`,
      traces: inBucket.length,
      errors: inBucket.filter((r) => runStatusToSpan(r.status) === "error").length,
      p95Ms: percentile(durs, 0.95),
      costCents: inBucket.reduce((s, r) => s + r.cost.money.amountCents, 0),
    };
  });
}

function buildMetrics(runs: PRun[]) {
  const now = Date.now();
  const total = runs.length;
  const errors = runs.filter((r) => runStatusToSpan(r.status) === "error").length;
  const durs = runs.map(runDuration).filter((d) => d > 0).sort((a, b) => a - b);
  const dayAgo = now - 86_400_000;
  const last24 = runs.filter((r) => (parseTs(r.startedAt) ?? 0) >= dayAgo).length;

  // operations grouped by subject (which agent / workflow), ranked by P95
  const opMap = new Map<string, { service: string; category: SpanCategory; count: number; errs: number; durs: number[] }>();
  const svcMap = new Map<string, { count: number; errs: number; durs: number[]; cost: number }>();
  for (const r of runs) {
    const key = r.subjectName || r.subject.kind;
    const op = opMap.get(key) ?? { service: r.subject.kind, category: r.subject.kind === "agent" ? "agent" : "workflow", count: 0, errs: 0, durs: [] };
    op.count += 1;
    op.errs += runStatusToSpan(r.status) === "error" ? 1 : 0;
    const d = runDuration(r);
    if (d > 0) op.durs.push(d);
    opMap.set(key, op);

    const svc = svcMap.get(r.subject.kind) ?? { count: 0, errs: 0, durs: [], cost: 0 };
    svc.count += 1;
    svc.errs += runStatusToSpan(r.status) === "error" ? 1 : 0;
    if (d > 0) svc.durs.push(d);
    svc.cost += r.cost.money.amountCents;
    svcMap.set(r.subject.kind, svc);
  }

  const topOperations = [...opMap.entries()]
    .map(([name, v]) => ({ name, service: v.service, category: v.category, count: v.count, p95Ms: percentile([...v.durs].sort((a, b) => a - b), 0.95), errorRate: v.count ? v.errs / v.count : 0 }))
    .sort((a, b) => b.p95Ms - a.p95Ms)
    .slice(0, 6);

  const services = [...svcMap.entries()]
    .map(([name, v]) => ({ name, spanCount: v.count, errorRate: v.count ? v.errs / v.count : 0, p95Ms: percentile([...v.durs].sort((a, b) => a - b), 0.95), costCents: v.cost }))
    .sort((a, b) => b.p95Ms - a.p95Ms);

  return {
    traceCount: total,
    errorRate: total ? errors / total : 0,
    p50Ms: percentile(durs, 0.5),
    p95Ms: percentile(durs, 0.95),
    p99Ms: percentile(durs, 0.99),
    throughputPerMin: Math.round((last24 / (24 * 60)) * 100) / 100,
    totalCostCents: runs.reduce((s, r) => s + r.cost.money.amountCents, 0),
    totalTokens: runs.reduce((s, r) => s + r.cost.tokens.total, 0),
    series: buildSeries(runs, now),
    services,
    topOperations,
  };
}

export interface TraceListFilters {
  env?: string;
  status?: string;
  q?: string;
}

export async function listTraces(teamId: string, filters: TraceListFilters) {
  const runs = (await listRunsUnion(teamId, {})) as unknown as PRun[];
  let items = runs.map(shallowSummary);

  if (filters.env && filters.env !== "all") items = items.filter((t) => t.env === filters.env);
  if (filters.status && filters.status !== "all") {
    items = items.filter((t) => (filters.status === "error" ? t.status === "error" : t.status === "ok"));
  }
  if (filters.q) {
    const q = filters.q.toLowerCase();
    items = items.filter((t) => t.traceId.toLowerCase().includes(q) || t.rootName.toLowerCase().includes(q) || t.rootService.toLowerCase().includes(q));
  }

  // metrics reflect the full window (all real runs), independent of table filters
  return { items, metrics: buildMetrics(runs), total: items.length };
}
