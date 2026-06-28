import { describe, expect, test } from "bun:test";
import { runMessagesToSteps, type RunMsgRowDb } from "../../../src/domains/runs/mappers";

function msg(patch: Partial<RunMsgRowDb>): RunMsgRowDb {
  const createdAt = "2026-06-28T12:00:00.000Z";
  return {
    id: "amsg",
    runId: "run_1",
    seq: 0,
    type: "text",
    tool: null,
    content: null,
    input: null,
    output: null,
    createdAt,
    ...patch,
  } as RunMsgRowDb;
}

describe("runMessagesToSteps", () => {
  test("groups tool_use and nameless tool_result into one operator step", () => {
    const steps = runMessagesToSteps([
      msg({
        id: "search_1",
        seq: 0,
        type: "tool_use",
        tool: "WebSearch",
        input: { query: "PPRI Lezarde" },
        createdAt: "2026-06-28T12:00:00.000Z",
      }),
      msg({
        id: "search_2",
        seq: 1,
        type: "tool_use",
        tool: "WebSearch",
        input: { query: "TRI Le Havre" },
        createdAt: "2026-06-28T12:00:01.000Z",
      }),
      msg({
        id: "result_1",
        seq: 2,
        type: "tool_result",
        tool: null,
        output: "first result",
        createdAt: "2026-06-28T12:00:02.000Z",
      }),
      msg({
        id: "result_2",
        seq: 3,
        type: "tool_result",
        tool: null,
        output: "second result",
        createdAt: "2026-06-28T12:00:03.000Z",
      }),
    ]);

    expect(steps).toHaveLength(2);
    expect(steps.map((step) => step.summary)).toEqual([
      "WebSearch completed",
      "WebSearch completed",
    ]);
    expect(steps.map((step) => step.status)).toEqual(["succeeded", "succeeded"]);
    expect(steps[0]?.toolCalls[0]?.request).toEqual({ query: "PPRI Lezarde" });
    expect(steps[0]?.toolCalls[0]?.response).toBe("first result");
    expect(steps[1]?.toolCalls[0]?.request).toEqual({ query: "TRI Le Havre" });
    expect(steps[1]?.toolCalls[0]?.response).toBe("second result");
  });
});
