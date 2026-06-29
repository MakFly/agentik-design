import { describe, expect, test } from "bun:test";
import {
  agentVersion,
  DEFAULT_MEMORY_POLICY,
  DEFAULT_SKILL_POLICY,
  memoryEntry,
  proposedSkillChange,
  reviewAgentOutput,
  runtimeEvent,
  runtimeEventV2,
  skillVersion,
} from "./index";

describe("agentVersion", () => {
  test("accepts a valid immutable version", () => {
    const v = agentVersion.parse({
      id: "aver_1",
      agentId: "agt_1",
      version: 1,
      instructions: "do the thing",
      tools: ["get_weather"],
      runtimeKind: "claude",
      memoryPolicy: DEFAULT_MEMORY_POLICY,
      skillPolicy: DEFAULT_SKILL_POLICY,
      createdBy: "user",
      createdAt: "2026-06-22T00:00:00.000Z",
    });
    expect(v.version).toBe(1);
  });

  test("rejects non-positive version (monotonicity guard)", () => {
    expect(() =>
      agentVersion.parse({
        id: "aver_0",
        agentId: "agt_1",
        version: 0,
        instructions: "",
        tools: [],
        runtimeKind: "claude",
        memoryPolicy: DEFAULT_MEMORY_POLICY,
        skillPolicy: DEFAULT_SKILL_POLICY,
        createdBy: "user",
        createdAt: "2026-06-22T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("memoryEntry", () => {
  test("clamps confidence to 0..1", () => {
    expect(() =>
      memoryEntry.parse({
        id: "mem_1",
        teamId: "team_1",
        scope: "agent",
        content: "x",
        confidence: 1.5,
        createdBy: "review_agent",
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-22T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("reviewAgentOutput", () => {
  test("parses a deterministic reviewer output with a memory proposal", () => {
    const out = reviewAgentOutput.parse({
      summary: "task failed; captured the failure",
      riskLevel: "low",
      shouldCreateMemory: true,
      memories: [
        {
          action: "create",
          scope: "agent",
          content: "avoid X",
          reason: "run failed at X",
          confidence: 0.6,
        },
      ],
      shouldCreateSkill: false,
      skillChanges: [],
    });
    expect(out.memories).toHaveLength(1);
  });

  test("discriminates skill change create vs patch", () => {
    const patch = proposedSkillChange.parse({
      action: "patch",
      skillName: "deploy",
      oldText: "old",
      newText: "new",
      reason: "fix",
    });
    expect(patch.action).toBe("patch");
  });
});

describe("runtimeEvent", () => {
  test("validates the daemon stream union", () => {
    expect(runtimeEvent.parse({ type: "text", content: "hi" }).type).toBe("text");
    expect(runtimeEvent.parse({ type: "done", result: { ok: true } }).type).toBe("done");
    expect(() => runtimeEvent.parse({ type: "nope" })).toThrow();
  });

  test("validates normalized V2 tool call events", () => {
    const started = runtimeEventV2.parse({
      type: "tool_call.started",
      eventId: "evt_1",
      seq: 1,
      actor: { kind: "tool", toolId: "WebSearch", name: "WebSearch" },
      toolCallId: "tc_1",
      toolId: "WebSearch",
      input: { query: "PPRI Lezarde" },
    });
    expect(started.type).toBe("tool_call.started");
    if (started.type !== "tool_call.started") throw new Error("unexpected event");
    expect(started.toolCallId).toBe("tc_1");
    expect(() =>
      runtimeEventV2.parse({
        type: "tool_call.completed",
        eventId: "evt_2",
        seq: 2,
        actor: { kind: "tool", toolId: "WebSearch" },
        toolId: "WebSearch",
        status: "succeeded",
      }),
    ).toThrow();
  });
});

describe("skillVersion", () => {
  test("requires positive version", () => {
    const sv = skillVersion.parse({
      id: "sver_1",
      skillId: "skill_1",
      version: 1,
      bodyMd: "# how to",
      triggerConditions: ["when X"],
      pitfalls: [],
      verificationSteps: ["run tests"],
      createdBy: "review_agent",
      createdAt: "2026-06-22T00:00:00.000Z",
    });
    expect(sv.version).toBe(1);
  });
});
