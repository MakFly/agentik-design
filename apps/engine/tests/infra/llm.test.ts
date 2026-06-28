import { describe, expect, test } from "bun:test";
import {
  buildRoutePrompt,
  parseRouteDecision,
  type RouterAgent,
} from "../../src/infra/llm";

const agents: RouterAgent[] = [
  { id: "agt_seo", name: "SEO Auditor", role: "audits sites", goal: "rank higher" },
  { id: "agt_leads", name: "Lead Researcher", role: "finds prospects" },
];

describe("buildRoutePrompt", () => {
  test("lists every agent id and the user message", () => {
    const prompt = buildRoutePrompt(agents, "trouve-moi des leads");
    expect(prompt).toContain("id=agt_seo");
    expect(prompt).toContain("id=agt_leads");
    expect(prompt).toContain("SEO Auditor");
    expect(prompt).toContain("trouve-moi des leads");
  });
});

describe("parseRouteDecision", () => {
  test("accepts a valid agent id and clamps confidence", () => {
    expect(
      parseRouteDecision(
        { agentId: "agt_leads", confidence: 1.4, reason: "lead intent" },
        agents,
      ),
    ).toEqual({ agentId: "agt_leads", confidence: 1, reason: "lead intent" });
  });

  test("rejects a hallucinated agent id → null (caller falls back)", () => {
    expect(
      parseRouteDecision(
        { agentId: "agt_ghost", confidence: 0.9, reason: "x" },
        agents,
      ),
    ).toBeNull();
  });

  test("treats a declined route (null id) as null", () => {
    expect(
      parseRouteDecision({ agentId: null, confidence: 0, reason: "no fit" }, agents),
    ).toBeNull();
  });

  test("rejects malformed output → null", () => {
    expect(parseRouteDecision({ nope: true }, agents)).toBeNull();
    expect(parseRouteDecision(null, agents)).toBeNull();
  });

  test("defaults a blank reason", () => {
    expect(
      parseRouteDecision({ agentId: "agt_seo", confidence: 0.7, reason: "" }, agents),
    ).toEqual({ agentId: "agt_seo", confidence: 0.7, reason: "llm route" });
  });
});
