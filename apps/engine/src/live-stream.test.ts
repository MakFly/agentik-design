import { describe, expect, test } from "bun:test";
import { agentTaskMessageToEvents } from "./agents-repo";
import type { taskMessages } from "./db/schema";

type MsgRow = typeof taskMessages.$inferSelect;

/** Build a task_messages row with sane defaults for the fields under test. */
function msg(partial: Partial<MsgRow>): MsgRow {
  return {
    id: "msg_1",
    taskId: "atask_1",
    seq: 1,
    type: "text",
    tool: null,
    content: null,
    input: null,
    output: null,
    createdAt: new Date(),
    ...partial,
  } as MsgRow;
}

describe("agentTaskMessageToEvents (live SSE ↔ web event-reducer contract)", () => {
  test("each message becomes one step (id = msg.id, index = msg.seq)", () => {
    const evs = agentTaskMessageToEvents(msg({ id: "msg_42", seq: 42, type: "text", content: "hi" }), "Bot");
    const started = evs.find((e) => e.type === "step.started");
    expect(started).toMatchObject({ type: "step.started", step: { id: "msg_42", index: 42, summary: "hi" } });
  });

  test("thinking → step.started + reasoning.delta + step.completed", () => {
    const evs = agentTaskMessageToEvents(msg({ id: "m", type: "thinking", content: "pondering" }), "Bot");
    expect(evs.map((e) => e.type)).toEqual(["step.started", "reasoning.delta", "step.completed"]);
    expect(evs[1]).toMatchObject({ type: "reasoning.delta", stepId: "m", textDelta: "pondering" });
  });

  test("thinking with no content omits the reasoning.delta", () => {
    const evs = agentTaskMessageToEvents(msg({ type: "thinking", content: null }));
    expect(evs.map((e) => e.type)).toEqual(["step.started", "step.completed"]);
  });

  test("tool_use → tool actor step that stays running (no completion)", () => {
    const evs = agentTaskMessageToEvents(msg({ id: "tu", type: "tool_use", tool: "search", input: { q: "x" } }));
    expect(evs.map((e) => e.type)).toEqual(["step.started", "tool_call.started"]);
    expect(evs[0]).toMatchObject({ step: { actor: { kind: "tool", toolId: "search" } } });
    expect(evs[1]).toMatchObject({ type: "tool_call.started", call: { id: "tu", request: { q: "x" } } });
  });

  test("tool_result → started + completed tool call, step succeeds", () => {
    const evs = agentTaskMessageToEvents(msg({ id: "tr", type: "tool_result", tool: "search", output: { ok: true } }));
    expect(evs.map((e) => e.type)).toEqual(["step.started", "tool_call.started", "tool_call.completed", "step.completed"]);
    expect(evs[2]).toMatchObject({ type: "tool_call.completed", callId: "tr", status: "succeeded", response: { ok: true } });
  });

  test("error → step.failed carries the message", () => {
    const evs = agentTaskMessageToEvents(msg({ id: "e", type: "error", content: "boom" }));
    expect(evs.map((e) => e.type)).toEqual(["step.started", "step.failed"]);
    expect(evs[1]).toMatchObject({ type: "step.failed", stepId: "e", error: { message: "boom", retryable: false } });
  });
});
