/**
 * Realtime event schema (docs/04 §10). Transport: SSE for streams, WS for control.
 * Plain `string` IDs — consumers (e.g. apps/web) may brand at the edge.
 */
import type { RunStatus } from "./run";

export type ISODate = string;

export interface Money {
  amountCents: number;
  currency: "USD";
}

export interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
  total: number;
}

export interface Cost {
  tokens: TokenUsage;
  money: Money;
}

export type AppErrorKind =
  | "network"
  | "auth"
  | "forbidden"
  | "not_found"
  | "validation"
  | "rate_limit"
  | "provider"
  | "conflict"
  | "server"
  | "tool_error"
  | "timeout"
  | "budget_exceeded"
  | "unknown";

export interface StepError {
  kind: AppErrorKind;
  code: string;
  message: string;
  retryable: boolean;
}

export interface ToolCall {
  id: string;
  toolId: string;
  action: string;
  request: unknown;
  response?: unknown;
  status: "running" | "succeeded" | "failed";
  httpStatus?: number;
  latencyMs?: number;
  cost?: Cost;
  error?: { code: string; message: string };
}

export interface ApprovalState {
  status: "pending" | "approved" | "rejected" | "timed_out";
  approverRole: string;
  message: string;
  context: Record<string, unknown>;
  decidedBy?: string;
  decidedAt?: ISODate;
  reason?: string;
}

export type StepActor =
  | { kind: "agent"; agentId: string; name: string }
  | { kind: "tool"; toolId: string; name: string }
  | { kind: "decision" | "approval" | "api" | "code" | "loop"; name: string };

export interface RunStatusChanged {
  type: "run.status.changed";
  status: RunStatus;
  reason?: string;
}

export interface RunCostUpdated {
  type: "run.cost.updated";
  cost: Cost;
  capRemaining?: Money;
}

export interface StepStarted {
  type: "step.started";
  step: {
    id: string;
    index: number;
    actor: StepActor;
    summary: string;
    nodeId?: string;
  };
}

export interface StepCompleted {
  type: "step.completed";
  stepId: string;
  status: "succeeded" | "skipped";
  durationMs: number;
  cost: Cost;
  summary: string;
}

export interface StepFailed {
  type: "step.failed";
  stepId: string;
  error: StepError;
}

export interface StepRetrying {
  type: "step.retrying";
  stepId: string;
  attempt: number;
  delayMs: number;
}

export interface ReasoningDelta {
  type: "reasoning.delta";
  stepId: string;
  textDelta: string;
}

export interface ToolCallStarted {
  type: "tool_call.started";
  stepId: string;
  call: Pick<ToolCall, "id" | "toolId" | "action" | "request">;
}

export interface ToolCallCompleted {
  type: "tool_call.completed";
  stepId: string;
  callId: string;
  status: "succeeded" | "failed";
  response?: unknown;
  httpStatus?: number;
  latencyMs: number;
  cost?: Cost;
  error?: ToolCall["error"];
}

export interface ApprovalRequested {
  type: "approval.requested";
  stepId: string;
  approval: ApprovalState;
}

export interface ApprovalResolved {
  type: "approval.resolved";
  stepId: string;
  decision: "approved" | "rejected" | "timed_out";
  by?: string;
}

export interface LogLine {
  type: "log.line";
  stepId?: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

export interface StreamError {
  type: "stream.error";
  kind: AppErrorKind;
  message: string;
  fatal: boolean;
}

export type RunEvent =
  | RunStatusChanged
  | RunCostUpdated
  | StepStarted
  | StepCompleted
  | StepFailed
  | StepRetrying
  | ReasoningDelta
  | ToolCallStarted
  | ToolCallCompleted
  | ApprovalRequested
  | ApprovalResolved
  | LogLine
  | StreamError;

export type RunEventType = RunEvent["type"];

export interface EventEnvelope<T extends RunEvent = RunEvent> {
  id: string;
  seq: number;
  ts: ISODate;
  runId: string;
  event: T["type"];
  /** Orchestrator-level event name from docs/agentic-system/ORCHESTRATOR.md. */
  contractEvent?: OrchestratorRunEvent;
  data: T;
}

/** Orchestrator contract event names (docs/agentic-system/ORCHESTRATOR.md). */
export type OrchestratorRunEvent =
  | "run.started"
  | "workspace.prepared"
  | "message.created"
  | "tool.started"
  | "tool.output"
  | "approval.requested"
  | "approval.resolved"
  | "file.changed"
  | "test.started"
  | "test.finished"
  | "subagent.started"
  | "subagent.finished"
  | "run.paused"
  | "run.resumed"
  | "run.cancelled"
  | "run.failed"
  | "run.completed"
  | "memory.proposed";

/* ───────────────── Control channel (WS, client → server) ──────────────── */

export type ControlMessage =
  | { type: "run.subscribe"; runId: string; lastEventId?: string }
  | { type: "run.unsubscribe"; runId: string }
  | { type: "run.pause"; runId: string }
  | { type: "run.resume"; runId: string }
  | { type: "run.cancel"; runId: string }
  | {
      type: "run.approve";
      runId: string;
      stepId: string;
      decision: "approve" | "reject";
      reason?: string;
    };

export interface ControlAck {
  type: "control.ack";
  runId: string;
  action: string;
  accepted: boolean;
  error?: string;
}
