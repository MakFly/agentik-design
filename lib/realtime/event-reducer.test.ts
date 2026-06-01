import { describe, it, expect } from "vitest";
import { runStreamReducer, emptyRunStreamState, type RunStreamState } from "./event-reducer";
import type { RunEvent } from "@/types/events";
import type { StepId } from "@/types/domain";

const STEP = "step_1" as StepId;
const cost = (cents: number) => ({ tokens: { input: 1, output: 1, total: 2 }, money: { amountCents: cents, currency: "USD" as const } });

function apply(state: RunStreamState, events: Array<[RunEvent, string?]>): RunStreamState {
  return events.reduce((s, [e, ts]) => runStreamReducer(s, e, ts ?? ""), state);
}

describe("runStreamReducer", () => {
  it("appends a started step and marks it running", () => {
    const next = runStreamReducer(
      emptyRunStreamState,
      { type: "step.started", step: { id: STEP, index: 0, actor: { kind: "decision", name: "Start" }, summary: "go" } },
      "2026-05-31T14:00:00Z",
    );
    expect(next.steps).toHaveLength(1);
    expect(next.steps[0]).toMatchObject({ id: STEP, status: "running", summary: "go", startedAt: "2026-05-31T14:00:00Z" });
  });

  it("is idempotent on a duplicate step.started (replay safety)", () => {
    const ev: RunEvent = { type: "step.started", step: { id: STEP, index: 0, actor: { kind: "decision", name: "Start" }, summary: "go" } };
    const next = apply(emptyRunStreamState, [[ev], [ev]]);
    expect(next.steps).toHaveLength(1);
  });

  it("accumulates reasoning deltas in order", () => {
    const next = apply(emptyRunStreamState, [
      [{ type: "step.started", step: { id: STEP, index: 0, actor: { kind: "agent", agentId: "a" as never, name: "A" }, summary: "" } }],
      [{ type: "reasoning.delta", stepId: STEP, textDelta: "Hello " }],
      [{ type: "reasoning.delta", stepId: STEP, textDelta: "world" }],
    ]);
    expect(next.reasoningByStep[STEP]).toBe("Hello world");
  });

  it("upserts a tool call then completes it with response + latency", () => {
    const next = apply(emptyRunStreamState, [
      [{ type: "step.started", step: { id: STEP, index: 0, actor: { kind: "agent", agentId: "a" as never, name: "A" }, summary: "" } }],
      [{ type: "tool_call.started", stepId: STEP, call: { id: "tc1", toolId: "t" as never, action: "search", request: { q: "x" } } }],
      [{ type: "tool_call.completed", stepId: STEP, callId: "tc1", status: "succeeded", httpStatus: 200, latencyMs: 120, response: { ok: true } }],
    ]);
    const call = next.steps[0].toolCalls[0];
    expect(call).toMatchObject({ id: "tc1", status: "succeeded", httpStatus: 200, latencyMs: 120 });
    expect(call.response).toEqual({ ok: true });
  });

  it("marks a step failed with its error", () => {
    const next = apply(emptyRunStreamState, [
      [{ type: "step.started", step: { id: STEP, index: 0, actor: { kind: "tool", toolId: "t" as never, name: "search" }, summary: "" } }],
      [{ type: "step.failed", stepId: STEP, error: { kind: "tool_error", code: "E500", message: "boom", retryable: true } }],
    ]);
    expect(next.steps[0].status).toBe("failed");
    expect(next.steps[0].error).toMatchObject({ code: "E500", retryable: true });
  });

  it("tracks cost and cap remaining", () => {
    const next = runStreamReducer(emptyRunStreamState, {
      type: "run.cost.updated",
      cost: cost(12),
      capRemaining: { amountCents: 8, currency: "USD" },
    });
    expect(next.cost?.money.amountCents).toBe(12);
    expect(next.capRemaining?.amountCents).toBe(8);
  });

  it("records an approval request as a pending step", () => {
    const next = apply(emptyRunStreamState, [
      [{ type: "step.started", step: { id: STEP, index: 0, actor: { kind: "approval", name: "Gate" }, summary: "" } }],
      [{ type: "approval.requested", stepId: STEP, approval: { status: "pending", approverRole: "operator", message: "ok?", context: {} } }],
    ]);
    expect(next.steps[0].status).toBe("pending");
    expect(next.steps[0].approval?.status).toBe("pending");
  });

  it("caps the log buffer length", () => {
    let state = emptyRunStreamState;
    for (let i = 0; i < 600; i++) {
      state = runStreamReducer(state, { type: "log.line", level: "info", message: `line ${i}` }, "2026-05-31T14:00:00Z");
    }
    expect(state.logs.length).toBeLessThanOrEqual(500);
    expect(state.logs.at(-1)?.message).toBe("line 599");
  });
});
