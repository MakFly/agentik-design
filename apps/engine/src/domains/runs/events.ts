import type { RunEvent, OrchestratorRunEvent } from "@agentik/workflow-schema";
import type { RunMsgRowDb, WebRunStatus } from "./mappers";
import { ZERO_COST } from "./mappers";

/** Live SSE events emitted for daemon runs (subset of {@link RunEvent}). */
export type LiveRunEvent = RunEvent;

export type { OrchestratorRunEvent };

type LiveStepActor =
  | { kind: "agent"; agentId: string; name: string }
  | { kind: "tool"; toolId: string; name: string };

export function contractEventForStatus(
  status: WebRunStatus,
): OrchestratorRunEvent | undefined {
  switch (status) {
    case "running":
      return "run.started";
    case "paused":
      return "run.paused";
    case "waiting_approval":
      return "approval.requested";
    case "cancelled":
      return "run.cancelled";
    case "failed":
    case "timed_out":
      return "run.failed";
    case "succeeded":
      return "run.completed";
    default:
      return undefined;
  }
}

export function contractEventForRunMessage(
  msg: RunMsgRowDb,
  ev: LiveRunEvent,
): OrchestratorRunEvent | undefined {
  if (msg.type === "tool_use") return "tool.started";
  if (msg.type === "tool_result") {
    if (msg.tool === "workspace.prepare" && ev.type === "step.completed")
      return "workspace.prepared";
    return ev.type === "step.completed" ? "tool.output" : undefined;
  }
  if (msg.type === "error")
    return ev.type === "step.failed" ? "run.failed" : undefined;
  if (msg.type === "text")
    return ev.type === "step.completed" ? "message.created" : undefined;
  if (msg.type === "thinking")
    return ev.type === "reasoning.delta" ? "message.created" : undefined;
  return undefined;
}

/** Map one persisted task_message to its live event sequence (mirrors runMessageToStep). */
export function runMessageToEvents(
  msg: RunMsgRowDb,
  agentName?: string,
): LiveRunEvent[] {
  const stepId = msg.id;
  const index = msg.seq;
  const agentActor: LiveStepActor = {
    kind: "agent",
    agentId: "agt",
    name: agentName ?? "Agent",
  };

  if (msg.type === "tool_use") {
    const tool = msg.tool ?? "tool";
    return [
      {
        type: "step.started",
        step: {
          id: stepId,
          index,
          actor: { kind: "tool", toolId: tool, name: tool },
          summary: `Calling ${tool}`,
        },
      },
      {
        type: "tool_call.started",
        stepId,
        call: {
          id: stepId,
          toolId: tool,
          action: tool,
          request: msg.input ?? {},
        },
      },
    ];
  }
  if (msg.type === "tool_result") {
    const tool = msg.tool ?? "tool";
    return [
      {
        type: "step.started",
        step: {
          id: stepId,
          index,
          actor: { kind: "tool", toolId: tool, name: tool },
          summary: `${tool} → result`,
        },
      },
      {
        type: "tool_call.started",
        stepId,
        call: { id: stepId, toolId: tool, action: tool, request: {} },
      },
      {
        type: "tool_call.completed",
        stepId,
        callId: stepId,
        status: "succeeded",
        response: msg.output ?? undefined,
        latencyMs: 0,
      },
      {
        type: "step.completed",
        stepId,
        status: "succeeded",
        durationMs: 0,
        cost: ZERO_COST,
        summary: `${tool} → result`,
      },
    ];
  }
  if (msg.type === "error") {
    return [
      {
        type: "step.started",
        step: {
          id: stepId,
          index,
          actor: agentActor,
          summary: msg.content ?? "error",
        },
      },
      {
        type: "step.failed",
        stepId,
        error: {
          kind: "unknown",
          code: "error",
          message: msg.content ?? "error",
          retryable: false,
        },
      },
    ];
  }
  // text | thinking
  const summary =
    msg.content ?? (msg.type === "thinking" ? "Thinking" : msg.type);
  const events: LiveRunEvent[] = [
    {
      type: "step.started",
      step: { id: stepId, index, actor: agentActor, summary },
    },
  ];
  if (msg.type === "thinking" && msg.content)
    events.push({ type: "reasoning.delta", stepId, textDelta: msg.content });
  events.push({
    type: "step.completed",
    stepId,
    status: "succeeded",
    durationMs: 0,
    cost: ZERO_COST,
    summary,
  });
  return events;
}
