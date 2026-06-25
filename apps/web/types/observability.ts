/**
 * OpenTelemetry-style trace models for the Observability surface. A trace is an
 * immutable, post-hoc record of one agent-task execution: a tree of spans, each
 * span an instrumented unit of work (an LLM call, a tool invocation, an HTTP
 * request, a guardrail check…). These are the canonical shapes the UI renders;
 * the data is served by the local route handlers under
 * `app/api/v1/observability/*` (see lib/observability/trace-data.ts).
 */

import type { Env, ISODate, TokenUsage } from "@/types/domain";

export type TraceId = string;
export type SpanId = string;

/** OpenTelemetry span kind (the subset that shows up in agent execution). */
export type SpanKind = "server" | "client" | "internal" | "producer" | "consumer";

/** OTel status code for a span. */
export type SpanStatusCode = "ok" | "error" | "unset";

/** Semantic category we color/iconize by, derived from the operation. */
export type SpanCategory =
  | "agent"
  | "llm"
  | "tool"
  | "http"
  | "memory"
  | "decision"
  | "guardrail"
  | "workflow"
  | "approval";

export type AttrValue = string | number | boolean;

/** A point-in-time event recorded on a span (OTel span events). */
export interface SpanEvent {
  name: string;
  /** ms offset relative to the span's own start */
  timeOffsetMs: number;
  level?: "info" | "warn" | "error";
  attributes?: Record<string, AttrValue>;
}

export interface Span {
  spanId: SpanId;
  parentSpanId: SpanId | null;
  traceId: TraceId;
  /** operation name, e.g. "llm.chat", "tool.execute search_kb" */
  name: string;
  /** emitting service, e.g. "orchestrator", "anthropic", "kb-tool" */
  service: string;
  kind: SpanKind;
  category: SpanCategory;
  status: SpanStatusCode;
  statusMessage?: string;
  /** ms offset relative to trace start (t0) */
  startOffsetMs: number;
  durationMs: number;
  /** flat OTel attributes */
  attributes: Record<string, AttrValue>;
  events: SpanEvent[];
  /** rich request/response payloads for llm/tool/http spans */
  io?: { request?: unknown; response?: unknown };
  tokens?: TokenUsage;
  costCents?: number;
}

export interface TraceSummary {
  traceId: TraceId;
  rootName: string;
  rootService: string;
  status: SpanStatusCode;
  env: Env;
  startedAt: ISODate;
  durationMs: number;
  spanCount: number;
  serviceCount: number;
  errorCount: number;
  tokens: number;
  costCents: number;
}

export interface TraceDetail {
  trace: TraceSummary;
  spans: Span[];
  /** distinct services in the trace, ordered by first appearance */
  services: string[];
}

/* ───────────────────────── Aggregated metrics ───────────────────────── */

export interface MetricPoint {
  /** bucket label, e.g. "14:20" */
  t: string;
  traces: number;
  errors: number;
  p95Ms: number;
  costCents: number;
}

export interface ServiceStat {
  name: string;
  spanCount: number;
  errorRate: number;
  p95Ms: number;
  costCents: number;
}

export interface OperationStat {
  name: string;
  service: string;
  category: SpanCategory;
  count: number;
  p95Ms: number;
  errorRate: number;
}

export interface ObsMetrics {
  traceCount: number;
  /** 0..1 */
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  throughputPerMin: number;
  totalCostCents: number;
  totalTokens: number;
  series: MetricPoint[];
  services: ServiceStat[];
  topOperations: OperationStat[];
}

export interface TracesResponse {
  items: TraceSummary[];
  metrics: ObsMetrics;
  total: number;
}
