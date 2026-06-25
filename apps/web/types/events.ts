/**
 * Realtime event schema (docs/04 §10). Transport: SSE for streams, WS for control.
 * Every event has a global `id` (Last-Event-ID replay), per-run `seq`, ISO `ts`.
 */
import type {
  RunId,
  StepId,
  StepError,
  RunStatus,
  Cost,
  Money,
  ToolCall,
  ApprovalState,
  StepActor,
  AppErrorKind,
  UserId,
  ISODate,
} from "./domain";

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
    id: StepId;
    index: number;
    actor: StepActor;
    summary: string;
    nodeId?: string;
  };
}
export interface StepCompleted {
  type: "step.completed";
  stepId: StepId;
  status: "succeeded" | "skipped";
  durationMs: number;
  cost: Cost;
  summary: string;
}
export interface StepFailed {
  type: "step.failed";
  stepId: StepId;
  error: StepError;
}
export interface StepRetrying {
  type: "step.retrying";
  stepId: StepId;
  attempt: number;
  delayMs: number;
}
export interface ReasoningDelta {
  type: "reasoning.delta";
  stepId: StepId;
  textDelta: string;
}
export interface ToolCallStarted {
  type: "tool_call.started";
  stepId: StepId;
  call: Pick<ToolCall, "id" | "toolId" | "action" | "request">;
}
export interface ToolCallCompleted {
  type: "tool_call.completed";
  stepId: StepId;
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
  stepId: StepId;
  approval: ApprovalState;
}
export interface ApprovalResolved {
  type: "approval.resolved";
  stepId: StepId;
  decision: "approved" | "rejected" | "timed_out";
  by?: UserId;
}
export interface LogLine {
  type: "log.line";
  stepId?: StepId;
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
  runId: RunId;
  event: T["type"];
  /** Orchestrator-level event name from docs/agentic-system/ORCHESTRATOR.md. */
  contractEvent?: string;
  data: T;
}

/* ───────────────── Control channel (WS, client → server) ──────────────── */

export type ControlMessage =
  | { type: "run.subscribe"; runId: RunId; lastEventId?: string }
  | { type: "run.unsubscribe"; runId: RunId }
  | { type: "run.pause"; runId: RunId }
  | { type: "run.resume"; runId: RunId }
  | { type: "run.cancel"; runId: RunId }
  | {
      type: "run.approve";
      runId: RunId;
      stepId: StepId;
      decision: "approve" | "reject";
      reason?: string;
    };

export interface ControlAck {
  type: "control.ack";
  runId: RunId;
  action: string;
  accepted: boolean;
  error?: string;
}
