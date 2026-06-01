/**
 * Pure reducer applying typed RunEvents to a per-run stream state (docs/04 §10.4).
 * High-frequency reasoning/log deltas are appended in place; structural events
 * (step start/complete, status, cost) patch the relevant slice. Kept pure so it's
 * unit-testable and replayable from a Last-Event-ID checkpoint.
 */
import type { RunEvent } from "@/types/events";
import type { Step, RunStatus, Cost, Money } from "@/types/domain";

export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface LogEntry {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  stepId?: string;
}

export interface RunStreamState {
  status: RunStatus | null;
  steps: Step[];
  reasoningByStep: Record<string, string>;
  logs: LogEntry[];
  cost: Cost | null;
  capRemaining?: Money;
  connection: ConnectionState;
  lastEventId?: string;
  error?: string;
}

export const emptyRunStreamState: RunStreamState = {
  status: null,
  steps: [],
  reasoningByStep: {},
  logs: [],
  cost: null,
  connection: "idle",
};

const MAX_LOGS = 500;

function upsertStep(steps: Step[], id: string, patch: Partial<Step>): Step[] {
  const i = steps.findIndex((s) => s.id === id);
  if (i === -1) return steps;
  const next = steps.slice();
  next[i] = { ...next[i], ...patch };
  return next;
}

export function runStreamReducer(state: RunStreamState, event: RunEvent, ts = ""): RunStreamState {
  switch (event.type) {
    case "run.status.changed":
      return { ...state, status: event.status };

    case "run.cost.updated":
      return { ...state, cost: event.cost, capRemaining: event.capRemaining };

    case "step.started": {
      const exists = state.steps.some((s) => s.id === event.step.id);
      if (exists) return state;
      const step: Step = {
        id: event.step.id,
        runId: state.steps[0]?.runId ?? ("" as Step["runId"]),
        index: event.step.index,
        nodeId: event.step.nodeId,
        actor: event.step.actor,
        status: "running",
        summary: event.step.summary,
        toolCalls: [],
        startedAt: ts,
        endedAt: null,
        durationMs: null,
        cost: { tokens: { input: 0, output: 0, total: 0 }, money: { amountCents: 0, currency: "USD" } },
        attempt: 1,
      };
      return { ...state, steps: [...state.steps, step] };
    }

    case "step.completed":
      return {
        ...state,
        steps: upsertStep(state.steps, event.stepId, {
          status: event.status,
          durationMs: event.durationMs,
          cost: event.cost,
          summary: event.summary,
          endedAt: ts || null,
        }),
      };

    case "step.failed":
      return {
        ...state,
        steps: upsertStep(state.steps, event.stepId, { status: "failed", error: event.error }),
      };

    case "step.retrying":
      return {
        ...state,
        steps: upsertStep(state.steps, event.stepId, { status: "retrying", attempt: event.attempt }),
      };

    case "reasoning.delta":
      return {
        ...state,
        reasoningByStep: {
          ...state.reasoningByStep,
          [event.stepId]: (state.reasoningByStep[event.stepId] ?? "") + event.textDelta,
        },
      };

    case "tool_call.started": {
      const step = state.steps.find((s) => s.id === event.stepId);
      if (!step) return state;
      const call = { ...event.call, status: "running" as const };
      return {
        ...state,
        steps: upsertStep(state.steps, event.stepId, { toolCalls: [...step.toolCalls, call] }),
      };
    }

    case "tool_call.completed": {
      const step = state.steps.find((s) => s.id === event.stepId);
      if (!step) return state;
      const toolCalls = step.toolCalls.map((c) =>
        c.id === event.callId
          ? { ...c, status: event.status, response: event.response, httpStatus: event.httpStatus, latencyMs: event.latencyMs, cost: event.cost, error: event.error }
          : c,
      );
      return { ...state, steps: upsertStep(state.steps, event.stepId, { toolCalls }) };
    }

    case "approval.requested":
      return {
        ...state,
        steps: upsertStep(state.steps, event.stepId, { status: "pending", approval: event.approval }),
      };

    case "approval.resolved":
      return {
        ...state,
        steps: upsertStep(state.steps, event.stepId, {
          approval: state.steps.find((s) => s.id === event.stepId)?.approval
            ? { ...state.steps.find((s) => s.id === event.stepId)!.approval!, status: event.decision === "approved" ? "approved" : event.decision === "rejected" ? "rejected" : "timed_out", decidedBy: event.by }
            : undefined,
        }),
      };

    case "log.line": {
      const entry: LogEntry = { ts: ts.slice(11, 19), level: event.level, message: event.message, stepId: event.stepId };
      const logs = [...state.logs, entry];
      return { ...state, logs: logs.length > MAX_LOGS ? logs.slice(-MAX_LOGS) : logs };
    }

    case "stream.error":
      return { ...state, error: event.message };

    default:
      return state;
  }
}
