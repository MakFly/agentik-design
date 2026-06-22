import { describe, expect, test } from "bun:test";
import type { KnowledgeScope, MemoryPolicy, SkillPolicy } from "@agentik/workflow-schema";
import {
  buildInjectionPreamble,
  nextVersion,
  selectMemoriesForInjection,
  selectSkillsForInjection,
} from "./learning-repo";

describe("nextVersion (monotonicity)", () => {
  test("starts at 1 with no prior versions", () => {
    expect(nextVersion([])).toBe(1);
  });
  test("returns max + 1 regardless of order/gaps", () => {
    expect(nextVersion([1, 2, 3])).toBe(4);
    expect(nextVersion([3, 1, 2])).toBe(4);
    expect(nextVersion([1, 5])).toBe(6); // gaps never reused
  });
});

const mem = (scope: KnowledgeScope, confidence: number) => ({ scope, confidence });

describe("selectMemoriesForInjection (bounded)", () => {
  const policy: MemoryPolicy = { inject: true, scopes: ["agent", "team"], maxEntries: 2, minConfidence: 0.5 };

  test("filters by scope and minConfidence, caps count, highest-confidence first", () => {
    const out = selectMemoriesForInjection(
      [mem("agent", 0.9), mem("team", 0.6), mem("agent", 0.4), mem("project", 0.99)],
      policy,
    );
    expect(out.map((m) => m.confidence)).toEqual([0.9, 0.6]); // 0.4 below min, project out of scope, capped at 2
  });

  test("inject:false yields nothing (injection is opt-in & bounded)", () => {
    expect(selectMemoriesForInjection([mem("agent", 1)], { ...policy, inject: false })).toEqual([]);
  });
});

describe("selectSkillsForInjection (bounded)", () => {
  const policy: SkillPolicy = { inject: true, scopes: ["agent"], maxSkills: 1 };
  test("filters by scope and caps count", () => {
    const out = selectSkillsForInjection(
      [{ scope: "agent" as KnowledgeScope }, { scope: "agent" as KnowledgeScope }, { scope: "team" as KnowledgeScope }],
      policy,
    );
    expect(out).toHaveLength(1);
  });
});

describe("buildInjectionPreamble", () => {
  test("empty context → empty string (prompt untouched)", () => {
    expect(buildInjectionPreamble({ memories: [], skills: [] })).toBe("");
  });
  test("renders memory + skill sections", () => {
    const out = buildInjectionPreamble({
      memories: [{ content: "avoid timeouts", confidence: 0.6, scope: "agent" }],
      skills: [{ name: "Deploy", bodyMd: "run the script", triggerConditions: ["on release"] }],
    });
    expect(out).toContain("avoid timeouts");
    expect(out).toContain("Deploy");
    expect(out).toContain("on release");
    expect(out.endsWith("---\n\n")).toBe(true);
  });
});
