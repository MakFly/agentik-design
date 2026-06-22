import { describe, expect, test } from "bun:test";
import { deterministicReview } from "./review-agent";

describe("deterministicReview (offline, propose-only)", () => {
  test("failed run → one medium-risk memory lesson, no skills", () => {
    const out = deterministicReview({ taskId: "atask_1", agentId: "agt_1", status: "failed", error: "boom", messages: [] });
    expect(out.riskLevel).toBe("medium");
    expect(out.shouldCreateMemory).toBe(true);
    expect(out.memories).toHaveLength(1);
    expect(out.memories[0]?.content).toContain("boom");
    expect(out.memories[0]?.scope).toBe("agent");
    expect(out.skillChanges).toHaveLength(0);
  });

  test("success with tools → one low-confidence note", () => {
    const out = deterministicReview({
      taskId: "atask_2",
      agentId: "agt_1",
      status: "completed",
      messages: [{ type: "tool_use", tool: "get_weather" }],
    });
    expect(out.riskLevel).toBe("low");
    expect(out.memories).toHaveLength(1);
    expect(out.memories[0]?.content).toContain("get_weather");
    expect(out.memories[0]?.confidence).toBe(0.5);
  });

  test("quiet success → no proposals (avoids review spam)", () => {
    const out = deterministicReview({
      taskId: "atask_3",
      agentId: "agt_1",
      status: "completed",
      messages: [{ type: "text", content: "ok" }],
    });
    expect(out.shouldCreateMemory).toBe(false);
    expect(out.memories).toHaveLength(0);
  });
});
